import { create } from 'zustand';
import type { MusicTrack } from './types.js';

/** 与 client/src/api.ts 保持一致的媒体前缀默认值 */
const MEDIA_BASE = ((import.meta as any).env?.VITE_MEDIA_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

interface PlayerState {
  current: MusicTrack | null;
  isPlaying: boolean;
  queue: MusicTrack[];
  audio: HTMLAudioElement | null;
  registerAudio: (el: HTMLAudioElement) => void;
  playTrack: (track: MusicTrack, queue?: MusicTrack[]) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  setPlaying: (v: boolean) => void;
  stop: () => void;
}

export const usePlayer = create<PlayerState>((set, get) => ({
  current: null,
  isPlaying: false,
  queue: [],
  audio: null,
  registerAudio: (el) => set({ audio: el }),
  playTrack: (track, queue) => {
    const audio = get().audio;
    if (audio) {
      audio.src = `${MEDIA_BASE}/media/${track.path}`;
      audio.play().catch(() => {});
    }
    set({ current: track, isPlaying: true, queue: queue || [track] });
  },
  toggle: () => {
    const { audio, isPlaying } = get();
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      set({ isPlaying: false });
    } else {
      audio.play().catch(() => {});
      set({ isPlaying: true });
    }
  },
  next: () => {
    const { current, queue, playTrack } = get();
    if (!current || queue.length < 2) return;
    const i = queue.findIndex((t) => t.id === current.id);
    const nextTrack = queue[(i + 1) % queue.length];
    playTrack(nextTrack, queue);
  },
  prev: () => {
    const { current, queue, playTrack } = get();
    if (!current || queue.length < 2) return;
    const i = queue.findIndex((t) => t.id === current.id);
    const prevTrack = queue[(i - 1 + queue.length) % queue.length];
    playTrack(prevTrack, queue);
  },
  setPlaying: (v) => set({ isPlaying: v }),
  stop: () => {
    const { audio } = get();
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    set({ current: null, isPlaying: false });
  },
}));
