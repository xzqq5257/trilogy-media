import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { MUSIC_DIR } from './storage.js';
import type { MusicTrack } from './storage.js';

interface Recipe {
  id: string;
  title: string;
  artist: string;
  mood: string;
  color: string;
  durationSec: number;
  /** sine source frequencies, mixed together */
  freqs: number[];
  /** post-mix filter chain applied to the amix output */
  fx: string;
}

const RECIPES: Recipe[] = [
  {
    id: 'm-aurora',
    title: '晨曦微光',
    artist: 'Trilogy Ambient',
    mood: '晨间 · 冥想',
    color: '#f59e0b',
    durationSec: 36,
    freqs: [261, 392],
    fx: 'tremolo=f=0.2:d=0.4,aecho=0.8:0.7:60:0.3,aresample=44100',
  },
  {
    id: 'm-nighttrain',
    title: '深夜列车',
    artist: 'Trilogy Lo-Fi',
    mood: '深夜 · 助眠',
    color: '#6366f1',
    durationSec: 40,
    freqs: [174, 220],
    fx: 'tremolo=f=0.15:d=0.5,volume=0.9,aecho=0.7:0.6:120:0.25,aresample=44100',
  },
  {
    id: 'm-forest',
    title: '森林低语',
    artist: 'Trilogy Nature',
    mood: '专注 · 白噪音',
    color: '#10b981',
    durationSec: 38,
    freqs: [293, 440, 587],
    fx: 'tremolo=f=0.3:d=0.2,volume=0.7,aresample=44100',
  },
  {
    id: 'm-galaxy',
    title: '星河漫步',
    artist: 'Trilogy Space',
    mood: '太空 · 漂浮',
    color: '#ec4899',
    durationSec: 42,
    freqs: [196, 246],
    fx: 'tremolo=f=0.1:d=0.6,aecho=0.85:0.75:200:0.4,volume=0.85,aresample=44100',
  },
];

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-y', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code + '\n' + err.slice(-400)))));
    p.on('error', reject);
  });
}

/** Generate the demo procedural music tracks once, if missing. */
export async function ensureDemoMusic(): Promise<MusicTrack[]> {
  const tracks: MusicTrack[] = [];
  for (const r of RECIPES) {
    const file = `${r.id}.mp3`;
    const full = path.join(MUSIC_DIR, file);
    const exists = await fs.stat(full).then(() => true).catch(() => false);
    if (!exists) {
      const inputs: string[] = [];
      for (const f of r.freqs) {
        inputs.push('-f', 'lavfi', '-i', `sine=frequency=${f}:duration=${r.durationSec}`);
      }
      const labels = r.freqs.map((_, i) => `[${i}:a]`).join('');
      const filter = `${labels}amix=inputs=${r.freqs.length},${r.fx}`;
      await runFfmpeg([
        ...inputs,
        '-filter_complex', filter,
        '-t', String(r.durationSec),
        '-ac', '2', '-b:a', '128k',
        full,
      ]);
    }
    tracks.push({
      id: r.id,
      title: r.title,
      artist: r.artist,
      durationSec: r.durationSec,
      path: `music/${file}`,
      color: r.color,
      mood: r.mood,
    });
  }
  return tracks;
}
