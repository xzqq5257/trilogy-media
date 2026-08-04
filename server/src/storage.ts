import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * 数据目录：
 * - 优先读 DATA_DIR 环境变量（云托管/Spaces 挂载点）
 * - 否则回退到源码相对路径 ../data（本地开发）
 */
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const MUSIC_DIR = path.join(DATA_DIR, 'music');
export const DB_FILE = path.join(DATA_DIR, 'db.json');

export interface VoiceSignature {
  /** index into the browser's available system voices (modded) */
  voiceIndex: number;
  /** pitch 0..2 (1 = default) */
  pitch: number;
  /** rate 0.5..2 (1 = default) */
  rate: number;
  /** tonal shift in semitones applied to generated demo audio */
  semitones: number;
  /** brightness 0..1 used for waveform colour */
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
  /** relative path under UPLOAD_DIR */
  samplePath: string;
  signature: VoiceSignature;
  /** short textual tag describing the simulated timbre */
  timbreTag: string;
  /** Path to the voice model JSON file (for voice cloning) */
  voiceModelPath?: string;
  /** Summary of voice model for display */
  voiceModel?: {
    f0_hz: number;
    centroid_hz: number;
    f1: number;
    f2: number;
    speaking_rate: number;
  };
}

export interface Book {
  id: string;
  title: string;
  author: string;
  cover: string; // emoji or color
  category: string;
  description: string;
  chapters: { title: string; content: string }[];
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  durationSec: number;
  /** relative path under MUSIC_DIR */
  path: string;
  color: string;
  mood: string;
  userUploaded?: boolean;
}

interface DB {
  voices: VoiceSource[];
  books: Book[];
  music: MusicTrack[];
}

const empty: DB = { voices: [], books: [], music: [] };

let cache: DB | null = null;

export async function ensureDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(MUSIC_DIR, { recursive: true });
}

export async function loadDB(): Promise<DB> {
  if (cache) return cache;
  let db: DB;
  try {
    const raw = await fs.readFile(DB_FILE, 'utf-8');
    db = { ...empty, ...JSON.parse(raw) };
  } catch {
    db = { ...empty };
  }
  cache = db;
  await saveDB(db);
  return db;
}

export async function saveDB(db: DB) {
  cache = db;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}
