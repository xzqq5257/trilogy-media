import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore, useActiveVoice } from '../store.js';

export default function Library() {
  const books = useStore((s) => s.books);
  const activeVoice = useActiveVoice();
  const [q, setQ] = useState('');

  const filtered = books.filter(
    (b) => b.title.includes(q) || b.author.includes(q) || b.category.includes(q),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">书架</h1>
          <p className="mt-1 text-sm text-white/50">共 {books.length} 本 · 点击阅读或用声源听书</p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索书名 / 作者"
          className="w-56 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-accent/50"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((b) => (
          <div key={b.id} className="card flex gap-4 p-4 transition hover:border-white/15">
            <Link to={`/read/${b.id}`} className="grid h-32 w-24 shrink-0 place-items-center rounded-xl bg-ink-700 text-5xl">
              {b.cover}
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <Link to={`/read/${b.id}`} className="truncate font-semibold hover:text-accent-soft">{b.title}</Link>
              <div className="text-xs text-white/40">{b.author}</div>
              <div className="chip mt-1.5 w-fit">{b.category}</div>
              <p className="mt-2 line-clamp-2 text-xs text-white/45">{b.description}</p>
              <div className="mt-auto flex gap-2 pt-3">
                <Link to={`/read/${b.id}`} className="btn-ghost !px-3 !py-1.5 text-xs">📖 阅读</Link>
                <Link to={`/listen/${b.id}`} className="btn-primary !px-3 !py-1.5 text-xs">🎧 听书</Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-20 text-center text-white/40">没有找到匹配的书籍</div>
      )}

      {!activeVoice && (
        <div className="card mt-6 flex items-center gap-3 border-amber-400/30 bg-amber-400/5 p-4 text-sm">
          <span>💡</span>
          <span className="text-white/60">听书前请先创建声源，否则将使用系统默认朗读。</span>
          <Link to="/voices" className="ml-auto text-accent-soft hover:underline">去创建 →</Link>
        </div>
      )}
    </div>
  );
}
