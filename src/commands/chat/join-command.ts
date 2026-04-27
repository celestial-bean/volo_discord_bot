import { CommandInteraction, Guild, GuildMember, PermissionsString, User } from 'discord.js';
import { Command, CommandDeferType } from '../index.js';
import { EventData } from '../../models/internal-models.js';
import { Language } from '../../models/enum-helpers/index.js';
import { Lang } from '../../services/index.js';
import { InteractionUtils } from '../../utils/index.js';
import prism from 'prism-media';
import fs from 'fs';
import { execSync, spawn } from 'child_process';
import OpenAI from 'openai';
import { createRequire } from 'module';
import { ElevenLabsClient, stream } from '@elevenlabs/elevenlabs-js';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
const require = createRequire(import.meta.url);
const config = require('../../../config/config.json');

import {
    AudioPlayerStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    EndBehaviorType,
    joinVoiceChannel,
    StreamType,
    VoiceConnection,
    VoiceConnectionStatus,
    VoiceReceiver,
} from '@discordjs/voice';

type ActiveStream = {
    opusStream: NodeJS.ReadableStream;
    pcmStream: NodeJS.ReadableStream;
    file: fs.WriteStream;
    filePath: string;
};

const activeStreams = new Map<string, ActiveStream>();
let recordingsCleared = false;

const openai = new OpenAI({
    apiKey: config.api.openaiApiKey,
});

const ELEVENLABS_API_KEY = config.api.elevenlabsKey;

type PlayerMap = Record<string, string>;
let playerMapCache: PlayerMap | null = null;

async function chatGptRequest(prompt: string, model: string='gpt-4.1-mini', max_tokens: number = 200, voice: string=""): Promise<string> {
    const voiceData = JSON.parse(fs.readFileSync('./voice.json', 'utf8'))[voice];
    const speechSamples = voiceData?.speechSamples;
    const voiceDescription = voiceData?.description;
    const response = await openai.chat.completions.create({
                model: model,
                messages: [
                    { role: "user", content: 
                        voiceDescription+"; "+
                        prompt+
                        "; Use the following speech patterns from the samples: "+speechSamples
                    },
                ],
                max_tokens: max_tokens,
            });
            const message = response.choices[0].message?.content;
            console.log(`OpenAI response: ${message}`);   
            return message;
}

function getPlayerMap(): PlayerMap {
    if (playerMapCache) {
        return playerMapCache;
    }
    playerMapCache = JSON.parse(fs.readFileSync('./player-map.json', 'utf8')) as PlayerMap;
    return playerMapCache;
}

function clearRecordingsDir(): void {
    if (recordingsCleared) return;

    const recordingsPath = './recordings';
    if (fs.existsSync(recordingsPath)) {
        try {
            fs.rmSync(recordingsPath, { recursive: true, force: true });
        } catch (err) {
            console.error('Failed to clear recordings directory:', err);
        }
    }
    fs.mkdirSync(recordingsPath, { recursive: true });
    recordingsCleared = true;
}

