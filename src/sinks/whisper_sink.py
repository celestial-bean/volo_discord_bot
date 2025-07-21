import asyncio
import io
import json
import logging
import threading
import time
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from queue import Queue
from typing import List
import discord
from dotenv import load_dotenv
import os
import src.chatgpt as chatgpt

#tts
try:
    from gtts import gTTS
except ImportError:
    os.system("pip install gTTs")
    from gtts import gTTS

#audio
try:
    import pyaudio
except ImportError:
    os.system("pip install pyaudio")
    import pyaudio
from yt_dlp import YoutubeDL
try:
    from pydub import AudioSegment
    from pydub.utils import which
except ImportError:
    os.system("pip install pydub")
    os.system("pip install audioop-lts")
    from pydub import AudioSegment
    from pydub.utils import which

#AI
import speech_recognition as sr
import torch
from discord.sinks.core import Filters, Sink, default_filters
from faster_whisper import WhisperModel
from openai import OpenAI

WHISPER_MODEL = "large-v3"
WHISPER_LANGUAGE = "en"
WHISPER__PRECISION = "float32"

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(DEVICE)
# Set the model to evaluation mode (important for inference)
logger = logging.getLogger(__name__)

if DEVICE == "cuda":
    gpu_ram = torch.cuda.get_device_properties(0).total_memory/1024**3
    if gpu_ram < 5.0:
        logger.warning("GPU has less than 5GB of RAM. Switching to CPU.")
        DEVICE = "cpu"

audio_model = WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=WHISPER__PRECISION)

load_dotenv()
GENERAL_CHAT_ID = os.getenv("DISCORD_CHANNEL_ID")
GUILD_ID=int(os.getenv("GUILD_ID"))
SHUTUP_ROLE_ID=int(os.getenv("SHUTUP_ROLE_ID"))
ADMIN_ROLE_ID=int(os.getenv("ADMIN_ROLE_ID"))
TIMEOUT_VC_ID=int(os.getenv("TIMEOUT_VC_ID"))

os.environ["PATH"] += os.pathsep + os.path.join("ffmpeg", "ffmpeg.exe")

class Speaker:
    """
    A class to store the audio data and transcription for each user.
    """

    def __init__(self, user: int, player: str, character: str, data, time=time.time()):
        self.user = user
        self.player = player
        self.character = character
        self.data = [data]
        self.first_word =time
        self.last_word = time
        self.new_bytes = 1


