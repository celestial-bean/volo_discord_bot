import { VoloBot } from '../bot/volo_bot';
import { OpenAI } from 'openai';
import { Speaker } from '../types';
import { WhisperSinkOptions } from '../types';
export declare class WhisperSink {
    transcriptionOutputQueue: any[];
    loop: any;
    dataLength: number;
    maxSpeakers: number;
    transcriberType: string;
    vc: any;
    audioData: Map<string, Buffer[]>;
    running: boolean;
    speakers: Speaker[];
    voiceQueue: any[];
    playerMap: {
        [key: string]: {
            player: string;
            character: string;
        };
    };
    bot: VoloBot;
    members: any;
    memory: string[];
    guild: any;
    generalChat: any;
    listenerChannel: any;
    botLogChannel: any;
    voiceThread: NodeJS.Timeout | null;
    client: OpenAI | null;
    constructor(transcriptQueue: any[], bot: VoloBot, options?: WhisperSinkOptions);
    convertName(arg: string, nameDictionary: {
        [key: string]: string;
    }): string | null;
    log(str: string, ...args: any[]): Promise<void>;
    startVoiceThread(onException?: (e: any) => void): void;
    stopVoiceThread(): void;
    checkAudioLength(audioBuffer: Buffer): number;
    transcribeAudio(audioBuffer: Buffer): Promise<string>;
    transcribe(speaker: Speaker): Promise<string>;
    delayRemoveRole(member: any, role: any, delay: number): Promise<void>;
    insertVoice(): Promise<void>;
    processTranscription(speaker: Speaker, transcription: string): Promise<void>;
    writeTranscriptionLog(speaker: Speaker, transcription: string): void;
    write(data: Buffer, userId: string): void;
    close(): void;
}
//# sourceMappingURL=whisper_sink.d.ts.map