import { api } from '../api.js';
import type { VoiceSignature, VoiceSource } from '../types.js';

/**
 * TTSEngine — uses server-side Edge TTS for natural voice synthesis.
 *
 * Instead of the browser's Web Speech API (which has limited voices and
 * can't clone voices), this engine sends text to the server which uses
 * Microsoft Edge TTS with a voice matched to the uploaded audio sample.
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
  private audio: HTMLAudioElement | null = null;
  private queue: string[] = [];
  private cursor = 0;
  private activeVoiceId: string | null = null;
  private handlers: Handlers = {};
  private cancelled = false;
  private isPlaying = false;

  // Web Audio API for EQ post-processing
  private audioCtx: AudioContext | null = null;
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;

  get supported() {
    return typeof window !== 'undefined';
  }

  get state(): 'playing' | 'paused' | 'idle' {
    if (this.isPlaying) {
      return this.audio?.paused ? 'paused' : 'playing';
    }
    return 'idle';
  }

  private setupAudioChain(sig: VoiceSignature) {
    this.teardownAudioChain();

    this.audioCtx = new AudioContext();

    // 3-band EQ based on warmth
    this.eqLow = this.audioCtx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 320;
    this.eqLow.gain.value = -8 + sig.warmth * 14;

    this.eqMid = this.audioCtx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.7;
    this.eqMid.gain.value = -4 + sig.warmth * 7;

    this.eqHigh = this.audioCtx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 4000;
    this.eqHigh.gain.value = 6 - sig.warmth * 10;

    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.audioCtx.destination);
  }

  private teardownAudioChain() {
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.eqLow?.disconnect(); } catch {}
    try { this.eqMid?.disconnect(); } catch {}
    try { this.eqHigh?.disconnect(); } catch {}
    try { this.audioCtx?.close(); } catch {}
    this.audioCtx = null;
    this.eqLow = null;
    this.eqMid = null;
    this.eqHigh = null;
    this.sourceNode = null;
  }

  speak(text: string, voice: VoiceSource, handlers: Handlers = {}) {
    this.stop();
    this.cancelled = false;
    this.handlers = handlers;
    this.activeVoiceId = voice.id;
    this.queue = splitSentences(text);
    this.cursor = 0;

    this.setupAudioChain(voice.signature);
    handlers.onStart?.();
    this.speakNext(voice);
  }

  private async speakNext(voice: VoiceSource) {
    if (this.cancelled) return;
    if (this.cursor >= this.queue.length) {
      this.handlers.onEnd?.();
      this.isPlaying = false;
      return;
    }

    const idx = this.cursor;
    const text = this.queue[idx];
    this.handlers.onChunkStart?.(idx, text);

    try {
      const audioUrl = await api.tts(text, voice.id);
      this.playAudio(audioUrl, idx, voice);
    } catch {
      // Fallback: skip this sentence and continue
      this.handlers.onChunkEnd?.(idx);
      this.cursor++;
      this.speakNext(voice);
    }
  }

  private playAudio(url: string, idx: number, voice: VoiceSource) {
    this.audio = new Audio(url);
    this.audio.preload = 'auto';

    // Apply pitch/rate from signature
    // Note: playbackRate is supported, but preservesPitch might not be
    this.audio.playbackRate = voice.signature.rate;
    this.audio.preservesPitch = false;

    // Route through EQ chain if available
    if (this.audioCtx && this.eqLow) {
      try {
        this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
        this.sourceNode.connect(this.eqLow);
      } catch {
        // Already connected
      }
    }

    this.audio.onended = () => {
      URL.revokeObjectURL(url);
      this.handlers.onChunkEnd?.(idx);
      this.cursor++;
      this.speakNext(voice);
    };

    this.audio.onerror = () => {
      URL.revokeObjectURL(url);
      this.handlers.onChunkEnd?.(idx);
      this.cursor++;
      this.speakNext(voice);
    };

    this.audio.play().catch(() => {});
    this.isPlaying = true;
  }

  pause() {
    this.audio?.pause();
  }

  resume() {
    this.audio?.play().catch(() => {});
  }

  stop() {
    this.cancelled = true;
    this.queue = [];
    this.cursor = 0;
    this.activeVoiceId = null;
    this.isPlaying = false;
    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    this.teardownAudioChain();
  }

  /** Speak a short preview snippet. */
  preview(voice: VoiceSource, text: string) {
    this.speak(text, voice, {});
  }
}

export const tts = new TTSEngine();