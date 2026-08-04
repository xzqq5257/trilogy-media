import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VoiceSource, BookListItem, Book, MusicTrack } from './types.js';
import { api } from './api.js';

interface AppState {
  voices: VoiceSource[];
  activeVoiceId: string | null;
  books: BookListItem[];
  music: MusicTrack[];

  loadVoices: () => Promise<void>;
  loadBooks: () => Promise<void>;
  loadMusic: () => Promise<void>;
  setActiveVoice: (id: string | null) => void;
  addVoice: (v: VoiceSource) => void;
  updateVoice: (v: VoiceSource) => void;
  removeVoice: (id: string) => Promise<void>;

  getBook: (id: string) => Promise<Book>;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      voices: [],
      activeVoiceId: null,
      books: [],
      music: [],

      loadVoices: async () => {
        const voices = await api.listVoices();
        set({ voices });
        // keep activeVoiceId valid
        const { activeVoiceId } = get();
        if (activeVoiceId && !voices.some((v) => v.id === activeVoiceId)) {
          set({ activeVoiceId: voices[0]?.id ?? null });
        }
      },
      loadBooks: async () => { set({ books: await api.listBooks() }); },
      loadMusic: async () => { set({ music: await api.listMusic() }); },
      setActiveVoice: (id) => set({ activeVoiceId: id }),
      addVoice: (v) => {
        const voices = [...get().voices, v];
        set({ voices, activeVoiceId: get().activeVoiceId ?? v.id });
      },
      updateVoice: (v) => {
        const voices = get().voices.map((vo) => (vo.id === v.id ? v : vo));
        set({ voices });
      },
      removeVoice: async (id) => {
        await api.deleteVoice(id);
        const voices = get().voices.filter((v) => v.id !== id);
        const activeVoiceId = get().activeVoiceId === id ? (voices[0]?.id ?? null) : get().activeVoiceId;
        set({ voices, activeVoiceId });
      },
      getBook: (id) => api.getBook(id),
    }),
    {
      name: 'trilogy-store',
      partialize: (s) => ({ activeVoiceId: s.activeVoiceId }),
    },
  ),
);

export const useActiveVoice = () =>
  useStore((s) => s.voices.find((v) => v.id === s.activeVoiceId) ?? null);
