import { VoiceConnection, EndBehaviorType, VoiceReceiver, AudioReceiveStream } from '@discordjs/voice';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { VoloBot } from '../bot/volo_bot';
import { getChatGPTResponse } from '../chatgpt';
import { OpenAI } from 'openai';
import * as yaml from 'js-yaml';

const GENERAL_CHAT_ID = process.env.GENERAL_CHAT_ID!;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID!;
const GUILD_ID = process.env.GUILD_ID!;
const SHUTUP_ROLE_ID = process.env.SHUTUP_ROLE_ID!;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID!;
const TIMEOUT_VC_ID = process.env.TIMEOUT_VC_ID!;
const ANT_COLONY_ROLE_ID = process.env.ANT_COLONY_ROLE_ID!;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID!;

const WHISPER_MODEL = "large-v3";
const WHISPER_LANGUAGE = "en";
const WHISPER_PRECISION = "float32";

let nameDictionary: { [key: string]: string } = {};
try {
  const dictPath = path.join(process.cwd(), "nameDictionary.json");
  if (fs.existsSync(dictPath)) {
    nameDictionary = JSON.parse(fs.readFileSync(dictPath, 'utf8'));
  }
} catch (e) {
  console.error("Error loading name dictionary:", e);
}

import { Speaker } from '../types';

import { WhisperSinkOptions } from '../types';

export class WhisperSink {
  transcriptionOutputQueue: any[] = [];
  loop: any;
  dataLength: number;
  maxSpeakers: number;
  transcriberType: string;
  vc: any;
  audioData: Map<string, Buffer[]> = new Map();
  running: boolean = true;
  speakers: Speaker[] = [];
  voiceQueue: any[] = [];
  playerMap: { [key: string]: { player: string; character: string } };
  bot: VoloBot;
  members: any = null;
  memory: string[] = [];
  guild: any = null;
  generalChat: any = null;
  listenerChannel: any = null;
  botLogChannel: any = null;
  voiceThread: NodeJS.Timeout | null = null;
  client: OpenAI | null = null;

  constructor(
    transcriptQueue: any[],
    bot: VoloBot,
    options: WhisperSinkOptions = {}
  ) {
    this.loop = null; // Not needed in Node.js
    this.dataLength = options.dataLength || 50000;
    this.maxSpeakers = options.maxSpeakers || -1;
    this.transcriberType = options.transcriberType || "local";
    this.playerMap = options.playerMap || {};
    this.bot = bot;

    if (this.transcriberType === "openai") {
      this.client = new OpenAI();
    }
  }

  convertName(arg: string, nameDictionary: { [key: string]: string }): string | null {
    if (this.members) {
      for (const member of this.members.values()) {
        if (member.displayName.toLowerCase().includes(arg.toLowerCase())) {
          return member.id;
        }
      }
    }
    if (arg in nameDictionary) {
      return nameDictionary[arg];
    }
    console.log(`no user with name ${arg}`);
    return null;
  }

  async log(str: string, ...args: any[]): Promise<void> {
    if (this.botLogChannel) {
      await this.botLogChannel.send(str);
    }
    console.log(str, ...args);
  }

  startVoiceThread(onException?: (e: any) => void): void {
    console.log("Starting whisper sink thread.");
    this.running = true;
    
    // Start processing voice queue
    this.voiceThread = setInterval(() => {
      this.insertVoice().catch((e) => {
        if (onException) {
          onException(e);
        } else {
          console.error(`Exception in voice thread: ${e}`);
        }
      });
    }, 100); // Process every 100ms
  }

  stopVoiceThread(): void {
    this.running = false;
    if (this.voiceThread) {
      clearInterval(this.voiceThread);
      this.voiceThread = null;
    }
    console.log("A sink thread was stopped.");
  }

