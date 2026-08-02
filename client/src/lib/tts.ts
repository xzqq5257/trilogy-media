import { api } from '../api.js';
import type { VoiceSignature, VoiceSource } from '../types.js';

/**
 * TTSEngine — hybrid TTS engine.
 *
 * 1. Tries server-side Edge TTS (natural AI voices, voice-matched to source)
 * 2. Falls back to browser Web Speech API if server TTS is unavailable
 * 3. Applies EQ post-processing via Web Audio API (warmth control)
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
  // Server-side TTS (Edge TTS)
  private audio: HTMLAudioElement | null = null;
  private useServerTts = false;
  private ttsChecked = false;

  // Web Speech API fallback
  private synth: SpeechSynthesis | null;
  voices: SpeechSynthesisVoice[] = [];
  private wsUtterance: SpeechSynthesisUtterance | null = null;

  // Shared state
  private queue: string[] = [];
  private cursor = 0;
  private activeVoice: VoiceSource | null = null;
  private handlers: Handlers = {};
  private cancelled = false;
  private isPlaying = false;

  // Web Audio API for EQ
  private audioCtx: AudioContext | null = null;
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;

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
    return typeof window !== 'undefined';
  }

  get state(): 'playing' | 'paused' | 'idle' {
    if (this.isPlaying) {
      if (this.audio) return this.audio.paused ? 'paused' : 'playing';
      if (this.synth) return this.synth.paused ? 'paused' : 'playing';
    }
    return 'idle';
  }

  // ---- Health check ----

  private async checkTts() {
    if (this.ttsChecked) return;
    this.ttsChecked = true;
    this.useServerTts = await api.ttsHealth();
  }

  // ---- Audio chain ----

  private setupAudioChain(sig: VoiceSignature) {
    this.teardownAudioChain();
    this.audioCtx = new AudioContext();

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

  // ---- Speak ----

  speak(text: string, voice: VoiceSource, handlers: Handlers = {}) {
    this.stop();
    this.cancelled = false;
    this.handlers = handlers;
    this.activeVoice = voice;
    this.queue = splitSentences(text);
    this.cursor = 0;

    this.setupAudioChain(voice.signature);
    handlers.onStart?.();

    // Check TTS availability and start
    this.checkTts().then(() => this.speakNext());
  }

  private speakNext() {
    if (this.cancelled) return;
    if (this.cursor >= this.queue.length) {
      this.handlers.onEnd?.();
      this.isPlaying = false;
      return;
    }

    const idx = this.cursor;
    const text = this.queue[idx];
    this.handlers.onChunkStart?.(idx, text);

    if (this.useServerTts && this.activeVoice) {
      this.speakViaServer(text, idx, this.activeVoice);
    } else {
      this.speakViaWebSpeech(text, idx, this.activeVoice);
    }
  }

  // ---- Server-side TTS (Edge TTS) ----

  private async speakViaServer(text: string, idx: number, voice: VoiceSource) {
    try {
      const audioUrl = await api.tts(text, voice.id);
      this.playAudioUrl(audioUrl, idx, voice);
    } catch {
      // Server TTS failed, fall back to Web Speech API for this session
      this.useServerTts = false;
      this.speakViaWebSpeech(text, idx, voice);
    }
  }

  private playAudioUrl(url: string, idx: number, voice: VoiceSource) {
    this.audio = new Audio(url);
    this.audio.preload = 'auto';
    this.audio.playbackRate = voice.signature.rate;
    this.audio.preservesPitch = false;

    if (this.audioCtx && this.eqLow) {
      try {
        this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
        this.sourceNode.connect(this.eqLow);
      } catch {}
    }

    this.audio.onended = () => {
      URL.revokeObjectURL(url);
      this.handlers.onChunkEnd?.(idx);
      this.cursor++;
      this.speakNext();
    };
    this.audio.onerror = () => {
      URL.revokeObjectURL(url);
      this.handlers.onChunkEnd?.(idx);
      this.cursor++;
      this.speakNext();
    };

    this.audio.play().catch(() => {});
    this.isPlaying = true;
  }

  // ---- Web Speech API fallback ----

  private speakViaWebSpeech(text: string, idx: number, voice: VoiceSource | null) {
    if (!this.synth) {
      this.handlers.onChunkEnd?.(idx);
      this.cursor++;
      this.speakNext();
      return;
    }

    const u = new SpeechSynthesisUtterance(text);
    const v = this.pickVoice(voice);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    if (voice) {
      const sig = voice.signature;
      const semitoneMult = Math.pow(2, sig.semitones / 12);
      u.pitch = clamp(sig.pitch * semitoneMult, 0.1, 2);
      u.rate = clamp(sig.rate, 0.5, 2);
      u.volume = clamp(0.7 + sig.warmth * 0.3, 0.3, 1);
    }

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

    this.wsUtterance = u;
    this.synth.speak(u);
    this.isPlaying = true;
  }

  private pickVoice(voice: VoiceSource | null): SpeechSynthesisVoice | null {
    if (!this.voices.length) return null;
    const zh = this.voices.filter(
      (v) => /zh|cmn|Chinese/i.test(v.lang) || /Chinese/i.test(v.name),
    );
    const pool = zh.length ? zh : this.voices;
    const idx = voice?.signature.voiceIndex ?? 0;
    return pool[idx % pool.length];
  }

  // ---- Controls ----

  pause() {
    if (this.audio) {
      this.audio.pause();
    } else if (this.synth) {
      this.synth.pause();
    }
  }

  resume() {
    if (this.audio) {
      this.audio.play().catch(() => {});
    } else if (this.synth) {
      this.synth.resume();
    }
  }

  stop() {
    this.cancelled = true;
    this.queue = [];
    this.cursor = 0;
    this.activeVoice = null;
    this.isPlaying = false;

    if (this.audio) {
      this.audio.pause();
      this.audio.src = '';
      this.audio = null;
    }
    if (this.synth) {
      this.synth.cancel();
    }
    this.ttsChecked = false;
    this.useServerTts = false;

    this.teardownAudioChain();
  }

  preview(voice: VoiceSource, text: string) {
    this.speak(text, voice, {});
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export const tts = new TTSEngine();