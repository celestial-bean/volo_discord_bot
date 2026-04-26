import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';
import { RateLimiter } from 'discord.js-rate-limiter';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';
import fs from 'node:fs';
import { config } from 'node:process';
var voicePath="../voice.json";
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
            config = { voice: null }; // pick your defaults
            fs.writeFileSync(voicePath, JSON.stringify(config, null, 2), 'utf8');
          }
        config.voice = intr.options.getString('voice') || config.voice;
        fs.writeFileSync(voicePath, JSON.stringify(config, null, 2));
        await InteractionUtils.send(intr, "Voice set to " + config.voice, true);
    }
}
