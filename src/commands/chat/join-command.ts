import { CommandInteraction, GuildMember, PermissionsString } from 'discord.js';
import { Command, CommandDeferType } from '../index.js';
import { EventData } from '../../models/internal-models.js';
import { Language } from '../../models/enum-helpers/index.js';
import { Lang } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';

import { joinVoiceChannel, VoiceConnectionStatus, entersState } from '@discordjs/voice';

export class JoinCommand implements Command {
    public names = [Lang.getRef('chatCommands.join', Language.Default)];

    public deferType = CommandDeferType.PUBLIC;

    public requireClientPerms: PermissionsString[] = ['Connect', 'Speak'];

    public async execute(intr: CommandInteraction, data: EventData): Promise<void> {
        // Get the member with voice state
        let member = intr.member;
        if (!(member instanceof GuildMember)) {
            if (!intr.guild) {
                await InteractionUtils.send(intr, "This command can only be used in a server.", true);
                return;
            }
            member = await intr.guild.members.fetch(intr.user.id);
            
        }

        const channel = member.voice?.channel;
        
        console.log("Member voice channel:", channel?.id, channel?.name);
        if (!channel) {
            await InteractionUtils.send(intr, "Join a voice channel first.", true);
            return;
        }

        const botMember = channel.guild.members.me;
        const botPermissions = botMember?.permissionsIn(channel);
        console.log("Bot voice permissions:", botPermissions?.toArray());
        if (!botPermissions?.has('Connect') || !botPermissions?.has('Speak')) {
            await InteractionUtils.send(
                intr,
                "I don't have permission to join and speak in that voice channel.",
                true
            );
            return;
        }

        console.log(`Joining voice channel: ${channel.name} (${channel.id}) in guild: ${channel.guild.name} (${channel.guild.id})`);

        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guild.id,
            adapterCreator: channel.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false,
        });

        connection.on('stateChange', (oldState, newState) => {
            console.log(`Voice connection state: ${oldState.status} -> ${newState.status}`);
        });

        connection.on('error', (error) => {
            console.error('Voice connection error:', error);
        });

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 10000);
            console.log('Voice connection is ready.');
        } catch (error) {
            console.error('Voice connection failed to become ready:', error);
            await InteractionUtils.send(
                intr,
                'Joined command started, but the voice connection did not become ready. Check bot voice permissions and intents.',
                true
            );
            return;
        }

        await InteractionUtils.send(intr, "Joined voice channel.", true);

        // 👇 START SIMPLE: log when people talk
        const receiver = connection.receiver;
        if (!receiver) {
            console.warn('No voice receiver available on connection.');
            return;
        }

        receiver.speaking.on('start', async (userId) => {
            const speakingMember = await channel.guild.members.fetch(userId).catch(() => null);
            console.log(
                `User started speaking: ${speakingMember?.user.tag ?? userId} (${userId}) in ${channel.name}`
            );
        });

        receiver.speaking.on('end', async (userId) => {
            const speakingMember = await channel.guild.members.fetch(userId).catch(() => null);
            console.log(
                `User stopped speaking: ${speakingMember?.user.tag ?? userId} (${userId}) in ${channel.name}`
            );
        });
    }
}