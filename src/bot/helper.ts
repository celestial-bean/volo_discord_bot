import { Client, TextChannel, GuildMember, EmbedBuilder } from 'discord.js';
import { VoloBot } from './volo_bot';

const BOT_NAME = "VOLO 💤";
const BOT_AWAKE_NAME = "VOLO 💬";
const BOT_PROCESSING_NAME = "VOLO 💡";

export class BotHelper {
  bot: VoloBot;
  guildId: string | null = null;
  ttsQueue: any = null;
  currentMusicSource: any = null;
  currentMusicSourceUrl: string | null = null;
  currentSfxSource: any = null;
  userMusicVolume: number = 0.5;
  voice: any = null;
  vc: any = null;

  constructor(bot: VoloBot) {
    this.bot = bot;
  }

  setVc(voiceClient: any): void {
    this.vc = voiceClient;
    if (voiceClient === null) {
      this.ttsQueue = null;
      this.currentMusicSource = null;
      this.currentSfxSource = null;
      return;
    }
  }

  async sendMessage(channelId: string, content: string, embed?: EmbedBuilder, tts: boolean = false): Promise<void> {
    const channel = this.bot.channels.cache.get(channelId) as TextChannel;
    if (channel) {
      await channel.send({ content, embeds: embed ? [embed] : undefined, tts });
    } else {
      console.error(`Channel with ID ${channelId} not found.`);
    }
  }

  async handlePostNode(node: any, discordChannelId: string): Promise<void> {
    await this.sendMessage(discordChannelId, node.data.text);
  }

  async handleRequestStatusUpdate(update: any): Promise<void> {
    if (this.guildId === null) {
      return;
    }

    try {
      const status = update.status;
      const guild = await this.bot.guilds.fetch(this.guildId);
      const member = await guild.members.fetch(this.bot.user!.id);

      if (status === "awake") {
        await member.setNickname(BOT_AWAKE_NAME);
      } else if (status === "processing") {
        await member.setNickname(BOT_PROCESSING_NAME);
      } else if (status === "completed") {
        await member.setNickname(BOT_NAME);
      }
    } catch (e: any) {
      console.error(`Error updating status: ${e}`);
      console.error(`Data: ${update}`);
    }
  }
}

