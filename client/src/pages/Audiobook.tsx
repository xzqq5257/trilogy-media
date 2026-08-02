import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore, useActiveVoice } from '../store.js';
import { tts, splitSentences } from '../lib/tts.js';
import type { Book, VoiceSource } from '../types.js';

export default function Audiobook() {
  const { id } = useParams();
  const getBook = useStore((s) => s.getBook);
  const voices = useStore((s) => s.voices);
  const activeVoice = useActiveVoice();
  const setActiveVoice = useStore((s) => s.setActiveVoice);

  const [book, setBook] = useState<Book | null>(null);
  const [chapter, setChapter] = useState(0);
  const [chunkIdx, setChunkIdx] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoNext, setAutoNext] = useState(true);

  const playingRef = useRef(false);
  const chapterRef = useRef(0);
  const bookRef = useRef<Book | null>(null);

  useEffect(() => {
    chapterRef.current = chapter;
  }, [chapter]);
  useEffect(() => {
    bookRef.current = book;
  }, [book]);

  useEffect(() => {
    if (!id) return;
    getBook(id).then((b) => {
      setBook(b);
      setChapter(0);
    });
    return () => tts.stop();
  }, [id, getBook]);

  const playChapter = (voice: VoiceSource | null, chapterIndex: number) => {
    const b = bookRef.current;
    if (!b) return;
    const ch = b.chapters[chapterIndex];
    if (!ch) return;
    setIsPlaying(true);
    playingRef.current = true;
    setChunkIdx(-1);

    const sentences = splitSentences(ch.content);

    if (!voice || !tts.supported) {
      // Fallback: simulate timed playback so the UI still demonstrates the flow.
      let i = 0;
      const step = () => {
        if (!playingRef.current) return;
        if (i >= sentences.length) {
          finishChapter();
          return;
        }
        setChunkIdx(i);
        i++;
        setTimeout(step, 1400);
      };
      step();
      return;
    }

    tts.speak(
      ch.content,
      voice,
      {
        onChunkStart: (i) => setChunkIdx(i),
        onEnd: () => finishChapter(),
      },
    );
  };

  const finishChapter = () => {
    setChunkIdx(-1);
    const b = bookRef.current;
    if (!b) return;
    const next = chapterRef.current + 1;
    if (autoNext && next < b.chapters.length) {
      const nc = next;
      setChapter(nc);
      chapterRef.current = nc;
      // small pause between chapters
      setTimeout(() => {
        if (playingRef.current) playChapter(useStore.getState().voices.find((v) => v.id === useStore.getState().activeVoiceId) ?? null, nc);
      }, 800);
    } else {
      setIsPlaying(false);
      playingRef.current = false;
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      tts.stop();
      playingRef.current = false;
      setIsPlaying(false);
      setChunkIdx(-1);
      return;
    }
    playChapter(activeVoice, chapter);
  };

  const handleChapterChange = (i: number) => {
    tts.stop();
    playingRef.current = false;
    setIsPlaying(false);
    setChunkIdx(-1);
    setChapter(i);
    chapterRef.current = i;
  };

  if (!book) return <div className="grid h-full place-items-center text-white/40">加载中…</div>;

  const ch = book.chapters[chapter];
  const sentences = splitSentences(ch.content);
  const progress = chunkIdx >= 0 ? ((chunkIdx + 1) / sentences.length) * 100 : 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-ink-700 text-4xl">{book.cover}</div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{book.title}</h1>
          <div className="text-sm text-white/40">{book.author}</div>
        </div>
        <Link to={`/read/${book.id}`} className="btn-ghost text-xs">📖 切换阅读</Link>
      </div>

      {/* Voice + controls */}
      <div className="card mb-6 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">声源</span>
            <select
              value={activeVoice?.id ?? ''}
              onChange={(e) => setActiveVoice(e.target.value || null)}
              className="rounded-lg border border-white/10 bg-ink-700 px-3 py-1.5 text-sm outline-none focus:border-accent/50"
            >
              <option value="">系统默认</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}（{v.timbreTag}）
                </option>
              ))}
            </select>
            {voices.length === 0 && (
              <Link to="/voices" className="text-xs text-accent-soft hover:underline">+ 创建声源</Link>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-white/50">
              <input type="checkbox" checked={autoNext} onChange={(e) => setAutoNext(e.target.checked)} className="accent-[#7c5cff]" />
              自动连播
            </label>
            <button onClick={handlePlayPause} className="btn-primary">
              {isPlaying ? '⏸ 暂停' : '▶ 播放'}
            </button>
          </div>
        </div>

        {activeVoice && (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/40">
            <span className="chip">音槽 #{activeVoice.signature.voiceIndex + 1}</span>
            <span className="chip">音高 {activeVoice.signature.pitch}</span>
            <span className="chip">语速 {activeVoice.signature.rate}</span>
            <span className="chip">半音偏移 {activeVoice.signature.semitones > 0 ? '+' : ''}{activeVoice.signature.semitones}</span>
            <span className="chip">温暖度 {Math.round(activeVoice.signature.warmth * 100)}%</span>
          </div>
        )}

        {/* progress */}
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 text-right text-[11px] text-white/40">
          {chunkIdx >= 0 ? `第 ${chunkIdx + 1} / ${sentences.length} 句` : '准备就绪'}
        </div>
      </div>

      {/* Chapter selector */}
      <div className="mb-4 flex flex-wrap gap-2">
        {book.chapters.map((c, i) => (
          <button
            key={i}
            onClick={() => handleChapterChange(i)}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              i === chapter ? 'bg-accent text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {c.title.split(' · ')[0]}
          </button>
        ))}
      </div>

      {/* Live transcript */}
      <article className="reader-prose card p-8">
        <h2 className="mb-4 text-lg font-semibold" style={{ textIndent: 0 }}>{ch.title}</h2>
        {sentences.map((s, i) => (
          <span
            key={i}
            className={`inline transition ${i === chunkIdx ? 'bg-accent/25 text-white rounded-md px-0.5' : i < chunkIdx ? 'text-white/35' : 'text-white/85'}`}
            style={{ marginRight: '0.2em' }}
          >
            {s}
          </span>
        ))}
      </article>
    </div>
  );
}