class WhisperSink(Sink):
    """A sink for discord that takes audio in a voice channel and transcribes it for each user.

    Uses faster whisper for transcription. can be swapped out for other audio transcription libraries pretty easily.

    :param transcript_queue: The queue to send the transcription output to
    :param filters: Some discord thing I'm not sure about
    :param data_length: The amount of data to save when user is silent but their mic is still active

    :param max_speakers: The amount of users to transcribe when all speakers are talking at once.
    """

    def __init__(
        self,
        transcript_queue: asyncio.Queue,
        loop: asyncio.AbstractEventLoop,
        transcriber_type="local",
        *,
        filters=None,
        player_map={},
        data_length=50000,
        max_speakers=-1,
        bot
    ):
        self.queue = transcript_queue
        self.transcription_output_queue = asyncio.Queue()
        self.loop = loop

        if filters is None:
            filters = default_filters
        self.filters = filters
        Filters.__init__(self, **self.filters)
        self.data_length = data_length
        self.max_speakers = max_speakers
        self.transcriber_type = transcriber_type
        if transcriber_type == "openai":
            self.client = OpenAI()
        self.vc = None
        self.audio_data = {}
        self.running = True
        self.speakers: List[Speaker] = []
        self.voice_queue = Queue()
        self.executor = ThreadPoolExecutor(max_workers=8)  # TODO: Adjust this
        self.player_map = player_map
        self.bot=bot
        self.members=""
        self.memory=[]
        self.guild=""
        
    def start_voice_thread(self, on_exception=None):
        def thread_exception_hook(args):
            logger.debug(
                f"""Exception in voice thread: {args} Likely disconnected while listening."""
            )

        logger.debug(
            f"Starting whisper sink thread for guild {self.vc.channel.guild.id}."
        )
        self.voice_thread = threading.Thread(
            target=self.insert_voice, args=(), daemon=True
        )

        if on_exception:
            threading.excepthook = on_exception
        else:
            threading.excepthook = thread_exception_hook

        self.voice_thread.start()

    def stop_voice_thread(self):
        self.running = False
        try:
            self.voice_thread.join()
        except Exception as e:
            logger.error(f"Unexpected error during thread join: {e}")
        finally:
            logger.debug(
                f"A sink thread was stopped for guild {self.vc.channel.guild.id}."
            )
    def check_audio_length(self, temp_file):
        # Ensure the BytesIO is at the start
        temp_file.seek(0)

        # Open the BytesIO object as a WAV file
        with wave.open(temp_file, 'rb') as wave_file:
            frames = wave_file.getnframes()
            frame_rate = wave_file.getframerate()
            duration = frames / float(frame_rate)
        return duration
    def transcribe_audio(self, temp_file):
        try:
            # Ensure that the audio is long enough to transcribe. If not, return an empty string
            if self.check_audio_length(temp_file) <= 0.1:
                return ""
            
            if self.transcriber_type == "openai":
                temp_file.seek(0)
                openai_transcription = self.client.audio.transcriptions.create(
                    file=("foobar.wav", temp_file),
                    model="whisper-1",
                    language=WHISPER_LANGUAGE,
                )
                logger.info(f"OpenAI Transcription: {openai_transcription.text}")
                return openai_transcription.text
            else:               
                # The whisper model
                temp_file.seek(0)
                segments, info = audio_model.transcribe(
                    temp_file,
                    language=WHISPER_LANGUAGE,
                    beam_size=10,
                    best_of=3,
                    vad_filter=True,
                    vad_parameters=dict(
                        min_silence_duration_ms=150,
                        threshold=0.8
                    ),
                    no_speech_threshold=0.6,
                    initial_prompt="You are writing the transcriptions for a D&D game.",
                )

                segments = list(segments)
                result = ""
                for segment in segments:
                    result += segment.text

                #logger.info(f"Transcription: {result}")
                return result
        except Exception as e:
            logger.error(f"Error transcribing audio: {e}")
            return ""

    def transcribe(self, speaker: Speaker):
        audio_data = sr.AudioData(
            bytes().join(speaker.data),
            self.vc.decoder.SAMPLING_RATE,
            self.vc.decoder.SAMPLE_SIZE // self.vc.decoder.CHANNELS,
        )

        wav_data = io.BytesIO(audio_data.get_wav_data())

        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wave_writer:
            wave_writer.setnchannels(self.vc.decoder.CHANNELS)
            wave_writer.setsampwidth(
                self.vc.decoder.SAMPLE_SIZE // self.vc.decoder.CHANNELS)
            wave_writer.setframerate(self.vc.decoder.SAMPLING_RATE)
            wave_writer.writeframes(wav_data.getvalue())

        wav_io.seek(0)
        # Check if the audio is long enough to transcribe, else return empty string
        
        transcription = self.transcribe_audio(wav_io)

        return transcription
    
    def get_transcriptions(self):
        """Retrieve all transcriptions from the queue, format them to only include data, begin, and user_id."""
        transcriptions = []
        while not self.transcription_queue.empty():
            log_message = self.transcription_queue.get_nowait()

            # Assuming log_message is a dictionary (or string in JSON format)
            if isinstance(log_message, str):
                log_message = json.loads(log_message)  # Convert from string to dictionary if needed

            # Extract only the desired fields from the log message
            begin = log_message.get("begin", "Unknown begin")
            user_id = log_message.get("user_id", "Unknown user")
            data = log_message.get("data", "")

            # Format the transcription entry with only the relevant fields
            formatted_entry = (
                f"Begin: {begin}\n"
                f"User ID: {user_id}\n"
                f"Data: {data}\n"
                "-------------------------\n"
            )

            # Add the formatted entry to the transcription list
            transcriptions.append(formatted_entry)

        return transcriptions

    def insert_voice(self):
        while self.running:
            try:
                # Process the voice_queue
                while not self.voice_queue.empty():
                    item = self.voice_queue.get()
                    # Find or create a speaker
                    speaker = next(
                        (s for s in self.speakers if s.user == item[0]), None
                    )
                    if speaker:
                        speaker.data.append(item[1])
                        speaker.new_bytes += 1
                        speaker.last_word = item[2]
                    elif (
                        self.max_speakers < 0 or len(self.speakers) <= self.max_speakers
                    ):
                        user_id = item[0]
                        user_map = self.player_map.get(user_id, {})
                        player = user_map.get("player")
                        character = user_map.get("character")
                        self.speakers.append(Speaker(user_id, player, character, item[1], item[2]))
                    

                # Transcribe audio for each speaker
                # so this is interesting, as we arent checking the size of the audio stream, we are just transcribing it
                future_to_speaker = {}
                for speaker in self.speakers:
                    if (time.time() - speaker.last_word) < 1.5:
                        # Lets make sure the user stopped talking.
                        continue
                    if speaker.new_bytes > 1:
                        speaker.new_bytes = 0
                        future = self.executor.submit(self.transcribe, speaker)
                        future_to_speaker[future] = speaker
                    else:
                        continue
                
                for future in future_to_speaker:
                    speaker = future_to_speaker[future]
                    try:
                        transcription = future.result()
                        try: 
                            
                            if self.guild=="":
                                self.guild=asyncio.run_coroutine_threadsafe(self.bot.fetch_guild(GUILD_ID),self.loop).result()
                            if self.members=="":
                                async def fetch_all_members(guild):
                                    return [member async for member in guild.fetch_members(limit=None)]

                                self.members=asyncio.run_coroutine_threadsafe(fetch_all_members(self.guild),self.loop ).result()

                            text=transcription.lower().strip()
                            if text:
                                print(str(speaker.player)+": "+text)
                                
                            async def delayRemoveRole(role_id, delay):
                                await asyncio.sleep(delay)
                                await member.remove_roles(role_id)
                                print(f"Removed {role.name} from {member.display_name}")

                            def convertName(arg): #returns int user id
                                for member in self.members:
                                    if arg.lower() in member.display_name.lower():
                                        return member.id
                                if arg in nameDictionary.keys():
                                    return int(nameDictionary[arg])
                                print("no user with name "+arg)
                                return None

                            YDL_OPTIONS = {'format': 'bestaudio', 'noplaylist': 'True'}
                            FFMPEG_OPTIONS = {
                                'options': '-vn',
                                'executable': os.path.join("ffmpeg", "ffmpeg.exe")
                                }
                            
                            nameDictionary={
                                "ryan":"773550459687403541",
                                "noah":"1393044419661402183",
                                "hunter":"774864083110592533",
                                "branson":"1214407016299241552",
                                "nate":"864723222191407165",
                                "nathan":"864723222191407165",
                                "loic":"1124004427347533926",
                                "grungy":"665652720681615373",
                                "gauge":"665652720681615373",
                                "adrian":"582709566811406356",
                                "kazuto":"773550459687403541",
                                "bryson":"1333270349596463155",
                                "logan":"567809027506044942",
                                "kiwi":"671111921537122333",
                                "coast":"671111921537122333",
                                "chase":"595483398882066434"
                            }
                            
                            generalChat=self.vc.guild.get_channel(int(GENERAL_CHAT_ID))
                            try:
                                if "test" in text:
                                    idx = text.index("test") + len("test")
                                    temp="<@"+str(speaker.user)+">: "+transcription
                                    future=asyncio.run_coroutine_threadsafe(generalChat.send(temp), self.loop)
                                    future=future.result()     
                            except Exception as e:
                                print(f"Error in test: {e}" )

                                try:
                                    if "i'm omni-ing it" in text:
                                        print("i'm omni-ing it")
                                        idx = text.index("i'm omni-ing it") + len("i'm omni-ing it")
                                        user_id=str(speaker.user)
                                        print(str(user_id)+" is omni-ing it")
                                        future=asyncio.run_coroutine_threadsafe(generalChat.send("<@"+user_id+"> is Omni-ing it."), self.loop)
                                        future=future.result()
                                except Exception as e:
                                    print(f"Error in omni-ing it: {e}")

                            try:
                                if "skippity toilet time" in text or "skibbity toilet time" in text or "skibbity-toilet time" in text:
                                    print("activating skibidi toilet")
                                    # Tells pydub where to find ffmpeg and ffprobe                       
                                    YOUTUBE_URL="https://www.youtube.com/watch?v=jnPKQV_ifYM"
                                    with YoutubeDL(YDL_OPTIONS) as ydl:
                                        info = ydl.extract_info(YOUTUBE_URL, download=False)
                                        url = info['url']
                                        print(info)
                                    future=asyncio.run_coroutine_threadsafe(self.guild.change_voice_state(channel=self.vc.channel, self_mute=False),self.loop)
                                    future=future.result()
                                    self.vc.play(discord.FFmpegPCMAudio(url, **FFMPEG_OPTIONS), after=lambda e: print("Playback finished", e))
                            except Exception as e:
                                print(f"Error in skibidi toilet: {e}")

                            try:
                                if "shut up" in text:
                                    idx = text.index("shut up") + len("shut up")
                                    arg = str(text[idx:]).split(" ")[1].rstrip(".").rstrip(",")
                                    user_id=convertName(arg)
                                    if user_id:
                                        future = asyncio.run_coroutine_threadsafe(self.guild.fetch_member(user_id), self.loop)
                                        member = future.result()
                                        role = discord.utils.get(member.guild.roles, name="Shut up")
                                        role= member.guild.get_role(SHUTUP_ROLE_ID)
                                        if role is None:
                                            print("Role not found.")
                                        else:
                                            future=asyncio.run_coroutine_threadsafe(member.add_roles(role), self.loop)
                                            future=future.result()
                                            asyncio.run_coroutine_threadsafe(delayRemoveRole(role,100), self.loop)# dont await
                                            print(f"Added {role.name} to {member.display_name}")
                            except Exception as e:
                                print(f"Error in shut up: {e}")
                                
                            try:
                                if "what do you do with a soccer ball" in text:
                                    idx = text.index("what do you do with a soccer ball") + len("what do you do with a soccer ball")
                                    arg = str(text[idx:]).split(" ")[1].rstrip(".").rstrip(",")
                                    user_id=convertName(arg)
                                    if user_id:
                                        if user_id!=self.bot.user.id:
                                            future = asyncio.run_coroutine_threadsafe(self.guild.fetch_member(user_id), self.loop)
                                            member = future.result()
                                            if not any(r.id == ADMIN_ROLE_ID for r in member.roles):
                                                future=asyncio.run_coroutine_threadsafe(member.move_to(None), self.loop)
                                                future=future.result()
                                            else:
                                                print("Cannot kick an admin")
                                        else:
                                            print("Bot cannot kick itself")
                            except Exception as e:
                                print(f"Error in soccer ball: {e}")

                            if "go sit in the corner" in text:
                                idx = text.index("go sit in the corner") + len("go sit in the corner")
                                arg = str(text[idx:]).split(" ")[1].rstrip(".").rstrip(",")
                                user_id=convertName(arg)
                                if user_id:
                                    if user_id!=self.bot.user.id:
                                        future = asyncio.run_coroutine_threadsafe(self.guild.fetch_member(user_id), self.loop)
                                        member = future.result()
                                        if not any(r.id == ADMIN_ROLE_ID for r in member.roles):
                                            channel=self.guild.get_channel(TIMEOUT_VC_ID)
                                            future=asyncio.run_coroutine_threadsafe(member.move_to(channel), self.loop)
                                            future=future.result()
                                        else:
                                            print("Cannot timeout an admin")
                                    else:
                                        print("Bot cannot timeout itself")
                                
                            def AI_worker():
                                try:
                                    #tts=gTTS(text="Hey, whats up "+str(speaker.player),lang="en")
                                    prompt="history: "+";".join(self.memory)+"New message: "+ speaker.player+": "+ text
                                    print("Prompt: "+prompt)
                                    msg=asyncio.run_coroutine_threadsafe(chatgpt.get_chatgpt_response(prompt),self.loop).result()
                                    print(msg)
                                    tts=gTTS(text=msg,lang="en")
                                    tts.save("tts.mp3")
                                    future=asyncio.run_coroutine_threadsafe(self.guild.change_voice_state(channel=self.vc.channel, self_mute=False),self.loop)
                                    temp=future.result()
                                    self.vc.play(discord.FFmpegPCMAudio(source="tts.mp3", **FFMPEG_OPTIONS), after=lambda e: print("Done playing"))
                                except Exception as e:
                                    print(f"Error in chatgpt: {e}")

                            if "hey, bot" in text or "hey bot" in text:
                                threading.Thread(target=AI_worker, args=(s,)).start()

                            if text:
                                self.memory.append(str(speaker.player)+": "+text)
                                self.memory=self.memory[-20:]

                        except Exception as e:
                            logger.error(f"Custom code error: {e}", exc_info=True)


                        current_time = time.time()
                        speaker_new_bytes = speaker.new_bytes
                        # Remove speaker once returned. 
                        for s in self.speakers[:]:
                            if speaker.user == s.user:
                              #  self.write_transcription_log(s, transcription)
                                self.speakers.remove(s)

                    except Exception as e:
                        logger.warn(f"Error in insert_voice future: {e}")

            except Exception as e:
                logger.error(f"Error in insert_voice: {e}")
            

    def check_speaker_timeouts(self, current_speaker, transcription):

        # Copy the list to avoid modification during iteration
        for speaker in self.speakers[:]:
            if current_speaker.user == speaker.user:
                #self.write_transcription_log(speaker, transcription)
                self.speakers.remove(speaker)
    
    def write_transcription_log(self, speaker, transcription):
        # Convert first_word and last_word Unix timestamps to datetime
        first_word_time = datetime.fromtimestamp(speaker.first_word).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        last_word_time = datetime.fromtimestamp(speaker.last_word).strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
        # Prepare the log data as a dictionary
        log_data = {
            "date": first_word_time[:10],                  # Date (from first_word)
            "begin": first_word_time[11:],       # First word time (HH:MM:SS.ss)
            "end": last_word_time[11:],         # Last word time (HH:MM:SS.ss)
            "user_id": speaker.user,                       # User ID
            "player": speaker.player,
            "character": speaker.character,
            "event_source": "Discord",                     # Event source
            "data": transcription                          # Transcription text
        }

        # Convert the log data to JSON
        log_message = json.dumps(log_data)

        # Get the transcription logger
        transcription_logger = logging.getLogger('transcription')
        # Log the message
        transcription_logger.info(log_message)
        # Place into queue for processing
        self.transcription_output_queue.put_nowait(log_message)
    

    @Filters.container
    def write(self, data, user):
        """Gets audio data from discord for each user talking"""
        # Discord will send empty bytes from when the user stopped talking to when the user starts to talk again.
        # Its only the first data that grows massive and its only silent audio, so its trimmed.

        data_len = len(data)
        if data_len > self.data_length:
            data = data[-self.data_length :]
        write_time = time.time()
        # Send bytes to be transcribed
        self.voice_queue.put_nowait([user, data, write_time])

    def close(self):
        logger.debug("Closing whisper sink.")
        self.running = False
        self.queue.put_nowait(None)
        super().cleanup()

    