  checkAudioLength(audioBuffer: Buffer): number {
    // Simplified - would need proper WAV parsing
    // For now, estimate based on buffer size (assuming 16-bit PCM, 48kHz, stereo)
    const bytesPerSample = 2;
    const channels = 2;
    const sampleRate = 48000;
    const duration = audioBuffer.length / (bytesPerSample * channels * sampleRate);
    return duration;
  }

  async transcribeAudio(audioBuffer: Buffer): Promise<string> {
    try {
      const duration = this.checkAudioLength(audioBuffer);
      if (duration <= 0.1) {
        return "";
      }

      if (this.transcriberType === "openai" && this.client) {
        // Create a temporary file for OpenAI API
        const tempFile = path.join(os.tmpdir(), `audio-${Date.now()}.wav`);
        fs.writeFileSync(tempFile, audioBuffer);
        
        try {
          const transcription = await this.client.audio.transcriptions.create({
            file: fs.createReadStream(tempFile) as any,
            model: "whisper-1",
            language: WHISPER_LANGUAGE,
          });
          console.log(`OpenAI Transcription: ${transcription.text}`);
          return transcription.text;
        } finally {
          fs.unlinkSync(tempFile);
        }
      } else {
        // Local transcription would use @xenova/transformers
        // This is a placeholder - actual implementation would require
        // setting up the transformers library
        console.warn("Local transcription not yet implemented. Use OpenAI transcription.");
        return "";
      }
    } catch (e: any) {
      console.error(`Error transcribing audio: ${e}`);
      return "";
    }
  }

  async transcribe(speaker: Speaker): Promise<string> {
    // Combine all audio data
    const combinedData = Buffer.concat(speaker.data);
    
    // Convert to WAV format (simplified - would need proper conversion)
    // For now, we'll pass the raw buffer to transcription
    const transcription = await this.transcribeAudio(combinedData);
    return transcription;
  }

