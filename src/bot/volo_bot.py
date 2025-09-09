import asyncio
import json
import logging
import os
from collections import defaultdict
from src.sinks.whisper_sink import WhisperSink
import discord
import yaml
from datetime import datetime, timedelta

DISCORD_CHANNEL_ID = int(os.getenv("DISCORD_CHANNEL_ID"))
TRANSCRIPTION_METHOD = os.getenv("TRANSCRIPTION_METHOD")
PLAYER_MAP_FILE_PATH = os.getenv("PLAYER_MAP_FILE_PATH")
GUILD_ID=int(os.getenv("GUILD_ID"))

logger = logging.getLogger(__name__)

class VoloBot(discord.Bot):
    def __init__(self, loop):
        intents = discord.Intents.default()
        intents.message_content = True  # If you're reading messages
        intents.members = True          # Needed for guild.members
        intents.guilds = True
        super().__init__(command_prefix="!", loop=loop,intents=intents,
                         activity=discord.CustomActivity(name='Transcribing Audio to Text'))
        self.guild_to_helper = {}
        self.guild_is_recording = {}
        self.guild_whisper_sinks = {}
        self.guild_whisper_message_tasks = {}
        self.player_map = {}
        self._is_ready = False
        if TRANSCRIPTION_METHOD == "openai":
            self.transcriber_type = "openai"
        else:
            self.transcriber_type = "local"
        if PLAYER_MAP_FILE_PATH:
            with open(PLAYER_MAP_FILE_PATH, "r", encoding="utf-8") as file:
                self.player_map = yaml.safe_load(file)


    async def on_ready(self):
        logger.info(f"Logged in as {self.user} to Discord.")
        self._is_ready = True
        self.loop.create_task(self.schedule_weekly_task())

    async def schedule_weekly_task(self):
        TARGET_HOUR = 23
        TARGET_MINUTE = 1
        TARGET_WEEKDAY=4
        while True:
            now = datetime.now()
            # # Calculate next Sunday at 14:30
            days_ahead = TARGET_WEEKDAY - now.weekday()
            if days_ahead <= 0:
                if TARGET_HOUR>now.hour:
                    days_ahead += 7  # Schedule for next Sunday

            next_run = now + timedelta(days=days_ahead)
            next_run = next_run.replace(hour=TARGET_HOUR, minute=TARGET_MINUTE, second=0, microsecond=0)

            wait_seconds = (next_run - now).total_seconds()
            print(f"Next scheduled task in {wait_seconds / 3600:.2f} hours.")
            await asyncio.sleep(wait_seconds)

            await self.do_scheduled_task()

    async def do_scheduled_task(self):
        try:
            self.guild_whisper_sinks[GUILD_ID].vc.play(discord.FFmpegPCMAudio(source="assets/event.mp3", **{
                                'options': '-vn',
                                'executable': os.path.join("ffmpeg", "ffmpeg.exe")
                                }), after=lambda e: print("Done playing"))
        except Exception as e:
            print(f"failed scheduled task: {e}")


    async def close_consumers(self):
        await self.consumer_manager.close()
    def _close_and_clean_sink_for_guild(self, guild_id: int):
        whisper_sink: WhisperSink | None = self.guild_whisper_sinks.get(
            guild_id, None)

        if whisper_sink:
            logger.debug(f"Stopping whisper sink, requested by {guild_id}.")
            whisper_sink.stop_voice_thread()
            del self.guild_whisper_sinks[guild_id]
            whisper_sink.close()

    
    def start_recording(self):
        """
        Start recording audio from the voice channel. Create a whisper sink
        and start sending transcripts to the queue.

        Since this is a critical function, this is where we should handle
        subscription checks and limits.
        """
        try:
            self.start_whisper_sink()
            self.guild_is_recording[GUILD_ID] = True
        except Exception as e:
            logger.error(f"Error starting whisper sink: {e}")

    def start_whisper_sink(self):
        guild_voice_sink = self.guild_whisper_sinks.get(GUILD_ID, None)
        if guild_voice_sink:
            logger.debug(
                f"Sink is already active for guild {GUILD_ID}.")
            return

        async def on_stop_record_callback(sink: WhisperSink):
            logger.debug(
                f"{GUILD_ID} -> on_stop_record_callback")
            self._close_and_clean_sink_for_guild(GUILD_ID)

        transcript_queue = asyncio.Queue()

        whisper_sink = WhisperSink(
            transcript_queue,
            self.loop,
            data_length=50000,
            max_speakers=7,
            transcriber_type=self.transcriber_type,
            player_map=self.player_map,
            bot=self
        )
        self.guild_to_helper[GUILD_ID].vc.start_recording(
            whisper_sink, on_stop_record_callback)
        def on_thread_exception(e):
            logger.warning(
                f"Whisper sink thread exception for guild {GUILD_ID}. Retry in 5 seconds...\n{e}")
            self._close_and_clean_sink_for_guild(GUILD_ID)

            # retry in 5 seconds
            self.loop.call_later(5, self.start_recording)
        whisper_sink.start_voice_thread(on_exception=on_thread_exception)

        self.guild_whisper_sinks[GUILD_ID] = whisper_sink

    def stop_recording(self, ctx: discord.context.ApplicationContext):
        vc = ctx.guild.voice_client
        if vc:
            self.guild_is_recording[ctx.guild_id] = False
            vc.stop_recording()
        guild_id = ctx.guild_id
        whisper_message_task = self.guild_whisper_message_tasks.get(
            guild_id, None)
        if whisper_message_task:
            logger.debug("Cancelling whisper message task.")
            whisper_message_task.cancel()
            del self.guild_whisper_message_tasks[guild_id]
    def cleanup_sink(self, ctx: discord.context.ApplicationContext):
        guild_id = ctx.guild_id
        self._close_and_clean_sink_for_guild(guild_id)

    async def get_transcription(self, ctx: discord.context.ApplicationContext):
        # Get the transcription queue
        if not (self.guild_whisper_sinks.get(ctx.guild_id)):
            return
        whisper_sink = self.guild_whisper_sinks[ctx.guild_id]
        transcriptions = []
        if whisper_sink is None:
            return
    
        transcriptions_queue = whisper_sink.transcription_output_queue
        while not transcriptions_queue.empty():
            transcriptions.append(await transcriptions_queue.get())
        return transcriptions

    async def update_player_map(self, ctx: discord.context.ApplicationContext):
        player_map = {}
        for member in ctx.guild.members:
            player_map[member.id] = {
                "player": member.name,
                "character": member.display_name
            }
        logger.info(f"{str(player_map)}")
        self.player_map.update(player_map)
        if PLAYER_MAP_FILE_PATH:
            with open(PLAYER_MAP_FILE_PATH, "w", encoding="utf-8") as file:
                yaml.dump(self.player_map, file, default_flow_style=False, allow_unicode=True)

    async def stop_and_cleanup(self):
        try:
            for sink in self.guild_whisper_sinks.values():
                sink.close()
                sink.stop_voice_thread()
                logger.debug(
                    f"Stopped whisper sink for guild {sink.vc.channel.guild.id} in cleanup.")
            self.guild_whisper_sinks.clear()
        except Exception as e:
            logger.error(f"Error stopping whisper sinks: {e}")
        finally:
            logger.info("Cleanup completed.")
    