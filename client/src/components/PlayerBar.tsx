import { useEffect, useState } from 'react';
import { usePlayer } from '../player.js';

function fmt(sec: number) {
  if (!sec || !Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlayerBar() {
  const { current, isPlaying, toggle, next, prev, audio } = usePlayer();
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audio;
    if (!a) return;
    const onTime = () => setProgress(a.currentTime);
    const onDur = () => setDuration(a.duration);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onDur);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onDur);
    };
  }, [audio, current]);

  if (!current) return null;
  const pct = duration ? (progress / duration) * 100 : 0;

  return (
    <div className="border-t border-white/5 bg-ink-900/80 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-4">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg shadow-lg"
          style={{ background: current.color }}
        >
          ♪
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{current.title}</div>
          <div className="truncate text-xs text-white/40">{current.artist} · {current.mood}</div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={prev} className="btn-ghost !p-2" title="上一首">⏮</button>
          <button
            onClick={toggle}
            className="grid h-10 w-10 place-items-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 hover:bg-accent-soft"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button onClick={next} className="btn-ghost !p-2" title="下一首">⏭</button>
        </div>

        <div className="hidden sm:flex w-48 items-center gap-2">
          <span className="text-[11px] tabular-nums text-white/40">{fmt(progress)}</span>
          <input
            type="range"
            className="slider flex-1"
            min={0}
            max={duration || 0}
            value={progress}
            step={0.1}
            onChange={(e) => {
              if (audio) {
                audio.currentTime = Number(e.target.value);
                setProgress(Number(e.target.value));
              }
            }}
            style={{ background: `linear-gradient(90deg, #7c5cff ${pct}%, rgba(255,255,255,0.15) ${pct}%)` }}
          />
          <span className="text-[11px] tabular-nums text-white/40">{fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}
