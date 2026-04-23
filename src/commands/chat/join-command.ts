import { CommandInteraction, GuildMember, PermissionsString } from 'discord.js';
import { Command, CommandDeferType } from '../index.js';
import { EventData } from '../../models/internal-models.js';
import { Language } from '../../models/enum-helpers/index.js';
import { Lang } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';

import { joinVoiceChannel } from '@discordjs/voice';

export class JoinCommand implements Command {
    public names = [Lang.getRef('chatCommands.join', Language.Default)];

    public deferType = CommandDeferType.PUBLIC;

    public requireClientPerms: PermissionsString[] = ['Connect', 'Speak'];

    public async execute(intr: CommandInteraction, data: EventData): Promise<void> {
        // Get the member with voice state
        let member = intr.member;
        if (!(member instanceof GuildMember)) {
            if (!intr.guild) {
                await InteractionUtils.send(intr, "This command can only be used in a server.");
                return;
            }
            member = await intr.guild.members.fetch(intr.user.id);
        }

        const channel = member.voice?.channel;

        if (!channel) {
            await InteractionUtils.send(intr, "Join a voice channel first.");
            return;
        }

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
        });

        await InteractionUtils.send(intr, "Joined voice channel.");

        // 👇 START SIMPLE: log when people talk
        const receiver = connection.receiver;

        receiver.speaking.on('start', (userId) => {
            console.log("User speaking:", userId);
        });
    }
}