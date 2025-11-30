import { Client, GatewayIntentBits, ActivityType, VoiceChannel, VoiceState, Guild, Collection } from 'discord.js';
import { VoiceConnectionStatus } from '@discordjs/voice';
import { BotHelper } from './helper';
import { WhisperSink } from '../sinks/whisper_sink';
import * as yaml from 'js-yaml';
import * as fs from 'fs';
import * as path from 'path';
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

const TRANSCRIPTION_METHOD = process.env.TRANSCRIPTION_METHOD || "local";
const PLAYER_MAP_FILE_PATH = process.env.PLAYER_MAP_FILE_PATH;
const GUILD_ID = process.env.GUILD_ID!;

export class VoloBot extends Client {
  guildToHelper: Map<string, BotHelper> = new Map();
  guildIsRecording: Map<string, boolean> = new Map();
  guildWhisperSinks: Map<string, WhisperSink> = new Map();
  guildWhisperMessageTasks: Map<string, any> = new Map();
  playerMap: { [key: string]: { player: string; character: string } } = {};
  _isReady: boolean = false;
  transcriberType: string;

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
      ],
      presence: {
        activities: [{
          name: 'Transcribing Audio to Text',
          type: ActivityType.Custom
        }]
      }
    });

    this.transcriberType = TRANSCRIPTION_METHOD === "openai" ? "openai" : "local";
    
    if (PLAYER_MAP_FILE_PATH && fs.existsSync(PLAYER_MAP_FILE_PATH)) {
      try {
        const fileContents = fs.readFileSync(PLAYER_MAP_FILE_PATH, 'utf8');
        this.playerMap = yaml.load(fileContents) as { [key: string]: { player: string; character: string } };
      } catch (e) {
        console.error(`Error loading player map: ${e}`);
      }
    }
  }

  async onReady(): Promise<void> {
    console.log(`Logged in as ${this.user?.tag} to Discord.`);
    this._isReady = true;
    this.scheduleWeeklyTask();
  }

  async scheduleWeeklyTask(): Promise<void> {
    const TARGET_HOUR = 23;
    const TARGET_MINUTE = 1;
    const TARGET_WEEKDAY = 4; // Friday

    while (true) {
      const now = new Date();
      let daysAhead = TARGET_WEEKDAY - now.getDay();
      
      if (daysAhead <= 0) {
        if (TARGET_HOUR > now.getHours()) {
          daysAhead += 7;
        }
      }

      const nextRun = new Date(now);
      nextRun.setDate(now.getDate() + daysAhead);
      nextRun.setHours(TARGET_HOUR, TARGET_MINUTE, 0, 0);

      const waitSeconds = (nextRun.getTime() - now.getTime()) / 1000;
      console.log(`Next scheduled task in ${waitSeconds / 3600:.2f} hours.`);
      
      await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
      await this.doScheduledTask();
    }
  }

  async doScheduledTask(): Promise<void> {
    try {
      const sink = this.guildWhisperSinks.get(GUILD_ID);
      if (sink && sink.vc) {
        // Play audio file
        const audioPath = path.join(process.cwd(), "assets", "event.mp3");
        if (fs.existsSync(audioPath)) {
          // Audio playback would be handled by the voice connection
          // This is a simplified version - actual implementation depends on discord.js voice
          console.log("Playing scheduled audio");
        }
      }
    } catch (e: any) {
      console.error(`Failed scheduled task: ${e}`);
    }
  }

  _closeAndCleanSinkForGuild(guildId: string): void {
    const whisperSink = this.guildWhisperSinks.get(guildId);

    if (whisperSink) {
      console.log(`Stopping whisper sink, requested by ${guildId}.`);
      whisperSink.stopVoiceThread();
      this.guildWhisperSinks.delete(guildId);
      whisperSink.close();
    }
  }

  startRecording(): void {
    try {
      this.startWhisperSink();
      this.guildIsRecording.set(GUILD_ID, true);
    } catch (e: any) {
      console.error(`Error starting whisper sink: ${e}`);
    }
  }

  startWhisperSink(): void {
    const guildVoiceSink = this.guildWhisperSinks.get(GUILD_ID);
    if (guildVoiceSink) {
      console.log(`Sink is already active for guild ${GUILD_ID}.`);
      return;
    }

    const helper = this.guildToHelper.get(GUILD_ID);
    if (!helper || !helper.vc) {
      console.error("No voice connection available for guild");
      return;
    }

    const transcriptQueue = new Array(); // Simplified queue for now

    const whisperSink = new WhisperSink(
      transcriptQueue,
      this,
      {
        dataLength: 50000,
        maxSpeakers: 7,
        transcriberType: this.transcriberType,
        playerMap: this.playerMap
      }
    );

    whisperSink.vc = helper.vc;

    // Set up audio receiver to capture audio from users
    const receiver = helper.vc.receiver;
    
    helper.vc.on('stateChange', (oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Ready) {
        // Start listening to all users in the voice channel
        const guild = this.guilds.cache.get(GUILD_ID);
        if (guild) {
          const voiceChannel = helper.vc?.joinConfig.channelId 
            ? guild.channels.cache.get(helper.vc.joinConfig.channelId) as any
            : null;
          
          if (voiceChannel) {
            voiceChannel.members.forEach((member: any) => {
              if (!member.user.bot) {
                this.startListeningToUser(receiver, member.id, whisperSink);
              }
            });
          }
        }
      }
    });

    const onThreadException = (e: any) => {
      console.warn(`Whisper sink thread exception for guild ${GUILD_ID}. Retry in 5 seconds...\n${e}`);
      this._closeAndCleanSinkForGuild(GUILD_ID);
      setTimeout(() => this.startRecording(), 5000);
    };

    whisperSink.startVoiceThread(onThreadException);
    this.guildWhisperSinks.set(GUILD_ID, whisperSink);
  }

  private startListeningToUser(receiver: VoiceReceiver, userId: string, sink: WhisperSink): void {
    const audioStream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 100
      }
    });

    audioStream.on('data', (chunk: Buffer) => {
      sink.write(chunk, userId);
    });
  }

  stopRecording(ctx: ChatInputCommandInteraction): void {
    const vc = ctx.guild?.voiceStates.cache.get(this.user!.id)?.channel;
    if (vc) {
      this.guildIsRecording.set(ctx.guildId!, false);
      // Stop recording would be handled by the voice connection
    }

    const guildId = ctx.guildId!;
    const whisperMessageTask = this.guildWhisperMessageTasks.get(guildId);
    if (whisperMessageTask) {
      console.log("Cancelling whisper message task.");
      clearTimeout(whisperMessageTask);
      this.guildWhisperMessageTasks.delete(guildId);
    }
  }

  cleanupSink(ctx: ChatInputCommandInteraction): void {
    const guildId = ctx.guildId!;
    this._closeAndCleanSinkForGuild(guildId);
  }

  async getTranscription(ctx: ChatInputCommandInteraction): Promise<any[]> {
    const whisperSink = this.guildWhisperSinks.get(ctx.guildId!);
    if (!whisperSink) {
      return [];
    }

    const transcriptions: any[] = [];
    const transcriptionsQueue = whisperSink.transcriptionOutputQueue;
    
    while (transcriptionsQueue.length > 0) {
      transcriptions.push(transcriptionsQueue.shift()!);
    }
    
    return transcriptions;
  }

  async updatePlayerMap(ctx: ChatInputCommandInteraction): Promise<void> {
    const playerMap: { [key: string]: { player: string; character: string } } = {};
    
    const guild = await this.guilds.fetch(ctx.guildId!);
    const members = await guild.members.fetch();
    
    members.forEach(member => {
      playerMap[member.id] = {
        player: member.user.username,
        character: member.displayName
      };
    });

    console.log(JSON.stringify(playerMap));
    this.playerMap = { ...this.playerMap, ...playerMap };

    if (PLAYER_MAP_FILE_PATH) {
      try {
        fs.writeFileSync(PLAYER_MAP_FILE_PATH, yaml.dump(this.playerMap, { defaultFlowStyle: false, allowUnicode: true }), 'utf8');
      } catch (e) {
        console.error(`Error writing player map: ${e}`);
        throw e;
      }
    }
  }

  async stopAndCleanup(): Promise<void> {
    try {
      for (const sink of this.guildWhisperSinks.values()) {
        sink.close();
        sink.stopVoiceThread();
        console.log(`Stopped whisper sink in cleanup.`);
      }
      this.guildWhisperSinks.clear();
    } catch (e: any) {
      console.error(`Error stopping whisper sinks: ${e}`);
    } finally {
      console.log("Cleanup completed.");
    }
  }
}

