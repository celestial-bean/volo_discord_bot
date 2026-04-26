import { ChatInputCommandInteraction, Collection, GuildMember, PermissionsString } from 'discord.js';
import fs from 'fs';
import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class UpdatePlayerMapCommand implements Command {
    public names = [Lang.getRef('chatCommands.update_player_map', Language.Default)];
    public deferType = CommandDeferType.PUBLIC;
    public requireClientPerms: PermissionsString[] = ['Administrator'];

    public async execute(intr: ChatInputCommandInteraction, data: EventData): Promise<void> {
        console.log('updatePlayerMapCommand executed');
        //var members: Collection<string, GuildMember>= intr.guild.members.cache;
        var members: Collection<string, GuildMember>= await intr.guild.members.fetch();
        var playerMap: { [key: string]: string } = {};
        for (const member of members.values()) {
            //console.log(member.user.displayName);
            playerMap[member.user.displayName] = member.user.id;
        }
        fs.writeFileSync("./player-map.json", JSON.stringify(playerMap, null, 2));
        await InteractionUtils.send(intr, "Player map updated",true);
    }
}
