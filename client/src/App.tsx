import { useEffect, useRef } from 'react';
import { Routes, Route, NavLink, Link, useLocation } from 'react-router-dom';
import { useStore } from './store.js';
import { usePlayer } from './player.js';
import Sidebar from './components/Sidebar.js';
import PlayerBar from './components/PlayerBar.js';
import Home from './pages/Home.js';
import Library from './pages/Library.js';
import Reader from './pages/Reader.js';
import Audiobook from './pages/Audiobook.js';
import Music from './pages/Music.js';
import Voices from './pages/Voices.js';

// Build version: forces cache invalidation on every deploy
const APP_VERSION = '2026-08-02-v2';

const PAGE_TITLES: Record<string, string> = {
  '/library': '书架',
  '/music': '音乐',
  '/voices': '我的声源',
};

function getPageTitle(pathname: string): string {
  if (pathname === '/') return '';
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  if (pathname.startsWith('/read/')) return '读书';
  if (pathname.startsWith('/listen/')) return '听书';
  return '';
}

export default function App() {
  const loadVoices = useStore((s) => s.loadVoices);
  const loadBooks = useStore((s) => s.loadBooks);
  const loadMusic = useStore((s) => s.loadMusic);
  const registerAudio = usePlayer((s) => s.registerAudio);
  const audioRef = useRef<HTMLAudioElement>(null);
  const location = useLocation();

  useEffect(() => {
    Promise.all([loadVoices(), loadBooks(), loadMusic()]).catch(console.error);
  }, [loadVoices, loadBooks, loadMusic]);

  useEffect(() => {
    if (audioRef.current) registerAudio(audioRef.current);
  }, [registerAudio]);

  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    // Stash build version for cache busting verification
    (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__ = APP_VERSION;
  }, []);

  const pageTitle = getPageTitle(location.pathname);
  const isHome = location.pathname === '/';

  return (
    <div className="app-bg flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top nav bar — visible on all non-home pages */}
        {!isHome && (
          <header className="flex items-center gap-3 border-b border-white/5 bg-ink-900/60 px-4 py-2 backdrop-blur">
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-white/60 transition hover:bg-white/5 hover:text-white"
            >
              <span className="text-base">⌂</span>
              <span className="hidden sm:inline">首页</span>
            </Link>
            {pageTitle && (
              <>
                <span className="text-white/20">/</span>
                <span className="text-sm text-white/80">{pageTitle}</span>
              </>
            )}
          </header>
        )}
        <main id="main-scroll" className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/library" element={<Library />} />
            <Route path="/read/:id" element={<Reader />} />
            <Route path="/listen/:id" element={<Audiobook />} />
            <Route path="/music" element={<Music />} />
            <Route path="/voices" element={<Voices />} />
          </Routes>
        </main>
        <PlayerBar />
      </div>
      <audio
        ref={audioRef}
        onEnded={() => usePlayer.getState().next()}
        onPlay={() => usePlayer.getState().setPlaying(true)}
        onPause={() => usePlayer.getState().setPlaying(false)}
      />
    </div>
  );
}

export function NavItem({ to, icon, label }: { to: string; icon: string; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
          isActive ? 'bg-accent/20 text-accent-glow' : 'text-white/60 hover:bg-white/5 hover:text-white'
        }`
      }
    >
      <span className="text-lg">{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}
