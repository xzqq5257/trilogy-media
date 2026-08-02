import type { VoiceSignature, VoiceSource } from '../types.js';

/**
 * TTSEngine — drives audiobook playback via the browser's Web Speech API.
 *
 * Each cloned VoiceSource carries a deterministic `signature` (voiceIndex,
 * pitch, rate, semitones, warmth). The engine maps that signature onto the
 * browser's available system voices + synthesis params, so every uploaded
 * media file yields a *unique, reproducible* spoken timbre — this is the
 * "simulated voice cloning" layer.
 */
type Handlers = {
  onChunkStart?: (chunkIndex: number, text: string) => void;
  onChunkEnd?: (chunkIndex: number) => void;
  onEnd?: () => void;
  onStart?: () => void;
};

const SENTENCE_SPLIT = /[^。！？!?.…\n]+[。！？!?.…]*\s*/g;

export function splitSentences(text: string): string[] {
  const matches = text.match(SENTENCE_SPLIT);
  const out = (matches || [text]).map((s) => s.trim()).filter(Boolean);
  return out.length ? out : [text];
}

class TTSEngine {
  private synth: SpeechSynthesis | null;
  voices: SpeechSynthesisVoice[] = [];
  private current: SpeechSynthesisUtterance | null = null;
  private queue: string[] = [];
  private cursor = 0;
  private activeSig: VoiceSignature | null = null;
  private handlers: Handlers = {};
  private cancelled = false;

  constructor() {
    this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (this.synth) {
      this.refreshVoices();
      this.synth.onvoiceschanged = () => this.refreshVoices();
    }
  }

  private refreshVoices() {
    if (!this.synth) return;
    this.voices = this.synth.getVoices();
  }

  get supported() {
    return !!this.synth && this.voices.length > 0;
  }

  /** Pick a concrete system voice for a signature. Prefers zh voices. */
  private pickVoice(sig: VoiceSignature): SpeechSynthesisVoice | null {
    if (!this.voices.length) return null;
    const zh = this.voices.filter((v) => /zh|cmn|Chinese/i.test(v.lang) || /Chinese/i.test(v.name));
    const pool = zh.length ? zh : this.voices;
    return pool[sig.voiceIndex % pool.length];
  }

  get state(): 'playing' | 'paused' | 'idle' {
    if (!this.synth) return 'idle';
    if (this.synth.speaking && this.synth.paused) return 'paused';
    if (this.synth.speaking) return 'playing';
    return 'idle';
  }

  speak(text: string, voice: VoiceSource, handlers: Handlers = {}) {
    if (!this.synth) {
      handlers.onEnd?.();
      return;
    }
    this.stop();
    this.cancelled = false;
    this.handlers = handlers;
    this.activeSig = voice.signature;
    this.queue = splitSentences(text);
    this.cursor = 0;
    handlers.onStart?.();
    this.speakNext();
  }

  private speakNext() {
    if (this.cancelled) return;
    if (this.cursor >= this.queue.length) {
      this.current = null;
      this.handlers.onEnd?.();
      return;
    }
    const idx = this.cursor;
    const text = this.queue[idx];
    const u = new SpeechSynthesisUtterance(text);
    const v = this.activeSig ? this.pickVoice(this.activeSig) : null;
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    if (this.activeSig) {
      u.pitch = clamp(this.activeSig.pitch, 0.1, 2);
      u.rate = clamp(this.activeSig.rate, 0.5, 2);
    }
    u.onstart = () => this.handlers.onChunkStart?.(idx, text);
    u.onend = () => {
      this.handlers.onChunkEnd?.(idx);
      this.cursor++;
      this.speakNext();
    };
    u.onerror = () => {
      this.handlers.onChunkEnd?.(idx);
      this.cursor++;
      this.speakNext();
    };
    this.current = u;
    this.synth!.speak(u);
  }

  pause() {
    this.synth?.pause();
  }
  resume() {
    this.synth?.resume();
  }
  stop() {
    this.cancelled = true;
    this.queue = [];
    this.cursor = 0;
    this.current = null;
    this.synth?.cancel();
  }

  /** Speak a short preview snippet. */
  preview(voice: VoiceSource, text: string) {
    this.speak(text, voice, {});
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export const tts = new TTSEngine();
