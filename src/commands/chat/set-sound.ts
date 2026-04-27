import { ChatInputCommandInteraction, PermissionsString } from 'discord.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Language } from '../../models/enum-helpers/index.js';
import { EventData } from '../../models/internal-models.js';
import { Lang } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';
import { Command, CommandDeferType } from '../index.js';

const soundsDirectory = './assets';

function sanitizeSoundName(name: string): string {
    // Keep it simple: safe filename, no directories.
    const cleaned = name.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
    return cleaned.replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'sound';
}

async function downloadYouTubeMp3(url: string, outputPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const p = spawn(
            'yt-dlp',
            [
                url,
                '--no-playlist',
                '-x',
                '--audio-format',
                'mp3',
                '--audio-quality',
                '0',
                '-o',
                outputPath,
            ],
            { stdio: 'ignore' }
        );

        p.on('error', err => {
            reject(
                new Error(
                    `Failed to run yt-dlp. Make sure yt-dlp (and ffmpeg) are installed and on PATH. (${String(
                        err
                    )})`
                )
            );
        });

        p.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`yt-dlp exited with code ${code}`));
        });
    });
}

function isValidYouTubeUrl(raw: string): boolean {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return false;
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return false;
    }

    const host = url.hostname.toLowerCase();
    const isYouTubeHost =
        host === 'youtu.be' ||
        host === 'youtube.com' ||
        host.endsWith('.youtube.com') ||
        host === 'music.youtube.com';

    if (!isYouTubeHost) {
        return false;
    }

    // Basic sanity checks so we don't accept random youtube.com paths.
    if (host === 'youtu.be') {
        return url.pathname.length > 1;
    }

    if (url.pathname === '/watch') {
        return !!url.searchParams.get('v');
    }

    if (url.pathname.startsWith('/shorts/')) return true;
    if (url.pathname.startsWith('/live/')) return true;
    if (url.pathname.startsWith('/embed/')) return url.pathname.length > '/embed/'.length;

    return false;
}

export class SetSoundCommand implements Command {
    public names = [Lang.getRef('chatCommands.set_sound', Language.Default)];
    public deferType = CommandDeferType.HIDDEN;
    public requireClientPerms: PermissionsString[] = [];

    public async execute(intr: ChatInputCommandInteraction, _data: EventData): Promise<void> {
        const soundRaw = intr.options.getString('sound', true);
        const sound = sanitizeSoundName(soundRaw);

        const youtubeUrlRaw = intr.options.getString('youtube_url') ?? undefined;
        const youtubeUrl = youtubeUrlRaw?.trim() ? youtubeUrlRaw.trim() : undefined;

        if (youtubeUrl && !isValidYouTubeUrl(youtubeUrl)) {
            await InteractionUtils.send(
                intr,
                'Invalid YouTube URL. Please provide a `youtube.com` or `youtu.be` link to a video.',
                true
            );
            return;
        }

        if (youtubeUrl) {
            fs.mkdirSync(soundsDirectory, { recursive: true });
            const outputPath = path.join(soundsDirectory, `${sound}.mp3`);

            try {
                await downloadYouTubeMp3(youtubeUrl, outputPath);
            } catch (err) {
                await InteractionUtils.send(
                    intr,
                    `Failed to download audio: ${err instanceof Error ? err.message : String(err)}`,
                    true
                );
                return;
            }
        }

        await InteractionUtils.send(
            intr,
            `Sound "${sound}" saved${youtubeUrl ? ' from YouTube' : ''}.`,
            true
        );
    }
}

