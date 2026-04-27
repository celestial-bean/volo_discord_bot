import { ChatInputCommandInteraction, Client, PermissionsString } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';
import fs from 'node:fs';

var voicePath = "./voice.json";
export class SetVoiceCommand implements Command {
  public names = [Lang.getRef('chatCommands.set_voice', Language.Default)];
  public cooldown = new RateLimiter(1, 5000);
  public deferType = CommandDeferType.HIDDEN;
  public requireClientPerms: PermissionsString[] = [];

  public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
    var config;
    if (fs.existsSync(voicePath)) {
      config = JSON.parse(fs.readFileSync(voicePath, 'utf8'));
    } else {
      config = {
        selectedVoice: "The Listener",
        "The Listener": {
          "id": "",
          "speechSamples": "",
          "description": "You're are a discord bot that can speak that moderates a discord server. Play a character that best fits the situation, your personality, and style.",
        }
      };
      fs.writeFileSync(voicePath, JSON.stringify(config, null, 2), 'utf8');
    }
    config.selectedVoice = intr.options.getString('voice') || config.selectedVoice;
    const me = await intr.guild.members.fetchMe();
    await me.setNickname(config.selectedVoice);
    fs.writeFileSync(voicePath, JSON.stringify(config, null, 2));
    await InteractionUtils.send(intr, "Voice set to " + config.selectedVoice, true);
  }
}
