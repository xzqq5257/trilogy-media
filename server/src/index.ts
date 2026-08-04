import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promises as fs, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ensureDirs, loadDB, saveDB, UPLOAD_DIR, MUSIC_DIR, DATA_DIR,
  type VoiceSource, type Book, type MusicTrack,
} from './storage.js';
import { probeMedia, fileFingerprint, analyzeAudioFeatures, signatureFromFeatures, timbreTagFor, extractVoiceModel, generateClonedTts, generateDemo } from './voice.js';
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

// ---- Build version (cache-bust helper for the frontend) ----
const BUILD_VERSION = process.env.BUILD_VERSION || new Date().toISOString().slice(0, 16);
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Surrogate-Control', 'no-store');
  res.json({ version: BUILD_VERSION, ts: Date.now() });
});

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
    const features = await analyzeAudioFeatures(req.file.path);
    const signature = signatureFromFeatures(features, fp);
    const timbreTag = timbreTagFor(signature, features);

    // Extract voice model for cloning
    const voiceModelDir = path.join(DATA_DIR, 'voice-models');
    await fs.mkdir(voiceModelDir, { recursive: true });
    const voiceModelFile = `voice-model-${nanoid(10)}.json`;
    const voiceModelPath = path.join(voiceModelDir, voiceModelFile);
    
    let voiceModel = null;
    try {
      voiceModel = await extractVoiceModel(req.file.path, voiceModelPath);
    } catch (e) {
      console.warn('Voice model extraction failed, will use fallback:', (e as Error).message);
    }

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
      voiceModelPath: voiceModel ? `voice-models/${voiceModelFile}` : undefined,
      voiceModel: voiceModel ? {
        f0_hz: Math.round(voiceModel.f0.mean_hz),
        centroid_hz: Math.round(voiceModel.spectral.centroid),
        f1: Math.round(voiceModel.formants.F1),
        f2: Math.round(voiceModel.formants.F2),
        speaking_rate: Math.round(voiceModel.quality.speaking_rate * 10) / 10,
      } : undefined,
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
  // Clean up voice model file
  if (removed.voiceModelPath) {
    await fs.unlink(path.join(DATA_DIR, removed.voiceModelPath)).catch(() => {});
  }
  await saveDB(db);
  res.json({ ok: true });
});

