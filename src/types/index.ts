// Type definitions for the bot

export interface PlayerMap {
  [userId: string]: {
    player: string;
    character: string;
  };
}

export interface TranscriptionEntry {
  date?: string;
  begin?: string;
  end?: string;
  user_id?: string | number;
  player?: string;
  character?: string;
  event_source?: string;
  data?: string;
}

export interface Speaker {
  user: string;
  player: string | undefined;
  character: string | undefined;
  data: Buffer[];
  firstWord: number;
  lastWord: number;
  newBytes: number;
}

export interface WhisperSinkOptions {
  dataLength?: number;
  maxSpeakers?: number;
  transcriberType?: string;
  playerMap?: PlayerMap;
}

