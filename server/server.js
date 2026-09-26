const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Paths ────────────────────────────────────────────────────────────────────
const DATA_DIR         = path.join(__dirname, '../data');
const VOCAB_FILE       = path.join(DATA_DIR, 'vocab.json');
const TABS_FILE        = path.join(DATA_DIR, 'tabs.json');
const CHAT_HISTORY_FILE = path.join(DATA_DIR, 'chat-history.json');
const IMAGES_DIR       = path.join(DATA_DIR, 'images');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(VOCAB_FILE)) fs.writeFileSync(VOCAB_FILE, '[]', 'utf8');
if (!fs.existsSync(TABS_FILE))  fs.writeFileSync(TABS_FILE,  '[]', 'utf8');
if (!fs.existsSync(CHAT_HISTORY_FILE)) fs.writeFileSync(CHAT_HISTORY_FILE, '[]', 'utf8');

// Serve images statically
app.use('/images', express.static(IMAGES_DIR));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readVocab() {
  try { return JSON.parse(fs.readFileSync(VOCAB_FILE, 'utf8')); } catch { return []; }
}
function writeVocab(data) {
  fs.writeFileSync(VOCAB_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function readTabs() {
  try { return JSON.parse(fs.readFileSync(TABS_FILE, 'utf8')); } catch { return []; }
}
function writeTabs(data) {
  fs.writeFileSync(TABS_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function readChatHistory() {
  try { return JSON.parse(fs.readFileSync(CHAT_HISTORY_FILE, 'utf8')); } catch { return []; }
}
function writeChatHistory(data) {
  fs.writeFileSync(CHAT_HISTORY_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Image Upload ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, IMAGES_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ filename: req.file.filename, url: `/images/${req.file.filename}` });
});

// ─── Vocab CRUD ───────────────────────────────────────────────────────────────

// GET /api/vocab
app.get('/api/vocab', (req, res) => {
  res.json(readVocab());
});

// POST /api/vocab — add new entry
app.post('/api/vocab', (req, res) => {
  try {
    const { sentence, sentenceImage, newWords, pronunciation, meaning, synonyms, group } = req.body;
    const vocab = readVocab();
    const entry = {
      id: uuidv4(),
      sentence:      sentence      || '',
      sentenceImage: sentenceImage || null,
      newWords:      Array.isArray(newWords) ? newWords : [newWords].filter(Boolean),
      pronunciation: pronunciation || '',
      meaning:       meaning       || '',
      synonyms:      synonyms      || '',
      group:         group         || '',
      dateAdded:     new Date().toLocaleDateString('vi-VN'),
    };
    vocab.push(entry);
    writeVocab(vocab);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/vocab/:id — update entry
app.put('/api/vocab/:id', (req, res) => {
  try {
    const vocab = readVocab();
    const idx = vocab.findIndex(v => v.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    vocab[idx] = { ...vocab[idx], ...req.body };
    writeVocab(vocab);
    res.json(vocab[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/vocab/:id
app.delete('/api/vocab/:id', (req, res) => {
  try {
    let vocab = readVocab();
    const entry = vocab.find(v => v.id === req.params.id);
    // Delete associated image if exists
    if (entry?.sentenceImage) {
      const imgPath = path.join(IMAGES_DIR, path.basename(entry.sentenceImage));
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    vocab = vocab.filter(v => v.id !== req.params.id);
    writeVocab(vocab);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      const words = Array.isArray(v.newWords) ? v.newWords.join(', ') : v.newWords;
      const synPart = v.synonyms ? ` | Synonyms: "${v.synonyms}"` : '';
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
    const raw = completion.choices[0].message.content.trim();
    const questions = JSON.parse(raw);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat History CRUD ────────────────────────────────────────────────────────

// GET /api/chat-history — get all sessions (newest first)
app.get('/api/chat-history', (req, res) => {
  const history = readChatHistory();
  res.json(history.slice().reverse());
});

// POST /api/chat-history — save a new chat session
app.post('/api/chat-history', (req, res) => {
  try {
    const { topic, topicLabel, messages } = req.body;
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: 'No messages to save' });
    }
    const history = readChatHistory();
    const session = {
      id: uuidv4(),
      topic: topic || 'freeform',
      topicLabel: topicLabel || '💬 Free Chat',
      messages,
      savedAt: new Date().toISOString(),
      messageCount: messages.filter(m => m.role === 'user').length,
    };
    history.push(session);
    writeChatHistory(history);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat-history/:id — delete one session
app.delete('/api/chat-history/:id', (req, res) => {
  try {
    let history = readChatHistory();
    const found = history.find(s => s.id === req.params.id);
    if (!found) return res.status(404).json({ error: 'Session not found' });
    history = history.filter(s => s.id !== req.params.id);
    writeChatHistory(history);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat-history — delete ALL sessions
app.delete('/api/chat-history', (req, res) => {
  try {
    writeChatHistory([]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// GET /api/tabs
app.get('/api/tabs', (req, res) => res.json(readTabs()));

// POST /api/tabs — create tab
app.post('/api/tabs', (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const tabs = readTabs();
    if (tabs.some(t => t.name === name.trim())) return res.status(409).json({ error: 'Tab already exists' });
    const tab = { id: uuidv4(), name: name.trim(), color: color || '#8b5cf6' };
    tabs.push(tab);
    writeTabs(tabs);
    res.json(tab);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/tabs/:id — rename tab + update all entries in that group
app.put('/api/tabs/:id', (req, res) => {
  try {
    const tabs = readTabs();
    const idx = tabs.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Tab not found' });
    const oldName = tabs[idx].name;
    const { name, color } = req.body;
    if (name && name.trim()) {
      const vocab = readVocab();
      vocab.forEach(v => { if (v.group === oldName) v.group = name.trim(); });
      writeVocab(vocab);
      tabs[idx].name = name.trim();
    }
    if (color) tabs[idx].color = color;
    writeTabs(tabs);
    res.json(tabs[idx]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/tabs/:id — delete tab, entries become ungrouped
app.delete('/api/tabs/:id', (req, res) => {
  try {
    let tabs = readTabs();
    const tab = tabs.find(t => t.id === req.params.id);
    if (!tab) return res.status(404).json({ error: 'Tab not found' });
    const vocab = readVocab();
    vocab.forEach(v => { if (v.group === tab.name) v.group = ''; });
    writeVocab(vocab);
    tabs = tabs.filter(t => t.id !== req.params.id);
    writeTabs(tabs);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`✅ VocabMaster API running at http://localhost:${PORT}`);
  console.log(`📁 Data stored at: ${DATA_DIR}`);
});