async function transcribeAudio(pcmFilePath: string, wavFilePath: string): Promise<string | null> {
    try {
        // Convert PCM to WAV using ffmpeg
        // execSync(`ffmpeg -f s16le -ar 48000 -ac 2 -i "${pcmFilePath}" "${wavFilePath}" -y`, {
        //     stdio: 'pipe'
        // });
        await new Promise<void>((resolve, reject) => {
            const p = spawn('ffmpeg', [
                '-f',
                's16le',
                '-ar',
                '48000',
                '-ac',
                '2',
                '-i',
                pcmFilePath,
                wavFilePath,
                '-y',
            ]);

            p.on('error', reject);

            p.on('close', code => {
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg exited with code ${code}`));
            });
        });
        await new Promise((resolve, reject) => {
            const p = spawn('whisper', [
                wavFilePath,
                '--model',
                'small',
                '--output_format',
                'txt',
                '--device',
                'cuda',
                '--output_dir',
                './recordings',
            ]);

            p.on('error', reject);
            p.on('close', code => {
                if (code === 0) resolve(void 0);
                else reject(new Error(`Whisper exited with code ${code}`));
            });
        });

        // Read the transcription result
        const textFilePath = wavFilePath.replace('.wav', '.txt');
        const transcript = fs.readFileSync(textFilePath, 'utf-8').trim();

        // Cleanup
        fs.unlinkSync(pcmFilePath);
        fs.unlinkSync(wavFilePath);
        fs.unlinkSync(textFilePath);

        return transcript;
    } catch (error) {
        console.error('Transcription error:', error);
        // Cleanup on error
        if (fs.existsSync(pcmFilePath)) fs.unlinkSync(pcmFilePath);
        if (fs.existsSync(wavFilePath)) fs.unlinkSync(wavFilePath);
        return null;
    }
}

function logTranscript(userTag: string, transcript: string): void {
    try {
        const logDirectory = './recordings';
        fs.mkdirSync(logDirectory, { recursive: true });
        const logPath = `${logDirectory}/transcripts.log`;
        const timestamp = new Date().toISOString();
        const line = `${timestamp} | ${userTag} | ${transcript.replace(/\r?\n/g, ' ')}\n`;
        fs.appendFileSync(logPath, line, { encoding: 'utf-8' });
    } catch (err) {
        console.error('Failed to write transcript log:', err);
    }
}

async function synthesizeSpeech(text: string, outputPath: string): Promise<void> {
    const sanitized = text.replace(/'/g, "''").replace(/\r?\n/g, ' ');
    const voice = JSON.parse(fs.readFileSync('./voice.json', 'utf8')).selectedVoice;
    if (voice == "The Listener") {
        const command = `Add-Type -AssemblyName System.speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${outputPath}'); $s.Speak('${sanitized}'); $s.Dispose();`;
        execSync(`powershell.exe -NoProfile -Command "${command}"`, { stdio: 'pipe' });
    } else {
        if (!ELEVENLABS_API_KEY) {
            throw new Error('Missing ELEVENLABS_API_KEY in environment variables');
        }
        const ff = spawn('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            'pipe:0',
            '-filter:a',
            'volume=2.0', // 2x louder; try 1.5, 3.0, etc
            '-y',
            outputPath,
        ]);
        const elevenlabs = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });
        const audio = await elevenlabs.textToSpeech.convert(voice, {
            text: text,
            modelId: 'eleven_multilingual_v2',
            outputFormat: 'mp3_44100_128',
        });
        const nodeAudio = Readable.fromWeb(audio as unknown as globalThis.ReadableStream);
        await pipeline(nodeAudio, ff.stdin);
        await new Promise<void>((resolve, reject) => {
            ff.on('error', reject);
            ff.on('close', code =>
                code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
            );
        });
    }
}

async function speakText(connection: VoiceConnection, text: string): Promise<void> {
    const outputPath = `./recordings/tts-${Date.now()}.wav`;
    try {
        await synthesizeSpeech(text, outputPath);
        playSound(connection, outputPath, true);
    } catch (error) {
        console.error('Text-to-speech error:', error);
        if (fs.existsSync(outputPath)) {
            try {
                fs.unlinkSync(outputPath);
            } catch {
                // ignore cleanup failure
            }
        }
    }
}

function playSound(connection: VoiceConnection, filePath: string, cleanup = false): void {
    if (!fs.existsSync(filePath)) {
        console.warn(`Sound file does not exist: ${filePath}`);
        return;
    }

    const player = createAudioPlayer();
    const resource = createAudioResource(fs.createReadStream(filePath), {
        inputType: StreamType.Arbitrary,
    });

    player.play(resource);
    connection.subscribe(player);

    player.on(AudioPlayerStatus.Idle, () => {
        console.log(`Finished playing sound: ${filePath}`);
        if (cleanup && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                console.error(`Failed to delete playback file: ${filePath}`, err);
            }
        }
    });

    player.on('error', error => {
        console.error(`Audio player error for ${filePath}:`, error);
        if (cleanup && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                console.error(`Failed to delete playback file after error: ${filePath}`, err);
            }
        }
    });
}

