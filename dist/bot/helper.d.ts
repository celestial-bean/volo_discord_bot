import { EmbedBuilder } from 'discord.js';
import { VoloBot } from './volo_bot';
export declare class BotHelper {
    bot: VoloBot;
    guildId: string | null;
    ttsQueue: any;
    currentMusicSource: any;
    currentMusicSourceUrl: string | null;
    currentSfxSource: any;
    userMusicVolume: number;
    voice: any;
    vc: any;
    constructor(bot: VoloBot);
    setVc(voiceClient: any): void;
    sendMessage(channelId: string, content: string, embed?: EmbedBuilder, tts?: boolean): Promise<void>;
    handlePostNode(node: any, discordChannelId: string): Promise<void>;
    handleRequestStatusUpdate(update: any): Promise<void>;
}
//# sourceMappingURL=helper.d.ts.map