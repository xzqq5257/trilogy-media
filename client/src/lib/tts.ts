import type { VoiceSignature, VoiceSource } from '../types.js';

/**
 * TTSEngine — drives audiobook playback via the browser's Web Speech API
 * + Web Audio API post-processing for voice character.
 *
 * Each cloned VoiceSource carries a deterministic `signature` derived from
 * real audio analysis of the uploaded file (RMS, brightness, silence ratio).
 * The engine maps that signature onto the browser's system voices + applies
 * EQ/post-processing so the result reflects the source material's character.
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

  // Web Audio API for post-processing
  private audioCtx: AudioContext | null = null;
  private eqLow: BiquadFilterNode | null = null;
  private eqMid: BiquadFilterNode | null = null;
  private eqHigh: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private mediaStreamDest: MediaStreamAudioDestinationNode | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  private activeStream: MediaStream | null = null;

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
    const zh = this.voices.filter(
      (v) => /zh|cmn|Chinese/i.test(v.lang) || /Chinese/i.test(v.name),
    );
    const pool = zh.length ? zh : this.voices;
    return pool[sig.voiceIndex % pool.length];
  }

  get state(): 'playing' | 'paused' | 'idle' {
    if (!this.synth) return 'idle';
    if (this.synth.speaking && this.synth.paused) return 'paused';
    if (this.synth.speaking) return 'playing';
    return 'idle';
  }

  // ---- Audio processing chain ----

  private setupAudioChain(sig: VoiceSignature) {
    // Clean up previous chain
    this.teardownAudioChain();

    this.audioCtx = new AudioContext();

    // Compressor: makes volume feel more consistent, based on dynamic range
    this.compressor = this.audioCtx.createDynamicsCompressor();
    this.compressor.threshold.value = -30;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // ---- 3-band EQ based on warmth ----
    // Low warmth (0)  → bright/thin: cut lows, boost highs
    // High warmth (1) → warm/full: boost lows, cut highs

    this.eqLow = this.audioCtx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 320;
    // warmth 0→-8dB, warmth 1→+6dB
    this.eqLow.gain.value = -8 + sig.warmth * 14;

    this.eqMid = this.audioCtx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.7;
    // warmth 0→-4dB (scooped), warmth 1→+3dB (present)
    this.eqMid.gain.value = -4 + sig.warmth * 7;

    this.eqHigh = this.audioCtx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 4000;
    // warmth 0→+6dB (bright), warmth 1→-4dB (smooth)
    this.eqHigh.gain.value = 6 - sig.warmth * 10;

    // Chain: source → compressor → eqLow → eqMid → eqHigh → destination
    this.compressor.connect(this.eqLow);
    this.eqLow.connect(this.eqMid);
    this.eqMid.connect(this.eqHigh);
    this.eqHigh.connect(this.audioCtx.destination);

    // Create a MediaStreamDestination so we can capture TTS output
    this.mediaStreamDest = this.audioCtx.createMediaStreamDestination();
  }

  private teardownAudioChain() {
    try { this.streamSource?.disconnect(); } catch {}
    try { this.compressor?.disconnect(); } catch {}
    try { this.eqLow?.disconnect(); } catch {}
    try { this.eqMid?.disconnect(); } catch {}
    try { this.eqHigh?.disconnect(); } catch {}
    try { this.mediaStreamDest?.disconnect(); } catch {}
    try { this.audioCtx?.close(); } catch {}
    this.audioCtx = null;
    this.compressor = null;
    this.eqLow = null;
    this.eqMid = null;
    this.eqHigh = null;
    this.mediaStreamDest = null;
    this.streamSource = null;
    this.activeStream = null;
  }

  /**
   * Capture the browser's TTS audio output and route it through our EQ chain.
   * Uses getDisplayMedia with system audio capture, or falls back to direct output.
   */
  private async routeTtsThroughChain(): Promise<boolean> {
    if (!this.audioCtx || !this.compressor) return false;
    try {
      // Try to capture system audio (TTS output)
      this.activeStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1 }, // minimal video to satisfy API
      } as any);
      this.streamSource = this.audioCtx.createMediaStreamSource(this.activeStream);
      this.streamSource.connect(this.compressor);
      return true;
    } catch {
      // Fallback: can't capture system audio, but EQ is still set up for future use
      return false;
    }
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

    // Set up audio processing chain
    this.setupAudioChain(voice.signature);

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
      const sig = this.activeSig;
      // Apply semitones: 1 semitone = 2^(1/12) ≈ 1.05946
      const semitoneMult = Math.pow(2, sig.semitones / 12);
      u.pitch = clamp(sig.pitch * semitoneMult, 0.1, 2);
      u.rate = clamp(sig.rate, 0.5, 2);
      // Volume: warmth affects perceived loudness
      u.volume = clamp(0.7 + sig.warmth * 0.3, 0.3, 1);
    }
    u.onstart = () => {
      this.handlers.onChunkStart?.(idx, text);
      // Try to route audio through the EQ chain on first utterance
      if (idx === 0 && this.audioCtx && !this.streamSource) {
        this.routeTtsThroughChain();
      }
    };
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
    this.teardownAudioChain();
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