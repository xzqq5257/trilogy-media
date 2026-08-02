import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ensureDirs, loadDB, saveDB, UPLOAD_DIR, MUSIC_DIR,
  type VoiceSource, type Book, type MusicTrack,
} from './storage.js';
import { probeMedia, fileFingerprint, signatureFromFingerprint, timbreTagFor } from './voice.js';
import { ensureDemoMusic } from './music.js';
import { SEED_BOOKS } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

const PORT = process.env.PORT || 8787;
const app = express();
app.use(cors());
app.use(express.json());

// Static media serving
app.use('/media/uploads', express.static(UPLOAD_DIR));
app.use('/media/music', express.static(MUSIC_DIR));

// ---- Multer: voice samples ----
const voiceUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || guessExt(file.mimetype);
      cb(null, `voice-${nanoid(12)}${ext}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

const musicUpload = multer({
  storage: multer.diskStorage({
    destination: MUSIC_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp3';
      cb(null, `music-${nanoid(12)}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
});

function guessExt(mime: string) {
  const m: Record<string, string> = {
    'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
  };
  return m[mime] || '.bin';
}

// ---- Health ----
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ---- Voices ----
app.get('/api/voices', async (_req, res) => {
  const db = await loadDB();
  res.json(db.voices);
});

app.post('/api/voices/upload', voiceUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未提供文件' });
    const name = (req.body.name as string)?.trim() || stripExt(req.file.originalname);
    const { durationSec, mime } = await probeMedia(req.file.path);
    const fp = await fileFingerprint(req.file.path);
    const signature = signatureFromFingerprint(fp);
    const timbreTag = timbreTagFor(signature);

    const voice: VoiceSource = {
      id: nanoid(10),
      name,
      createdAt: Date.now(),
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mime,
      durationSec,
      samplePath: `uploads/${req.file.filename}`,
      signature,
      timbreTag,
    };
    const db = await loadDB();
    db.voices.push(voice);
    await saveDB(db);
    res.json(voice);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

app.delete('/api/voices/:id', async (req, res) => {
  const db = await loadDB();
  const idx = db.voices.findIndex((v) => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '未找到' });
  const [removed] = db.voices.splice(idx, 1);
  await fs.unlink(path.join(UPLOAD_DIR, path.basename(removed.samplePath))).catch(() => {});
  await saveDB(db);
  res.json({ ok: true });
});

// ---- Books ----
app.get('/api/books', async (_req, res) => {
  const db = await loadDB();
  const list = db.books.map((b) => ({
    id: b.id, title: b.title, author: b.author, cover: b.cover,
    category: b.category, description: b.description,
    chapterCount: b.chapters.length,
    totalChars: b.chapters.reduce((s, c) => s + c.content.length, 0),
  }));
  res.json(list);
});

app.get('/api/books/:id', async (req, res) => {
  const db = await loadDB();
  const book = db.books.find((b) => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: '未找到' });
  res.json(book);
});

// ---- Music ----
app.get('/api/music', async (_req, res) => {
  const db = await loadDB();
  res.json(db.music);
});

app.post('/api/music/upload', musicUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未提供文件' });
    const title = (req.body.title as string)?.trim() || stripExt(req.file.originalname);
    const artist = (req.body.artist as string)?.trim() || '本地导入';
    const { durationSec } = await probeMedia(req.file.path);
    const track: MusicTrack = {
      id: nanoid(10),
      title, artist,
      durationSec,
      path: `music/${req.file.filename}`,
      color: '#7c5cff',
      mood: '我的收藏',
      userUploaded: true,
    };
    const db = await loadDB();
    db.music.push(track);
    await saveDB(db);
    res.json(track);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

function stripExt(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

// ---- SPA static hosting (serves built client) ----
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // SPA fallback: any non-/api, non-/media route returns index.html
  app.get(/^(?!\/api|\/media).*/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// ---- Boot ----
async function boot() {
  await ensureDirs();
  const db = await loadDB();
  // Seed books on first run
  if (db.books.length === 0) {
    db.books = SEED_BOOKS as Book[];
  }
  // Ensure demo music
  const demo = await ensureDemoMusic();
  const demoIds = new Set(demo.map((d) => d.id));
  db.music = [...demo, ...db.music.filter((m) => !demoIds.has(m.id) && m.userUploaded)];
  await saveDB(db);

  app.listen(Number(PORT), () => {
    console.log(`\n  Trilogy server → http://localhost:${PORT}`);
    console.log(`  声源: ${db.voices.length}  书籍: ${db.books.length}  音乐: ${db.music.length}\n`);
  });
}

boot().catch((e) => {
  console.error('Boot failed:', e);
  process.exit(1);
});
