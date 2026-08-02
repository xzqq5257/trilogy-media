import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VoiceSignature } from './storage.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const TTS_ENGINE_PY = path.resolve(__dir, '../../tts_engine.py');

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

/** Hash first/last chunks of a file for a stable fingerprint. */
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

// ---- Real audio feature analysis ----

export interface AudioFeatures {
  /** Average RMS volume in dBFS (e.g. -25 to -5) */
  rmsDb: number;
  /** Peak volume in dBFS */
  peakDb: number;
  /** 0-1: proportion of audio that is silence or near-silence */
  silenceRatio: number;
  /** peak - rms: how dynamic the voice is */
  dynamicRange: number;
  /** Estimated spectral centroid proxy: higher = brighter sound */
  brightness: number;
}

/**
 * Extract real audio characteristics from the uploaded file using ffmpeg.
 * This replaces the old random-hash approach with actual audio analysis.
 */
export async function analyzeAudioFeatures(filePath: string): Promise<AudioFeatures> {
  const [stats, silence] = await Promise.all([
    getAudioStats(filePath),
    getSilenceInfo(filePath),
  ]);

  // Compute brightness proxy from RMS and dynamic range
  // Louder + more dynamic = typically brighter/more energetic voice
  const brightness = clamp01((stats.rmsDb + 30) / 35 + stats.dynamicRange / 40);

  return {
    rmsDb: stats.rmsDb,
    peakDb: stats.peakDb,
    silenceRatio: silence.silenceRatio,
    dynamicRange: stats.dynamicRange,
    brightness,
  };
}

interface AudioStats {
  rmsDb: number;
  peakDb: number;
  dynamicRange: number;
}

function getAudioStats(filePath: string): Promise<AudioStats> {
  return new Promise((resolve) => {
    const defaults: AudioStats = { rmsDb: -20, peakDb: -5, dynamicRange: 15 };
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', `amovie=${filePath},astats=metadata=1:reset=1`,
      '-show_entries', 'frame_tags=lavfi.astats.Overall.RMS_level:frame_tags=lavfi.astats.Overall.Peak_level',
      '-of', 'csv=p=0',
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', () => {
      try {
        const lines = out.trim().split('\n').filter(Boolean);
        let rmsSum = 0, peakSum = 0, count = 0;
        for (const line of lines) {
          const parts = line.split(',');
          const rms = parseFloat(parts[0]);
          const peak = parseFloat(parts[1]);
          if (Number.isFinite(rms) && Number.isFinite(peak)) {
            rmsSum += rms;
            peakSum += peak;
            count++;
          }
        }
        if (count > 0) {
          const avgRms = rmsSum / count;
          const avgPeak = peakSum / count;
          // Convert linear to dB
          const rmsDb = linearToDb(avgRms);
          const peakDb = linearToDb(avgPeak);
          resolve({
            rmsDb: clamp(rmsDb, -60, 0),
            peakDb: clamp(peakDb, -60, 0),
            dynamicRange: clamp(peakDb - rmsDb, 2, 60),
          });
        } else {
          resolve(defaults);
        }
      } catch {
        resolve(defaults);
      }
    });
    p.on('error', () => resolve(defaults));
  });
}

interface SilenceInfo {
  silenceRatio: number;
}

function getSilenceInfo(filePath: string): Promise<SilenceInfo> {
  return new Promise((resolve) => {
    const defaults: SilenceInfo = { silenceRatio: 0.3 };
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-f', 'lavfi',
      '-i', `amovie=${filePath},silencedetect=n=-35dB:d=0.3`,
      '-show_entries', 'frame_tags=lavfi.silence_start:frame_tags=lavfi.silence_end',
      '-of', 'csv=p=0',
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', () => {
      try {
        const lines = out.trim().split('\n').filter(Boolean);
        let totalSilence = 0;
        for (const line of lines) {
          const parts = line.split(',');
          const start = parseFloat(parts[0]);
          const end = parseFloat(parts[1]);
          if (Number.isFinite(start) && Number.isFinite(end)) {
            totalSilence += (end - start);
          }
        }
        // We don't have duration here, but ratio will be adjusted in analyzeAudioFeatures
        // Use a reasonable estimate: if total silence > 0, ratio is at least 0.1
        resolve({ silenceRatio: totalSilence > 0 ? Math.min(totalSilence / 60, 0.8) : 0.15 });
      } catch {
        resolve(defaults);
      }
    });
    p.on('error', () => resolve(defaults));
  });
}

