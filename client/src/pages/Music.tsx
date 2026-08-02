import { useRef, useState } from 'react';
import { useStore } from '../store.js';
import { usePlayer } from '../player.js';
import { api } from '../api.js';
import type { MusicTrack } from '../types.js';

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Music() {
  const tracks = useStore((s) => s.music);
  const loadMusic = useStore((s) => s.loadMusic);
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      await api.uploadMusic(file, '', '');
      await loadMusic();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const playAll = (start: MusicTrack) => playTrack(start, tracks);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">音乐</h1>
          <p className="mt-1 text-sm text-white/50">{tracks.length} 首 · 氛围音乐 + 本地导入</p>
        </div>
        <button onClick={() => fileRef.current?.click()} className="btn-primary" disabled={busy}>
          {busy ? '导入中…' : '+ 导入音乐'}
        </button>
        <input ref={fileRef} type="file" accept="audio/*" onChange={onUpload} className="hidden" />
      </div>

      <div className="grid gap-3">
        {tracks.map((t, i) => {
          const isCur = current?.id === t.id;
          const playing = isCur && isPlaying;
          return (
            <div
              key={t.id}
              className={`card flex items-center gap-4 p-3 transition ${isCur ? 'border-accent/40 bg-accent/5' : 'hover:border-white/15'}`}
            >
              <button
                onClick={() => (isCur ? toggle() : playAll(t))}
                className="relative grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg text-white shadow-lg"
                style={{ background: t.color }}
              >
                {playing ? '⏸' : '▶'}
                {playing && <span className="pulse-ring absolute inset-0 rounded-xl" />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  <span className="mr-2 text-white/30">{(i + 1).toString().padStart(2, '0')}</span>
                  {t.title}
                </div>
                <div className="truncate text-xs text-white/40">{t.artist} · {t.mood}{t.userUploaded ? ' · 已导入' : ''}</div>
              </div>
              <div className="text-xs tabular-nums text-white/40">{fmt(t.durationSec)}</div>
            </div>
          );
        })}
      </div>

      {tracks.length === 0 && (
        <div className="py-20 text-center text-white/40">还没有音乐，点上方导入或等待氛围音乐生成</div>
      )}
    </div>
  );
}
