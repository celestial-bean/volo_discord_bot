import { Client } from 'discord.js';
import { BotHelper } from './helper';
import { WhisperSink } from '../sinks/whisper_sink';
import { ChatInputCommandInteraction } from 'discord.js';
export declare class VoloBot extends Client {
    guildToHelper: Map<string, BotHelper>;
    guildIsRecording: Map<string, boolean>;
    guildWhisperSinks: Map<string, WhisperSink>;
    guildWhisperMessageTasks: Map<string, any>;
    playerMap: {
        [key: string]: {
            player: string;
            character: string;
        };
    };
    _isReady: boolean;
    transcriberType: string;
    constructor();
    onReady(): Promise<void>;
    scheduleWeeklyTask(): Promise<void>;
    doScheduledTask(): Promise<void>;
    _closeAndCleanSinkForGuild(guildId: string): void;
    startRecording(): void;
    startWhisperSink(): void;
    private startListeningToUser;
    stopRecording(ctx: ChatInputCommandInteraction): void;
    cleanupSink(ctx: ChatInputCommandInteraction): void;
    getTranscription(ctx: ChatInputCommandInteraction): Promise<any[]>;
    updatePlayerMap(ctx: ChatInputCommandInteraction): Promise<void>;
    stopAndCleanup(): Promise<void>;
}
//# sourceMappingURL=volo_bot.d.ts.map