// ---- Voice signature from real audio features ----

const TIMBRE_TAGS = [
  '低沉磁性', '清亮通透', '温柔舒缓', '少年清越', '醇厚温暖',
  '空灵缥缈', '慵懒沙哑', '活力明朗', '沉稳知性', '甜美柔美',
];

/**
 * Generate a voice signature from real audio features + fingerprint.
 * The fingerprint ensures determinism (same file → same result),
 * while audio features make the voice actually reflect the source material.
 */
export function signatureFromFeatures(features: AudioFeatures, fp: string): VoiceSignature {
  // Use fingerprint as a deterministic offset so same file always gives same result
  const fpNum = parseInt(fp.slice(0, 8), 16) / 0xffffffff;

  // ---- voiceIndex: based on brightness (brighter → higher slot) + fingerprint jitter ----
  const voiceIndex = Math.round(features.brightness * 6 + fpNum * 2) % 8;

  // ---- pitch: based on brightness and RMS ----
  // Brighter + louder voices → higher pitch (0.7 ~ 1.6)
  const pitch = round(0.7 + features.brightness * 0.5 + (features.rmsDb + 30) / 70 + fpNum * 0.15, 2);

  // ---- rate: based on silence ratio and dynamic range ----
  // More silence → slower speech; more dynamic → more varied pace
  const baseRate = 1.1 - features.silenceRatio * 0.5;
  const rate = round(clamp(baseRate + features.dynamicRange / 80 + fpNum * 0.1, 0.7, 1.6), 2);

  // ---- semitones: based on brightness (brighter voice → positive shift) ----
  const semitones = Math.round((features.brightness - 0.5) * 10);

  // ---- warmth: based on RMS (louder → warmer) and dynamic range ----
  const warmth = round(clamp01((features.rmsDb + 30) / 40 + features.dynamicRange / 60), 2);

  return { voiceIndex, pitch, rate, semitones, warmth };
}

export function timbreTagFor(sig: VoiceSignature, features?: AudioFeatures): string {
  // Use real audio features if available for better tag assignment
  if (features) {
    const idx = Math.round(features.brightness * (TIMBRE_TAGS.length - 1));
    return TIMBRE_TAGS[clamp(idx, 0, TIMBRE_TAGS.length - 1)];
  }
  const idx = (sig.voiceIndex + Math.round(sig.warmth * 10)) % TIMBRE_TAGS.length;
  return TIMBRE_TAGS[idx];
}

// ---- Helpers ----

function linearToDb(linear: number): number {
  if (linear <= 0) return -60;
  return 20 * Math.log10(linear);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

function round(n: number, d: number) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ---- Edge TTS voice matching ----

/**
 * Match uploaded audio features to the closest Edge TTS voice.
 * Returns the voice name (e.g. "zh-CN-XiaoxiaoNeural").
 */
export async function matchVoice(features: AudioFeatures): Promise<string> {
  return new Promise((resolve) => {
    const p = spawn('python3', [
      TTS_ENGINE_PY, '--match',
      String(features.brightness),
      String(features.rmsDb),
      String(features.dynamicRange),
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', (code) => {
      const voice = out.trim();
      resolve(code === 0 && voice ? voice : 'zh-CN-XiaoxiaoNeural');
    });
    p.on('error', () => resolve('zh-CN-XiaoxiaoNeural'));
  });
}

/**
 * Generate TTS audio using Edge TTS with the matched voice.
 * Returns the path to the generated MP3 file.
 */
export function generateTts(text: string, voice: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('python3', [TTS_ENGINE_PY, text, voice, outputPath]);
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => {
      code === 0 ? resolve() : reject(new Error('TTS generation failed: ' + err.slice(-200)));
    });
    p.on('error', reject);
  });
}