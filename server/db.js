const mongoose = require('mongoose');

// ─── Connection (cached for serverless) ──────────────────────────────────────
let connectionPromise = null;

async function connectDB() {
  if (mongoose.connection.readyState === 1) return; // Already connected
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(process.env.MONGODB_URI, {
      dbName: 'vocabmaster',
      bufferCommands: false,
    });
  }
  await connectionPromise;
}

// ─── Helper: strip MongoDB internals from a lean object ──────────────────────
function toPlain(obj) {
  if (!obj) return null;
  const o = obj.toObject ? obj.toObject({ versionKey: false }) : { ...obj };
  delete o._id;
  delete o.__v;
  return o;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const VocabSchema = new mongoose.Schema({
  id:            { type: String, required: true },
  sentence:      { type: String, default: '' },
  sentenceImage: { type: String, default: null },   // data:image/... base64 URL
  newWords:      [String],
  pronunciation: { type: String, default: '' },
  meaning:       { type: String, default: '' },
  synonyms:      { type: String, default: '' },
  group:         { type: String, default: '' },
  dateAdded:     { type: String, default: '' },
}, { versionKey: false });
VocabSchema.index({ id: 1 }, { unique: true });

const TabSchema = new mongoose.Schema({
  id:    { type: String, required: true },
  name:  { type: String, required: true },
  color: { type: String, default: '#8b5cf6' },
}, { versionKey: false });
TabSchema.index({ id: 1 }, { unique: true });

const ChatSessionSchema = new mongoose.Schema({
  id:           { type: String, required: true },
  topic:        { type: String, default: 'freeform' },
  topicLabel:   { type: String, default: '💬 Free Chat' },
  messages:     [{ role: String, content: String }],
  savedAt:      { type: String, default: '' },
  messageCount: { type: Number, default: 0 },
}, { versionKey: false });
ChatSessionSchema.index({ id: 1 }, { unique: true });

// ─── Models (guard against hot-reload re-registration) ────────────────────────
const Vocab       = mongoose.models.Vocab       || mongoose.model('Vocab',       VocabSchema);
const Tab         = mongoose.models.Tab         || mongoose.model('Tab',         TabSchema);
const ChatSession = mongoose.models.ChatSession || mongoose.model('ChatSession', ChatSessionSchema);

module.exports = { connectDB, toPlain, Vocab, Tab, ChatSession };
