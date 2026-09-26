const express = require('express');
const cors    = require('cors');
const path    = require('path');
const multer  = require('multer');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { OpenAI } = require('openai');
const { connectDB, toPlain, Vocab, Tab, ChatSession } = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));   // 10 MB for Base64 images in JSON body

// ─── Connect DB on every request (cached — safe for serverless) ───────────────
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error('DB connection error:', err);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

// ─── Image Upload (memory storage → Base64 data URL) ─────────────────────────
// No filesystem writes — works on Vercel serverless
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },   // 3 MB max (safe under Vercel's 4.5 MB limit)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const base64  = req.file.buffer.toString('base64');
  const dataUrl = `data:${req.file.mimetype};base64,${base64}`;
  res.json({ url: dataUrl });  // Frontend stores this directly as sentenceImage
});

// ─── Vocab CRUD ───────────────────────────────────────────────────────────────

// GET /api/vocab
app.get('/api/vocab', async (req, res) => {
  try {
    const docs = await Vocab.find({}).lean();
    res.json(docs.map(d => { delete d._id; return d; }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/vocab — add new entry
app.post('/api/vocab', async (req, res) => {
  try {
    const { sentence, sentenceImage, newWords, pronunciation, meaning, synonyms, group } = req.body;
    const entry = {
      id:            uuidv4(),
      sentence:      sentence      || '',
      sentenceImage: sentenceImage || null,
      newWords:      Array.isArray(newWords) ? newWords : [newWords].filter(Boolean),
      pronunciation: pronunciation || '',
      meaning:       meaning       || '',
      synonyms:      synonyms      || '',
      group:         group         || '',
      dateAdded:     new Date().toLocaleDateString('vi-VN'),
    };
    const doc = await Vocab.create(entry);
    res.json(toPlain(doc));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/vocab/:id — update entry
app.put('/api/vocab/:id', async (req, res) => {
  try {
    const doc = await Vocab.findOneAndUpdate(
      { id: req.params.id },
      { $set: req.body },
      { new: true, lean: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    delete doc._id;
    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/vocab/:id
app.delete('/api/vocab/:id', async (req, res) => {
  try {
    // Image was stored as Base64 in DB — no file to delete
    await Vocab.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── OpenAI Client ────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Quiz Endpoint ────────────────────────────────────────────────────────────
app.post('/api/quiz', async (req, res) => {
  try {
    const { vocabList, count } = req.body;
    const numQuestions = Math.max(1, Math.min(parseInt(count) || 5, 50));
    if (!vocabList || vocabList.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 vocab items.' });
    }
    const vocabText = vocabList.map((v, i) => {
      const words   = Array.isArray(v.newWords) ? v.newWords.join(', ') : v.newWords;
      const synPart  = v.synonyms ? ` | Synonyms: "${v.synonyms}"`   : '';
      const sentPart = v.sentence ? ` | Sentence: "${v.sentence}"` : '';
      return `${i + 1}. Word(s): "${words}" | Meaning: "${v.meaning}"${synPart}${sentPart}`;
    }).join('\n');

    const prompt = `You are an English vocabulary quiz generator.
Based on the vocabulary list below, generate exactly ${numQuestions} multiple-choice questions.
Each question MUST have exactly 4 options and exactly 1 correct answer.

Mix these question types (use all types, spread evenly):
- "word_to_meaning": Show the word/phrase, ask which option means it in Vietnamese/English
- "meaning_to_word": Show the Vietnamese/English meaning, ask which word/phrase matches
- "fill_in": Show the original sentence with the target word blanked as "___", ask which word fits best

Rules:
- Wrong options must be plausible (from other words in the list or similar words)
- "explanation" should explain WHY the answer is correct (1-2 sentences)
- Questions should cover vocabulary words, phrases, AND sentence usage
- Shuffle the position of the correct answer among the 4 options

Vocabulary list:
${vocabText}

Return ONLY a valid JSON array with exactly ${numQuestions} items (no markdown, no extra text):
[{"type":"word_to_meaning","question":"...","options":["...","...","...","..."],"answer":"...","explanation":"..."}]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });
    const raw       = completion.choices[0].message.content.trim();
    const questions = JSON.parse(raw);
    res.json(questions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Chat Endpoint ────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, systemPrompt } = req.body;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt || `You are an English conversation coach. Engage naturally, then after your reply add:
---
📝 **Corrections:** (if any mistakes)
❌ *wrong* → ✅ **correct** — explanation
---
If no mistakes: ✨ Great job! Your English sounds natural.`
        },
        ...messages,
      ],
      temperature: 0.8,
    });
    res.json({ reply: completion.choices[0].message.content });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Chat History CRUD ────────────────────────────────────────────────────────

// GET /api/chat-history — newest first
app.get('/api/chat-history', async (req, res) => {
  try {
    const docs = await ChatSession.find({}).sort({ savedAt: -1 }).lean();
    res.json(docs.map(d => { delete d._id; return d; }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/chat-history — save a session
app.post('/api/chat-history', async (req, res) => {
  try {
    const { topic, topicLabel, messages } = req.body;
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'No messages to save' });
    }
    const session = {
      id:           uuidv4(),
      topic:        topic        || 'freeform',
      topicLabel:   topicLabel   || '💬 Free Chat',
      messages,
      savedAt:      new Date().toISOString(),
      messageCount: messages.filter(m => m.role === 'user').length,
    };
    const doc = await ChatSession.create(session);
    res.json(toPlain(doc));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/chat-history/:id — delete one session
app.delete('/api/chat-history/:id', async (req, res) => {
  try {
    const result = await ChatSession.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/chat-history — delete ALL sessions
app.delete('/api/chat-history', async (req, res) => {
  try {
    await ChatSession.deleteMany({});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Tabs CRUD ────────────────────────────────────────────────────────────────

// GET /api/tabs
app.get('/api/tabs', async (req, res) => {
  try {
    const docs = await Tab.find({}).lean();
    res.json(docs.map(d => { delete d._id; return d; }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tabs — create tab
app.post('/api/tabs', async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const exists = await Tab.findOne({ name: name.trim() });
    if (exists) return res.status(409).json({ error: 'Tab already exists' });
    const tab = { id: uuidv4(), name: name.trim(), color: color || '#8b5cf6' };
    const doc = await Tab.create(tab);
    res.json(toPlain(doc));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/tabs/:id — rename tab + update all vocab in that group
app.put('/api/tabs/:id', async (req, res) => {
  try {
    const tab = await Tab.findOne({ id: req.params.id });
    if (!tab) return res.status(404).json({ error: 'Tab not found' });
    const oldName = tab.name;
    const { name, color } = req.body;
    if (name && name.trim()) {
      tab.name = name.trim();
      // Update all vocab entries that belong to this tab
      await Vocab.updateMany({ group: oldName }, { $set: { group: name.trim() } });
    }
    if (color) tab.color = color;
    await tab.save();
    res.json(toPlain(tab));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/tabs/:id — delete tab, entries become ungrouped
app.delete('/api/tabs/:id', async (req, res) => {
  try {
    const tab = await Tab.findOne({ id: req.params.id });
    if (!tab) return res.status(404).json({ error: 'Tab not found' });
    // Ungroup all vocab in this tab
    await Vocab.updateMany({ group: tab.name }, { $set: { group: '' } });
    await Tab.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Production: serve React build ───────────────────────────────────────────
if (process.env.NODE_ENV === 'production' && !process.env.VERCEL) {
  const buildPath = path.join(__dirname, '../build');
  app.use(express.static(buildPath));
  app.get('*', (req, res) => res.sendFile(path.join(buildPath, 'index.html')));
}

// ─── Start (local dev only — Vercel exports the app instead) ─────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => {
    console.log(`✅ VocabMaster API running at http://localhost:${PORT}`);
    console.log(`🍃 MongoDB: ${process.env.MONGODB_URI ? 'Connected' : '⚠️  MONGODB_URI not set!'}`);
  });
}

module.exports = app;   // Export for Vercel serverless