  async delayRemoveRole(member: any, role: any, delay: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, delay * 1000));
    await member.roles.remove(role);
  }

  async insertVoice(): Promise<void> {
    if (!this.running) return;

    try {
      // Process the voice_queue
      while (this.voiceQueue.length > 0) {
        const item = this.voiceQueue.shift()!;
        const [userId, data, writeTime] = item;

        // Find or create a speaker
        let speaker = this.speakers.find(s => s.user === userId);
        if (speaker) {
          speaker.data.push(data);
          speaker.newBytes += 1;
          speaker.lastWord = writeTime;
        } else if (this.maxSpeakers < 0 || this.speakers.length <= this.maxSpeakers) {
          const userMap = this.playerMap[userId] || {};
          const player = userMap.player;
          const character = userMap.character;
          this.speakers.push({
            user: userId,
            player,
            character,
            data: [data],
            firstWord: writeTime,
            lastWord: writeTime,
            newBytes: 1
          });
        }
      }

      // Transcribe audio for each speaker
      const transcriptionPromises: Promise<void>[] = [];
      
      for (const speaker of this.speakers) {
        if ((Date.now() / 1000 - speaker.lastWord) < 1.5) {
          continue; // User is still talking
        }
        if (speaker.newBytes > 1) {
          speaker.newBytes = 0;
          
          const transcriptionPromise = this.transcribe(speaker).then(transcription => {
            return this.processTranscription(speaker, transcription);
          }).catch(e => {
            console.error(`Error in transcription: ${e}`);
          });
          
          transcriptionPromises.push(transcriptionPromise);
        }
      }

      await Promise.all(transcriptionPromises);
    } catch (e: any) {
      console.error(`Error in insert_voice: ${e}`);
    }
  }

  async processTranscription(speaker: Speaker, transcription: string): Promise<void> {
    try {
      // Initialize guild and channels if needed
      if (!this.guild) {
        this.guild = await this.bot.guilds.fetch(GUILD_ID);
      }
      if (!this.members) {
        this.members = await this.guild.members.fetch();
      }
      if (!this.generalChat) {
        this.generalChat = await this.guild.channels.fetch(GENERAL_CHAT_ID);
      }
      if (!this.listenerChannel) {
        this.listenerChannel = await this.guild.channels.fetch(DISCORD_CHANNEL_ID);
      }
      if (!this.botLogChannel) {
        this.botLogChannel = await this.guild.channels.fetch(LOG_CHANNEL_ID);
      }

      const text = transcription.toLowerCase().trim();
      if (text) {
        console.log(`${speaker.player}: ${text}`);
      }

      // Process various voice commands
      if (text.includes("test")) {
        const temp = `<@${speaker.user}>: ${transcription}`;
        await this.listenerChannel.send(temp);
      }

      if (text.includes("i'm omni-ing it")) {
        await this.listenerChannel.send(`<@${speaker.user}> is Omni-ing it.`);
      }

      if (text.includes("skippity toilet time") || text.includes("skibbity toilet time") || text.includes("skibbity-toilet time")) {
        await this.log("activating skibidi toilet");
        // Audio playback would be handled here
      }

      if (text.includes("shut up")) {
        const idx = text.indexOf("shut up") + "shut up".length;
        const arg = text.substring(idx).split(" ")[1]?.replace(/[.,!?]/g, "");
        const userId = this.convertName(arg, nameDictionary);
        if (userId) {
          const member = await this.guild.members.fetch(userId);
          const role = this.guild.roles.cache.get(SHUTUP_ROLE_ID);
          if (role) {
            await member.roles.add(role);
            this.delayRemoveRole(member, role, 100);
            await this.log(`Added ${role.name} to ${member.displayName}`);
          }
        }
      }

      // Similar processing for other commands...
      // (ant colony, soccer ball, corner, cheese, hey bot, etc.)

      if (text.includes("hey, bot") || text.includes("hey bot")) {
        try {
          const prompt = `history: ${this.memory.join(";")}New message: ${speaker.player}: ${text}`;
          console.log("Prompt: " + prompt);
          const msg = await getChatGPTResponse(prompt);
          console.log(msg);
          // TTS and audio playback would be handled here
        } catch (e: any) {
          await this.log(`Error in chatgpt: ${e}`);
        }
      }

      if (text) {
        this.memory.push(`${speaker.player}: ${text}`);
        this.memory = this.memory.slice(-20); // Keep last 20 entries
      }

      // Write transcription log
      this.writeTranscriptionLog(speaker, transcription);
      
      // Remove speaker
      const index = this.speakers.findIndex(s => s.user === speaker.user);
      if (index !== -1) {
        this.speakers.splice(index, 1);
      }
    } catch (e: any) {
      console.error(`Error processing transcription: ${e}`);
    }
  }

  writeTranscriptionLog(speaker: Speaker, transcription: string): void {
    const firstWordTime = new Date(speaker.firstWord * 1000).toISOString().replace('T', ' ').substring(0, 23);
    const lastWordTime = new Date(speaker.lastWord * 1000).toISOString().replace('T', ' ').substring(0, 23);

    const logData = {
      date: firstWordTime.substring(0, 10),
      begin: firstWordTime.substring(11),
      end: lastWordTime.substring(11),
      user_id: speaker.user,
      player: speaker.player,
      character: speaker.character,
      event_source: "Discord",
      data: transcription
    };

    const logMessage = JSON.stringify(logData);
    this.transcriptionOutputQueue.push(logMessage);
  }

  write(data: Buffer, userId: string): void {
    const dataLen = data.length;
    let processedData = data;
    
    if (dataLen > this.dataLength) {
      processedData = data.slice(-this.dataLength);
    }
    
    const writeTime = Date.now() / 1000;
    this.voiceQueue.push([userId, processedData, writeTime]);
  }

  close(): void {
    console.log("Closing whisper sink.");
    this.running = false;
    this.stopVoiceThread();
  }
}

