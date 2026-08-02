import { useRef, useState } from 'react';
import { useStore } from '../store.js';
import { api } from '../api.js';
import { tts } from '../lib/tts.js';
import type { VoiceSource } from '../types.js';

const PREVIEW_TEXT = '你好，这是属于我的声音。每个字都被这个声源温柔地读出来。';

export default function Voices() {
  const voices = useStore((s) => s.voices);
  const activeVoiceId = useStore((s) => s.activeVoiceId);
  const setActiveVoice = useStore((s) => s.setActiveVoice);
  const addVoice = useStore((s) => s.addVoice);
  const removeVoice = useStore((s) => s.removeVoice);
  const loadVoices = useStore((s) => s.loadVoices);

  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const v = await api.uploadVoice(file, name || file.name.replace(/\.[^.]+$/, ''));
      addVoice(v);
      setName('');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const preview = (v: VoiceSource) => {
    tts.stop();
    setPreviewingId(v.id);
    tts.speak(PREVIEW_TEXT, v, {
      onEnd: () => setPreviewingId(null),
    });
    // safety timeout in case onEnd doesn't fire
    setTimeout(() => setPreviewingId((cur) => (cur === v.id ? null : cur)), 12000);
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">我的声源</h1>
        <p className="mt-1 text-sm text-white/50">
          上传任意视频或音频，系统从中模拟出独一无二的朗读声源。可保存多个，听书时自由切换。
        </p>
      </div>

      {/* Upload card */}
      <div className="card mb-8 p-6">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="chip">1. 选素材</span>
          <span className="chip">2. 模拟克隆</span>
          <span className="chip">3. 存储 · 随时调用</span>
        </div>
        <div
          onClick={() => !busy && fileRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/10 bg-white/5 py-10 transition hover:border-accent/50 hover:bg-accent/5"
        >
          <div className="mb-3 text-4xl">{busy ? '⏳' : '🎙️'}</div>
          <div className="font-medium">{busy ? '正在模拟克隆声源…' : '点击上传视频 / 音频'}</div>
          <div className="mt-1 text-xs text-white/40">支持 mp3 / wav / m4a / mp4 / mov / webm 等，最大 200MB</div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*"
            onChange={onUpload}
            className="hidden"
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="为这个声源起个名字（可选）"
            className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-accent/50"
          />
        </div>
        <div className="mt-3 rounded-lg bg-white/5 p-3 text-xs text-white/45">
          ℹ️ 说明：声源参数由素材内容指纹确定性生成，相同素材得到相同声源；不同素材得到不同音色（音槽、音高、语速、半音偏移、温暖度）。
        </div>
      </div>

      {/* Voice list */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">已保存声源（{voices.length}）</h2>
        <button onClick={() => loadVoices()} className="text-xs text-white/40 hover:text-white">刷新</button>
      </div>

      <div className="grid gap-3">
        {voices.map((v) => {
          const active = v.id === activeVoiceId;
          return (
            <div
              key={v.id}
              className={`card flex flex-col gap-4 p-4 sm:flex-row sm:items-center ${active ? 'border-accent/50 bg-accent/5' : ''}`}
            >
              {/* avatar */}
              <div className="flex items-center gap-3">
                <div
                  className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-semibold text-white shadow-lg"
                  style={{ background: voiceColor(v.signature.warmth, v.signature.voiceIndex) }}
                >
                  {v.signature.voiceIndex + 1}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{v.name}</span>
                    {active && <span className="chip border border-accent/40 !bg-accent/20 !text-accent-glow">使用中</span>}
                  </div>
                  <div className="truncate text-xs text-white/40">
                    {v.timbreTag} · {v.matchedVoice ? v.matchedVoice.replace('zh-CN-', '').replace('Neural', '') : '通用'} · {Math.round(v.durationSec)}s · {formatSize(v.fileSize)} · {mimeShort(v.mime)}
                  </div>
                </div>
              </div>

              {/* signature */}
              <div className="flex flex-wrap gap-1.5 sm:justify-center">
                <Sig label="音高" value={v.signature.pitch} />
                <Sig label="语速" value={v.signature.rate} />
                <Sig label="半音" value={`${v.signature.semitones > 0 ? '+' : ''}${v.signature.semitones}`} />
                <Sig label="温暖度" value={`${Math.round(v.signature.warmth * 100)}%`} />
              </div>

              {/* actions */}
              <div className="flex items-center gap-2 sm:ml-auto">
                <audio controls preload="none" src={api.mediaUrl(v.samplePath)} className="h-8 w-36" />
                <button
                  onClick={() => preview(v)}
                  className="btn-ghost !px-3 !py-2 text-xs"
                  disabled={previewingId === v.id}
                >
                  {previewingId === v.id ? '试听中…' : '🔊 试读'}
                </button>
                {!active && (
                  <button onClick={() => setActiveVoice(v.id)} className="btn-primary !px-3 !py-2 text-xs">选用</button>
                )}
                <button
                  onClick={() => {
                    if (confirm(`删除声源「${v.name}」？`)) removeVoice(v.id);
                  }}
                  className="btn-ghost !px-2.5 !py-2 text-xs text-red-300/70 hover:!bg-red-500/10"
                >
                  🗑
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {voices.length === 0 && (
        <div className="card py-16 text-center text-white/40">
          还没有声源，上传第一个素材开始吧。
        </div>
      )}
    </div>
  );
}

function Sig({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-1 text-center">
      <div className="text-[10px] text-white/40">{label}</div>
      <div className="text-xs font-medium tabular-nums">{value}</div>
    </div>
  );
}

function voiceColor(warmth: number, idx: number) {
  const h = Math.round(250 + warmth * 90 + idx * 17);
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 65% 45%))`;
}
function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB';
  return (bytes / 1024 / 1024).toFixed(1) + 'MB';
}
function mimeShort(mime: string) {
  if (mime.startsWith('video')) return '视频';
  if (mime.startsWith('audio')) return '音频';
  return mime;
}