interface TranscriptRule {
    userFilter?: (user: User) => boolean;
    contentFilter: RegExp;
    action: (user: User, transcript: string, connection?: VoiceConnection, guild?: Guild) => void;
}

const transcriptRules: TranscriptRule[] = [
    {
        contentFilter: /summarize this/i,
        action: async (user, transcript, connection) => {
            console.log(`Trigger matched for ${user.tag}: summarize request -> ${transcript}`);
            var text: string = fs.readFileSync(`./recordings/transcripts.log`, 'utf8');
            text = text.split('\n').slice(-100).join('\n'); //get last 100 lines
            var message: string =await chatGptRequest(`Please summarize this transcript: ${text}`);
            speakText(connection!, message || "Sorry, I couldn't generate a summary.");
        },
    },
    {
        contentFilter: /\b(?:dig(?:gin|ging) in (?:yo|your) butt)\b/i,
        action: async (user, transcript, connection) => {
            console.log(`Trigger matched for ${user.tag}: butt-related phrase -> ${transcript}`);
            playSound(connection!, './assets/diggin_in_yo_butt.mp3');
        },
    },
    {
        contentFilter: /hey[\s\S]*(clanker|listener|bot|bob)[\s\S]*kick/i,
        action: async (user, transcript, connection, guild: Guild) => {
            console.log(`Trigger matched for ${user.tag}: kick command -> ${transcript}`);
            var playerId;
            const playerMap = getPlayerMap();
            const match = transcript.match(/kick\s+(.+?)\.?$/i);
            const targetUser = match?.[1]?.toLowerCase();
            console.log('Target: ' + targetUser);
            const found = Object.keys(playerMap).find(name =>
                name.toLowerCase().includes(targetUser)
            );
            if (found) {
                playerId = playerMap[found];
            }

            if (playerId) {
                var player: GuildMember = await guild.members.fetch(playerId);
                await player.voice.disconnect();
            }
        },
    },
    {
        contentFilter: /shut up/i,
        action: async (user, transcript, connection, guild: Guild) => {
            console.log(`Trigger matched for ${user.tag}: shutup command -> ${transcript}`);
            var playerId;
            const playerMap = getPlayerMap();
            const match = transcript.match(/shut up\s+(.+?)\.?$/i);
            const targetUser = match?.[1]?.toLowerCase();
            console.log('Target: ' + targetUser);
            const found = Object.keys(playerMap).find(name =>
                name.toLowerCase().includes(targetUser)
            );
            if (found) {
                playerId = playerMap[found];
            }

            if (playerId) {
                const timeoutRole = config.roles.shutup;
                var player: GuildMember = await guild.members.fetch(playerId);
                player.roles.add(timeoutRole);
                console.log('Muted ' + targetUser);
                await new Promise(r => setTimeout(r, 30000));
                console.log('Unmuting ' + targetUser);
                player.roles.remove(timeoutRole);
            }
        },
    },
];

function handleTranscriptTriggers(
    user: User,
    transcript: string,
    connection?: VoiceConnection,
    guild?: Guild
): void {
    for (const rule of transcriptRules) {
        if (rule.userFilter && !rule.userFilter(user)) continue;
        if (!rule.contentFilter.test(transcript)) continue;

        try {
            rule.action(user, transcript, connection, guild);
        } catch (error) {
            console.error(`Transcript rule error for ${user.tag}:`, error);
        }
    }
}

export class JoinCommand implements Command {
    public names = [Lang.getRef('chatCommands.join', Language.Default)];

    public deferType = CommandDeferType.HIDDEN;

    public requireClientPerms: PermissionsString[] = ['Connect', 'Speak'];

