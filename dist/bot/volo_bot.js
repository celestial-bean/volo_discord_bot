"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoloBot = void 0;
const discord_js_1 = require("discord.js");
const voice_1 = require("@discordjs/voice");
const whisper_sink_1 = require("../sinks/whisper_sink");
const yaml = __importStar(require("js-yaml"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const TRANSCRIPTION_METHOD = process.env.TRANSCRIPTION_METHOD || "local";
const PLAYER_MAP_FILE_PATH = process.env.PLAYER_MAP_FILE_PATH;
const GUILD_ID = process.env.GUILD_ID;
class VoloBot extends discord_js_1.Client {
    constructor() {
        super({
            intents: [
                discord_js_1.GatewayIntentBits.Guilds,
                discord_js_1.GatewayIntentBits.GuildMessages,
                discord_js_1.GatewayIntentBits.MessageContent,
                discord_js_1.GatewayIntentBits.GuildMembers,
                discord_js_1.GatewayIntentBits.GuildVoiceStates
            ],
            presence: {
                activities: [{
                        name: 'Transcribing Audio to Text',
                        type: discord_js_1.ActivityType.Custom
                    }]
            }
        });
        this.guildToHelper = new Map();
        this.guildIsRecording = new Map();
        this.guildWhisperSinks = new Map();
        this.guildWhisperMessageTasks = new Map();
        this.playerMap = {};
        this._isReady = false;
        this.transcriberType = TRANSCRIPTION_METHOD === "openai" ? "openai" : "local";
        if (PLAYER_MAP_FILE_PATH && fs.existsSync(PLAYER_MAP_FILE_PATH)) {
            try {
                const fileContents = fs.readFileSync(PLAYER_MAP_FILE_PATH, 'utf8');
                this.playerMap = yaml.load(fileContents);
            }
            catch (e) {
                console.error(`Error loading player map: ${e}`);
            }
        }
    }
    async onReady() {
        console.log(`Logged in as ${this.user?.tag} to Discord.`);
        this._isReady = true;
        this.scheduleWeeklyTask();
    }
    async scheduleWeeklyTask() {
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
            console.log(`Next scheduled task in ${waitSeconds / 3600} hours.`);
            await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
            await this.doScheduledTask();
        }
    }
    async doScheduledTask() {
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
        }
        catch (e) {
            console.error(`Failed scheduled task: ${e}`);
        }
    }
    _closeAndCleanSinkForGuild(guildId) {
        const whisperSink = this.guildWhisperSinks.get(guildId);
        if (whisperSink) {
            console.log(`Stopping whisper sink, requested by ${guildId}.`);
            whisperSink.stopVoiceThread();
            this.guildWhisperSinks.delete(guildId);
            whisperSink.close();
        }
    }
    startRecording() {
        try {
            this.startWhisperSink();
            this.guildIsRecording.set(GUILD_ID, true);
        }
        catch (e) {
            console.error(`Error starting whisper sink: ${e}`);
        }
    }
    startWhisperSink() {
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
        const whisperSink = new whisper_sink_1.WhisperSink(transcriptQueue, this, {
            dataLength: 50000,
            maxSpeakers: 7,
            transcriberType: this.transcriberType,
            playerMap: this.playerMap
        });
        whisperSink.vc = helper.vc;
        // Set up audio receiver to capture audio from users
        const receiver = helper.vc.receiver;
        helper.vc.on('stateChange', (oldState, newState) => {
            if (newState.status === voice_1.VoiceConnectionStatus.Ready) {
                // Start listening to all users in the voice channel
                const guild = this.guilds.cache.get(GUILD_ID);
                if (guild) {
                    const voiceChannel = helper.vc?.joinConfig.channelId
                        ? guild.channels.cache.get(helper.vc.joinConfig.channelId)
                        : null;
                    if (voiceChannel) {
                        voiceChannel.members.forEach((member) => {
                            if (!member.user.bot) {
                                this.startListeningToUser(receiver, member.id, whisperSink);
                            }
                        });
                    }
                }
            }
        });
        const onThreadException = (e) => {
            console.warn(`Whisper sink thread exception for guild ${GUILD_ID}. Retry in 5 seconds...\n${e}`);
            this._closeAndCleanSinkForGuild(GUILD_ID);
            setTimeout(() => this.startRecording(), 5000);
        };
        whisperSink.startVoiceThread(onThreadException);
        this.guildWhisperSinks.set(GUILD_ID, whisperSink);
    }
    startListeningToUser(receiver, userId, sink) {
        const audioStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 100
            }
        });
        audioStream.on('data', (chunk) => {
            sink.write(chunk, userId);
        });
    }
    stopRecording(ctx) {
        const vc = ctx.guild?.voiceStates.cache.get(this.user.id)?.channel;
        if (vc) {
            this.guildIsRecording.set(ctx.guildId, false);
            // Stop recording would be handled by the voice connection
        }
        const guildId = ctx.guildId;
        const whisperMessageTask = this.guildWhisperMessageTasks.get(guildId);
        if (whisperMessageTask) {
            console.log("Cancelling whisper message task.");
            clearTimeout(whisperMessageTask);
            this.guildWhisperMessageTasks.delete(guildId);
        }
    }
    cleanupSink(ctx) {
        const guildId = ctx.guildId;
        this._closeAndCleanSinkForGuild(guildId);
    }
    async getTranscription(ctx) {
        const whisperSink = this.guildWhisperSinks.get(ctx.guildId);
        if (!whisperSink) {
            return [];
        }
        const transcriptions = [];
        const transcriptionsQueue = whisperSink.transcriptionOutputQueue;
        while (transcriptionsQueue.length > 0) {
            transcriptions.push(transcriptionsQueue.shift());
        }
        return transcriptions;
    }
    async updatePlayerMap(ctx) {
        const playerMap = {};
        const guild = await this.guilds.fetch(ctx.guildId);
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
            }
            catch (e) {
                console.error(`Error writing player map: ${e}`);
                throw e;
            }
        }
    }
    async stopAndCleanup() {
        try {
            for (const sink of this.guildWhisperSinks.values()) {
                sink.close();
                sink.stopVoiceThread();
                console.log(`Stopped whisper sink in cleanup.`);
            }
            this.guildWhisperSinks.clear();
        }
        catch (e) {
            console.error(`Error stopping whisper sinks: ${e}`);
        }
        finally {
            console.log("Cleanup completed.");
        }
    }
}
exports.VoloBot = VoloBot;
//# sourceMappingURL=volo_bot.js.map