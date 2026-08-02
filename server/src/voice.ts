import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { VoiceSignature } from './storage.js';

/** Probe media duration & mime-ish info via ffprobe. */
export function probeMedia(filePath: string): Promise<{ durationSec: number; mime: string }> {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:format=format_name',
      '-of', 'default=noprint_wrappers=1',
      filePath,
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', () => {
      const duration = parseFloat((out.match(/duration=([0-9.]+)/) || [])[1] || '0');
      const formatName = (out.match(/format_name=([^\n\r]+)/) || [])[1] || '';
      const mime = guessMime(formatName, filePath);
      resolve({ durationSec: Number.isFinite(duration) ? duration : 0, mime });
    });
    p.on('error', () => resolve({ durationSec: 0, mime: guessMime('', filePath) }));
  });
}

function guessMime(formatName: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const byExt: Record<string, string> = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
    '.webm': 'video/webm', '.avi': 'video/x-msvideo',
  };
  if (byExt[ext]) return byExt[ext];
  if (formatName.includes('mp4')) return 'video/mp4';
  if (formatName.includes('matroska')) return 'video/x-matroska';
  if (formatName.includes('mp3')) return 'audio/mpeg';
  if (formatName.includes('wav')) return 'audio/wav';
  return 'application/octet-stream';
}

/** Hash first/last chunks of a file for a stable fingerprint without reading huge files fully. */
export async function fileFingerprint(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  const h = createHash('sha1');
  h.update(`${stat.size}:`);
  const fd = await fs.open(filePath, 'r');
  const head = Buffer.alloc(64 * 1024);
  await fd.read(head, 0, head.length, 0);
  h.update(head);
  if (stat.size > 128 * 1024) {
    const tail = Buffer.alloc(64 * 1024);
    await fd.read(tail, 0, tail.length, stat.size - tail.length);
    h.update(tail);
  }
  await fd.close();
  return h.digest('hex');
}

const TIMBRE_TAGS = [
  '低沉磁性', '清亮通透', '温柔舒缓', '少年清越', '醇厚温暖',
  '空灵缥缈', '慵懒沙哑', '活力明朗', '沉稳知性', '甜美柔美',
];

/**
 * Derive a deterministic, unique-feeling voice signature from a fingerprint.
 * This *simulates* voice cloning: the uploaded media seeds a stable set of
 * synthesis parameters (browser voice slot, pitch, rate, tonal shift, warmth).
 */
export function signatureFromFingerprint(fp: string): VoiceSignature {
  // Pull several integers out of the hash.
  const int = (offset: number, mod: number) => {
    const slice = fp.slice(offset * 8, offset * 8 + 8);
    return parseInt(slice || '0', 16) % mod;
  };

  const voiceIndex = int(0, 8);          // up to 8 voice slots on the client
  const pitch = 0.6 + (int(1, 80) / 100); // 0.6 .. 1.39
  const rate = 0.8 + (int(2, 80) / 100);  // 0.8 .. 1.59
  const semitones = (int(3, 13) - 6);     // -6 .. +6
  const warmth = int(4, 100) / 100;       // 0 .. 0.99

  return { voiceIndex, pitch: round(pitch, 2), rate: round(rate, 2), semitones, warmth: round(warmth, 2) };
}

export function timbreTagFor(sig: VoiceSignature): string {
  const idx = (sig.voiceIndex + Math.round(sig.warmth * 10)) % TIMBRE_TAGS.length;
  return TIMBRE_TAGS[idx];
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
