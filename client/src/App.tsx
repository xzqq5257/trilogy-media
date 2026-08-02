import { useEffect, useRef } from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
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

  // scroll to top on route change
  useEffect(() => {
    document.getElementById('main-scroll')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="app-bg flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
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
