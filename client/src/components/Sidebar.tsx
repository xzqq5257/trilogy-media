import { NavLink } from 'react-router-dom';
import { useStore, useActiveVoice } from '../store.js';

const nav = [
  { to: '/', icon: '⌂', label: '首页' },
  { to: '/library', icon: '📚', label: '书架' },
  { to: '/music', icon: '🎵', label: '音乐' },
  { to: '/voices', icon: '🎙️', label: '我的声源' },
];

export default function Sidebar() {
  const activeVoice = useActiveVoice();

  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-white/5 bg-ink-900/60 px-4 py-6 backdrop-blur">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-pink-500 text-white shadow-lg shadow-accent/30">
          <span className="text-lg">⑂</span>
        </div>
        <div>
          <div className="font-semibold leading-tight">Trilogy</div>
          <div className="text-[11px] text-white/40">读 · 听 · 乐</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                isActive
                  ? 'bg-accent/20 text-accent-glow'
                  : 'text-white/60 hover:bg-white/5 hover:text-white'
              }`
            }
          >
            <span className="text-lg">{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto">
        <div className="card p-3">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-white/40">当前声源</div>
          {activeVoice ? (
            <NavLink to="/voices" className="block">
              <div className="flex items-center gap-2.5">
                <div
                  className="relative grid h-9 w-9 place-items-center rounded-full"
                  style={{ background: voiceColor(activeVoice.signature.warmth) }}
                >
                  <span className="text-xs">{activeVoice.signature.voiceIndex + 1}</span>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{activeVoice.name}</div>
                  <div className="truncate text-[11px] text-white/40">{activeVoice.timbreTag}</div>
                </div>
              </div>
            </NavLink>
          ) : (
            <NavLink to="/voices" className="text-sm text-accent-soft hover:underline">
              + 上传你的第一个声源
            </NavLink>
          )}
        </div>
      </div>
    </aside>
  );
}

function voiceColor(warmth: number) {
  const h = Math.round(260 + warmth * 80);
  return `hsl(${h} 70% 55%)`;
}