// ---- Re-analyze voice model ----
app.post('/api/voices/:id/reanalyze', async (req, res) => {
  try {
    const db = await loadDB();
    const idx = db.voices.findIndex((v) => v.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '未找到' });

    const voice = db.voices[idx];
    const audioPath = path.join(UPLOAD_DIR, path.basename(voice.samplePath));
    if (!existsSync(audioPath)) return res.status(404).json({ error: '源文件丢失' });

    // Re-extract voice model
    const voiceModelDir = path.join(DATA_DIR, 'voice-models');
    await fs.mkdir(voiceModelDir, { recursive: true });

    // Remove old model file if exists
    if (voice.voiceModelPath) {
      await fs.unlink(path.join(DATA_DIR, voice.voiceModelPath)).catch(() => {});
    }

    const voiceModelFile = `voice-model-${nanoid(10)}.json`;
    const voiceModelPath = path.join(voiceModelDir, voiceModelFile);

    const voiceModel = await extractVoiceModel(audioPath, voiceModelPath);

    // Re-analyze audio features
    const features = await analyzeAudioFeatures(audioPath);
    const fp = await fileFingerprint(audioPath);
    const signature = signatureFromFeatures(features, fp);
    const timbreTag = timbreTagFor(signature, features);

    // Update voice entry
    voice.signature = signature;
    voice.timbreTag = timbreTag;
    voice.voiceModelPath = `voice-models/${voiceModelFile}`;
    voice.voiceModel = {
      f0_hz: Math.round(voiceModel.f0.mean_hz),
      centroid_hz: Math.round(voiceModel.spectral.centroid),
      f1: Math.round(voiceModel.formants.F1),
      f2: Math.round(voiceModel.formants.F2),
      speaking_rate: Math.round(voiceModel.quality.speaking_rate * 10) / 10,
    };

    await saveDB(db);
    res.json(voice);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
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

// ---- TTS cache ----
const TTS_CACHE_DIR = path.join(DATA_DIR, 'tts-cache');

// ---- TTS health check ----
app.get('/api/tts/health', async (_req, res) => {
  try {
    // Check if Python and edge-tts are available
    const { execSync } = await import('node:child_process');
    const result = execSync('python3 -c "import edge_tts; print(1)"', { timeout: 5000, encoding: 'utf-8' }).trim();
    if (result === '1') {
      return res.json({ ok: true, engine: 'edge-tts' });
    }
  } catch {}
  res.json({ ok: false, engine: 'unavailable' });
});

// ---- TTS endpoint (voice cloning) ----
app.post('/api/tts', async (req, res) => {
  try {
    const { text, voiceId } = req.body as { text?: string; voiceId?: string };
    if (!text || !voiceId) return res.status(400).json({ error: '缺少 text 或 voiceId' });

    const db = await loadDB();
    const voice = db.voices.find((v) => v.id === voiceId);
    if (!voice) return res.status(404).json({ error: '声源未找到' });

    // Cache key: hash of text + voiceId
    const cacheKey = createHash('md5').update(`${text}:${voiceId}`).digest('hex');
    const cacheFile = path.join(TTS_CACHE_DIR, `${cacheKey}.mp3`);

    await fs.mkdir(TTS_CACHE_DIR, { recursive: true });

    // Return cached file if exists
    if (existsSync(cacheFile)) {
      return res.sendFile(cacheFile);
    }

    // Use voice cloning if model is available, otherwise fall back to Edge TTS
    if (voice.voiceModelPath) {
      const modelPath = path.join(DATA_DIR, voice.voiceModelPath);
      if (existsSync(modelPath)) {
        await generateClonedTts(text, modelPath, cacheFile);
        if (existsSync(cacheFile)) {
          return res.sendFile(cacheFile);
        }
      }
    }

    // Fallback: use Edge TTS with a neutral voice
    const { execSync } = await import('node:child_process');
    const ttsVoice = 'zh-CN-XiaoxiaoNeural';
    execSync(`python3 "${path.resolve(__dirname, '../tts_engine.py')}" "${text.replace(/"/g, '\\"')}" "${ttsVoice}" "${cacheFile}"`, { timeout: 30000 });

    if (existsSync(cacheFile)) {
      res.sendFile(cacheFile);
    } else {
      res.status(500).json({ error: 'TTS 生成失败' });
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- Voice demo (preview cloned voice) ----
app.post('/api/voices/:id/demo', async (req, res) => {
  try {
    const db = await loadDB();
    const voice = db.voices.find((v) => v.id === req.params.id);
    if (!voice) return res.status(404).json({ error: '声源未找到' });
    if (!voice.voiceModelPath) return res.status(400).json({ error: '该声源未提取声音模型' });

    const modelPath = path.join(DATA_DIR, voice.voiceModelPath);
    if (!existsSync(modelPath)) return res.status(404).json({ error: '声音模型文件丢失' });

    const demoText = req.body.text || '你好，这是根据你的声音样本模拟生成的语音效果。';

    // Cache demo
    const cacheKey = createHash('md5').update(`demo:${voice.id}:${demoText}`).digest('hex');
    const demoDir = path.join(DATA_DIR, 'demo-cache');
    await fs.mkdir(demoDir, { recursive: true });
    const demoFile = path.join(demoDir, `${cacheKey}.mp3`);

    if (existsSync(demoFile)) {
      return res.sendFile(demoFile);
    }

    await generateDemo(demoText, modelPath, demoFile);
    if (existsSync(demoFile)) {
      res.sendFile(demoFile);
    } else {
      res.status(500).json({ error: '试听生成失败' });
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ---- SPA static hosting (serves built client) ----
if (existsSync(CLIENT_DIST)) {
  // Aggressive no-cache headers for any HTML/asset response
  const noCache = (res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Vary', '*');
  };

  app.use(
    express.static(CLIENT_DIST, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.includes('/assets/')) {
          noCache(res);
        }
      },
    }),
  );
  // SPA fallback: any non-/api, non-/media route returns index.html
  app.get(/^(?!\/api|\/media).*/, (_req, res) => {
    noCache(res);
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