    public async execute(intr: CommandInteraction, data: EventData): Promise<void> {
        // Get the member with voice state
        let member = intr.member;
        if (!(member instanceof GuildMember)) {
            if (!intr.guild) {
                await InteractionUtils.send(
                    intr,
                    'This command can only be used in a server.',
                    true
                );
                return;
            }
            member = await intr.guild.members.fetch(intr.user.id);
        }

        const channel = member.voice?.channel;
        clearRecordingsDir();

        console.log('Member voice channel:', channel?.id, channel?.name);
        if (!channel) {
            await InteractionUtils.send(intr, 'Join a voice channel first.', true);
            return;
        }

        const botMember = channel.guild.members.me;
        const botPermissions = botMember?.permissionsIn(channel);
        console.log('Bot voice permissions:', botPermissions?.toArray());
        if (!botPermissions?.has('Connect') || !botPermissions?.has('Speak')) {
            await InteractionUtils.send(
                intr,
                "I don't have permission to join and speak in that voice channel.",
                true
            );
            return;
        }

        console.log(
            `Joining voice channel: ${channel.name} (${channel.id}) in guild: ${channel.guild.name} (${channel.guild.id})`
        );

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

        connection.on('error', error => {
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

        await InteractionUtils.send(intr, 'Joined voice channel.', true);

        // 👇 START SIMPLE: log when people talk
        const receiver = connection.receiver;
        if (!receiver) {
            console.warn('No voice receiver available on connection.');
            return;
        }

        receiver.speaking.on('start', async (userId: string) => {
            if (activeStreams.has(userId)) return;

            const speakingMember = await channel.guild.members.fetch(userId).catch(() => null);
            console.log(`START: ${speakingMember?.user.tag ?? userId}`);

            const opusStream = receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 1000,
                },
            });

            const decoder = new prism.opus.Decoder({
                frameSize: 960,
                channels: 2,
                rate: 48000,
            });

            const pcmStream = opusStream.pipe(decoder);

            // Ensure recordings directory exists
            fs.mkdirSync('./recordings', { recursive: true });
            const filePath = `./recordings/${userId}-${Date.now()}.pcm`;
            const file = fs.createWriteStream(filePath);
            pcmStream.pipe(file);

            activeStreams.set(userId, { opusStream, pcmStream, file, filePath });

            opusStream.on('end', () => {
                console.log(`END: ${speakingMember?.user.tag ?? userId}`);

                const active = activeStreams.get(userId);
                if (!active) {
                    return;
                }

                const { file: activeFile, filePath: activePath } = active;
                const wavFilePath = activePath.replace('.pcm', '.wav');

                const transcriptUser = speakingMember?.user;
                const userTag = transcriptUser?.displayName ?? userId;
                const startTranscription = async () => {
                    try {
                        const transcript = await transcribeAudio(activePath, wavFilePath);
                        if (transcript) {
                            console.log(`Transcription for ${userTag}: ${transcript}`);
                            logTranscript(userTag, transcript);
                            if (transcriptUser) {
                                handleTranscriptTriggers(
                                    transcriptUser,
                                    transcript,
                                    connection,
                                    intr.guild
                                );
                            } else {
                                console.warn(
                                    `No full User object available for ${userTag}; skipping triggers.`
                                );
                            }
                        } else {
                            console.warn(`Failed to transcribe audio for ${userTag}`);
                        }
                    } catch (err) {
                        console.error(`Transcription error for ${userTag}:`, err);
                    }
                };

                if (activeFile.writableFinished) {
                    void startTranscription();
                } else {
                    activeFile.once('finish', () => {
                        void startTranscription();
                    });
                }

                activeStreams.delete(userId);
            });

            opusStream.on('error', (err: Error) => {
                console.error(`Stream error for ${userId}:`, err);
                activeStreams.delete(userId);
            });
        });

        receiver.speaking.on('end', async userId => {
            const speakingMember = await channel.guild.members.fetch(userId).catch(() => null);
            console.log(
                `User stopped speaking: ${speakingMember?.user.tag ?? userId} (${userId}) in ${channel.name}`
            );
        });
    }
}
