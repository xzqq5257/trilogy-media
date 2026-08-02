import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useStore } from '../store.js';
import type { Book } from '../types.js';

export default function Reader() {
  const { id } = useParams();
  const getBook = useStore((s) => s.getBook);
  const [book, setBook] = useState<Book | null>(null);
  const [chapter, setChapter] = useState(0);
  const [fontSize, setFontSize] = useState(18);

  useEffect(() => {
    if (!id) return;
    getBook(id).then(setBook).catch(() => setBook(null));
    setChapter(0);
  }, [id, getBook]);

  if (!book) return <div className="grid h-full place-items-center text-white/40">加载中…</div>;

  const ch = book.chapters[chapter];
  const paragraphs = ch.content.split('\n').filter((p) => p.trim());

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-ink-700 text-4xl">{book.cover}</div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{book.title}</h1>
          <div className="text-sm text-white/40">{book.author} · {book.category}</div>
        </div>
        <Link to={`/listen/${book.id}`} className="btn-primary text-xs">🎧 用声源听</Link>
      </div>

      {/* Chapter selector */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {book.chapters.map((c, i) => (
          <button
            key={i}
            onClick={() => setChapter(i)}
            className={`rounded-lg px-3 py-1.5 text-xs transition ${
              i === chapter ? 'bg-accent text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {c.title.split(' · ')[0]}
          </button>
        ))}
      </div>

      {/* Reading surface */}
      <article
        className="reader-prose card p-8"
        style={{ fontSize: `${fontSize}px` }}
      >
        <h2 className="mb-4 text-lg font-semibold" style={{ textIndent: 0 }}>{ch.title}</h2>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </article>

      {/* Footer controls */}
      <div className="mt-6 flex items-center justify-between">
        <button
          disabled={chapter === 0}
          onClick={() => setChapter((c) => Math.max(0, c - 1))}
          className="btn-ghost"
        >
          ← 上一章
        </button>
        <div className="flex items-center gap-2 text-sm text-white/50">
          字号
          <button onClick={() => setFontSize((s) => Math.max(14, s - 2))} className="btn-ghost !px-2 !py-1">A-</button>
          <span className="w-8 text-center tabular-nums">{fontSize}</span>
          <button onClick={() => setFontSize((s) => Math.min(28, s + 2))} className="btn-ghost !px-2 !py-1">A+</button>
        </div>
        <button
          disabled={chapter >= book.chapters.length - 1}
          onClick={() => setChapter((c) => Math.min(book.chapters.length - 1, c + 1))}
          className="btn-ghost"
        >
          下一章 →
        </button>
      </div>
    </div>
  );
}
