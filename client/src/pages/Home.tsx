import { Link } from 'react-router-dom';
import { useStore, useActiveVoice } from '../store.js';

const modules = [
  {
    to: '/library',
    icon: '📖',
    title: '读书',
    desc: '沉浸式阅读，支持章节切换与排版舒适度调节。',
    grad: 'from-violet-500/20 to-indigo-500/10',
  },
  {
    to: '/library',
    icon: '🎧',
    title: '听书',
    desc: '用你定制的声源朗读，每个声音都独一无二。',
    grad: 'from-fuchsia-500/20 to-pink-500/10',
    listen: true,
  },
  {
    to: '/music',
    icon: '🎵',
    title: '听音乐',
    desc: '氛围音乐随选随听，也支持导入你的本地音乐。',
    grad: 'from-amber-500/20 to-orange-500/10',
  },
];

export default function Home() {
  const books = useStore((s) => s.books);
  const voices = useStore((s) => s.voices);
  const activeVoice = useActiveVoice();

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Hero */}
      <section className="mb-10">
        <div className="chip mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          声音由你定义
        </div>
        <h1 className="text-4xl font-bold leading-tight md:text-5xl">
          一处读，一处听，一处入梦
        </h1>
        <p className="mt-4 max-w-2xl text-white/55">
          Trilogy 把读书、听书、听音乐合而为一。上传任意视频或音频，
          系统会从中模拟出属于你的独特声源，听书时随时切换，让文字真正「被你认识的声音」读出来。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link to="/voices" className="btn-primary">
            {voices.length ? '管理我的声源' : '上传第一个声源'} →
          </Link>
          <Link to="/library" className="btn-ghost">浏览书架</Link>
        </div>
      </section>

      {/* Active voice banner */}
      {!activeVoice && voices.length === 0 && (
        <div className="card mb-10 flex items-center gap-4 border-accent/30 p-5">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-accent/20 text-2xl">🎙️</div>
          <div className="flex-1">
            <div className="font-medium">还没有声源</div>
            <div className="text-sm text-white/50">上传一段视频或音频，几秒钟生成你的专属朗读声。</div>
          </div>
          <Link to="/voices" className="btn-primary">立即创建</Link>
        </div>
      )}

      {/* Modules */}
      <section className="mb-12 grid gap-4 md:grid-cols-3">
        {modules.map((m) => (
          <Link
            key={m.title}
            to={m.listen ? `/listen/${books[0]?.id ?? ''}` : m.to}
            className={`card group relative overflow-hidden bg-gradient-to-br ${m.grad} p-6 transition hover:-translate-y-1 hover:border-white/15`}
          >
            <div className="mb-8 text-4xl">{m.icon}</div>
            <div className="text-xl font-semibold">{m.title}</div>
            <div className="mt-1.5 text-sm text-white/50">{m.desc}</div>
            <div className="mt-6 text-sm text-accent-soft opacity-0 transition group-hover:opacity-100">
              进入 →
            </div>
          </Link>
        ))}
      </section>

      {/* Bookshelf preview */}
      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">书架精选</h2>
          <Link to="/library" className="text-sm text-white/50 hover:text-white">全部 →</Link>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {books.slice(0, 4).map((b) => (
            <Link key={b.id} to={`/read/${b.id}`} className="card p-4 transition hover:-translate-y-1">
              <div className="mb-3 grid h-28 place-items-center rounded-xl bg-ink-700 text-5xl">{b.cover}</div>
              <div className="truncate font-medium">{b.title}</div>
              <div className="truncate text-xs text-white/40">{b.author} · {b.chapterCount} 章</div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="card p-6">
        <h2 className="mb-4 text-lg font-semibold">声源如何工作？</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {[
            ['1', '上传素材', '视频或音频均可，作为声音指纹来源'],
            ['2', '模拟克隆', '从素材提取稳定参数，生成独特音色'],
            ['3', '存储声源', '一个用户可保存多个声源，随时管理'],
            ['4', '听书调用', '听书时选择任意声源，文字被它读出'],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-xl bg-white/5 p-4">
              <div className="mb-2 grid h-7 w-7 place-items-center rounded-full bg-accent/20 text-sm text-accent-glow">{n}</div>
              <div className="text-sm font-medium">{t}</div>
              <div className="mt-1 text-xs text-white/45">{d}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
