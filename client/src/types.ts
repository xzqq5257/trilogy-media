export interface VoiceSignature {
  voiceIndex: number;
  pitch: number;
  rate: number;
  semitones: number;
  warmth: number;
}

export interface VoiceSource {
  id: string;
  name: string;
  createdAt: number;
  fileName: string;
  fileSize: number;
  mime: string;
  durationSec: number;
  samplePath: string;
  signature: VoiceSignature;
  timbreTag: string;
  matchedVoice?: string;
}

export interface BookListItem {
  id: string;
  title: string;
  author: string;
  cover: string;
  category: string;
  description: string;
  chapterCount: number;
  totalChars: number;
}

export interface Chapter {
  title: string;
  content: string;
}

export interface Book extends BookListItem {
  chapters: Chapter[];
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  path: string;
  color: string;
  mood: string;
  userUploaded?: boolean;
}
