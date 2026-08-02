import type { VoiceSource, Book, BookListItem, MusicTrack } from './types.js';

const base = '/api';
const mediaBase = '/media';

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export const api = {
  health: () => jget<{ ok: boolean }>(`${base}/health`),

  listVoices: () => jget<VoiceSource[]>(`${base}/voices`),
  uploadVoice: (file: File, name: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    return fetch(`${base}/voices/upload`, { method: 'POST', body: fd }).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error('上传失败')),
    ) as Promise<VoiceSource>;
  },
  deleteVoice: (id: string) =>
    fetch(`${base}/voices/${id}`, { method: 'DELETE' }).then((r) => r.ok),

  listBooks: () => jget<BookListItem[]>(`${base}/books`),
  getBook: (id: string) => jget<Book>(`${base}/books/${id}`),

  listMusic: () => jget<MusicTrack[]>(`${base}/music`),
  uploadMusic: (file: File, title: string, artist: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title);
    fd.append('artist', artist);
    return fetch(`${base}/music/upload`, { method: 'POST', body: fd }).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error('上传失败')),
    ) as Promise<MusicTrack>;
  },

  mediaUrl: (rel: string) => `${mediaBase}/${rel}`,
};
