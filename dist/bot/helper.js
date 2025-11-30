"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotHelper = void 0;
const BOT_NAME = "VOLO 💤";
const BOT_AWAKE_NAME = "VOLO 💬";
const BOT_PROCESSING_NAME = "VOLO 💡";
class BotHelper {
    constructor(bot) {
        this.guildId = null;
        this.ttsQueue = null;
        this.currentMusicSource = null;
        this.currentMusicSourceUrl = null;
        this.currentSfxSource = null;
        this.userMusicVolume = 0.5;
        this.voice = null;
        this.vc = null;
        this.bot = bot;
    }
    setVc(voiceClient) {
        this.vc = voiceClient;
        if (voiceClient === null) {
            this.ttsQueue = null;
            this.currentMusicSource = null;
            this.currentSfxSource = null;
            return;
        }
    }
    async sendMessage(channelId, content, embed, tts = false) {
        const channel = this.bot.channels.cache.get(channelId);
        if (channel) {
            await channel.send({ content, embeds: embed ? [embed] : undefined, tts });
        }
        else {
            console.error(`Channel with ID ${channelId} not found.`);
        }
    }
    async handlePostNode(node, discordChannelId) {
        await this.sendMessage(discordChannelId, node.data.text);
    }
    async handleRequestStatusUpdate(update) {
        if (this.guildId === null) {
            return;
        }
        try {
            const status = update.status;
            const guild = await this.bot.guilds.fetch(this.guildId);
            const member = await guild.members.fetch(this.bot.user.id);
            if (status === "awake") {
                await member.setNickname(BOT_AWAKE_NAME);
            }
            else if (status === "processing") {
                await member.setNickname(BOT_PROCESSING_NAME);
            }
            else if (status === "completed") {
                await member.setNickname(BOT_NAME);
            }
        }
        catch (e) {
            console.error(`Error updating status: ${e}`);
            console.error(`Data: ${update}`);
        }
    }
}
exports.BotHelper = BotHelper;
//# sourceMappingURL=helper.js.map