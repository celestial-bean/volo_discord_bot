import { AttachmentBuilder, ChatInputCommandInteraction, PermissionsString } from 'discord.js';
import fs from 'node:fs';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

export class GenerateTranscriptCommand implements Command {
    public names = [Lang.getRef('chatCommands.generate_transcript', Language.Default)];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        const transcriptPath = './recordings/transcripts.log';
        if (!fs.existsSync(transcriptPath)) {
            await InteractionUtils.send(intr, 'No transcript log found yet.', true);
            return;
        }

        const text = fs.readFileSync(transcriptPath, 'utf8');
        if (!text.trim()) {
            await InteractionUtils.send(intr, 'Transcript log is empty.', true);
            return;
        }

        const attachment = new AttachmentBuilder(Buffer.from(text, 'utf8'), {
            name: `transcript-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
        });

        await InteractionUtils.send(
            intr,
            {
                content: 'Here is the current transcript log.',
                files: [attachment],
            },
            true
        );
    }
}

