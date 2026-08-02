import type { VoiceSource, Book, BookListItem, MusicTrack } from './types.js';

/**
 * API 前缀支持通过构建时环境变量覆盖：
 *   - VITE_API_BASE：默认空 → 同域名同源 /api
 *     例：VITE_API_BASE="https://xxx.ngrok-free.app"  → 所有请求走指定后端
 *   - VITE_MEDIA_BASE：默认空 → 同域名同源 /media
 *
 * 这在 Spaces 反代、跨域部署或本地调试远程后端时很有用。
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
const MEDIA_BASE = (import.meta.env.VITE_MEDIA_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

const apiPrefix = API_BASE + '/api';
const mediaPrefix = MEDIA_BASE + '/media';

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export const api = {
  health: () => jget<{ ok: boolean }>(`${apiPrefix}/health`),

  listVoices: () => jget<VoiceSource[]>(`${apiPrefix}/voices`),
  uploadVoice: (file: File, name: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', name);
    return fetch(`${apiPrefix}/voices/upload`, { method: 'POST', body: fd }).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error('上传失败')),
    ) as Promise<VoiceSource>;
  },
  deleteVoice: (id: string) =>
    fetch(`${apiPrefix}/voices/${id}`, { method: 'DELETE' }).then((r) => r.ok),

  listBooks: () => jget<BookListItem[]>(`${apiPrefix}/books`),
  getBook: (id: string) => jget<Book>(`${apiPrefix}/books/${id}`),

  listMusic: () => jget<MusicTrack[]>(`${apiPrefix}/music`),
  uploadMusic: (file: File, title: string, artist: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', title);
    fd.append('artist', artist);
    return fetch(`${apiPrefix}/music/upload`, { method: 'POST', body: fd }).then((r) =>
      r.ok ? r.json() : Promise.reject(new Error('上传失败')),
    ) as Promise<MusicTrack>;
  },

  mediaUrl: (rel: string) => `${mediaPrefix}/${rel}`,
};
