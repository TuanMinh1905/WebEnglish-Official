/**
 * scripts/migrate.js
 * ──────────────────
 * Chạy 1 lần duy nhất: chuyển toàn bộ data từ JSON files → MongoDB Atlas.
 * Images (file .jpg/.png) được đọc và convert sang Base64 data URL.
 *
 * Cách dùng:
 *   1. Thêm MONGODB_URI vào file .env
 *   2. node scripts/migrate.js
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const { connectDB, Vocab, Tab, ChatSession } = require('../server/db');

const DATA_DIR   = path.join(__dirname, '../data');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

// ─── Helper: file → Base64 data URL ──────────────────────────────────────────
function fileToDataUrl(filePath) {
  try {
    const ext      = path.extname(filePath).toLowerCase().slice(1);
    const mimeMap  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    const mime     = mimeMap[ext] || 'image/jpeg';
    const buffer   = fs.readFileSync(filePath);
    const base64   = buffer.toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch (e) {
    console.warn(`  ⚠️  Cannot read image: ${filePath} — setting to null`);
    return null;
  }
}

// ─── Helper: resolve sentenceImage path → data URL ───────────────────────────
function resolveImage(sentenceImage) {
  if (!sentenceImage) return null;
  // Already a data URL (from previous migration run)
  if (sentenceImage.startsWith('data:')) return sentenceImage;
  // Local path like "/images/filename.jpg"
  const filename = path.basename(sentenceImage);
  const fullPath = path.join(IMAGES_DIR, filename);
  return fileToDataUrl(fullPath);
}

// ─── Read JSON helpers ────────────────────────────────────────────────────────
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')); }
  catch { return []; }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function migrate() {
  console.log('\n🚀 VocabMaster — Migration: JSON → MongoDB\n');

  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI is not set in .env! Aborting.');
    process.exit(1);
  }

  await connectDB();
  console.log('✅ Connected to MongoDB\n');

  // ── 1. Vocab ──────────────────────────────────────────────────────────────
  const vocabData = readJson('vocab.json');
  console.log(`📚 Migrating ${vocabData.length} vocab entries…`);

  let vocabMigrated = 0;
  let vocabSkipped  = 0;

  for (const v of vocabData) {
    const exists = await Vocab.findOne({ id: v.id });
    if (exists) { vocabSkipped++; continue; }

    const entry = {
      ...v,
      sentenceImage: resolveImage(v.sentenceImage),
    };
    await Vocab.create(entry);
    vocabMigrated++;

    if (v.sentenceImage && entry.sentenceImage) {
      console.log(`  ✅ ${v.id} — image embedded as Base64`);
    }
  }

  console.log(`   → Migrated: ${vocabMigrated} | Skipped (already in DB): ${vocabSkipped}\n`);

  // ── 2. Tabs ───────────────────────────────────────────────────────────────
  const tabsData = readJson('tabs.json');
  console.log(`🏷️  Migrating ${tabsData.length} tabs…`);

  let tabsMigrated = 0;
  let tabsSkipped  = 0;

  for (const t of tabsData) {
    const exists = await Tab.findOne({ id: t.id });
    if (exists) { tabsSkipped++; continue; }
    await Tab.create(t);
    tabsMigrated++;
  }

  console.log(`   → Migrated: ${tabsMigrated} | Skipped: ${tabsSkipped}\n`);

  // ── 3. Chat History ───────────────────────────────────────────────────────
  const chatData = readJson('chat-history.json');
  console.log(`💬 Migrating ${chatData.length} chat sessions…`);

  let chatMigrated = 0;
  let chatSkipped  = 0;

  for (const s of chatData) {
    const exists = await ChatSession.findOne({ id: s.id });
    if (exists) { chatSkipped++; continue; }
    await ChatSession.create(s);
    chatMigrated++;
  }

  console.log(`   → Migrated: ${chatMigrated} | Skipped: ${chatSkipped}\n`);

  // ── Done ──────────────────────────────────────────────────────────────────
  const totalVocab = await Vocab.countDocuments();
  const totalTabs  = await Tab.countDocuments();
  const totalChat  = await ChatSession.countDocuments();

  console.log('─'.repeat(50));
  console.log('🎉 Migration complete!');
  console.log(`   MongoDB now has: ${totalVocab} vocab | ${totalTabs} tabs | ${totalChat} chat sessions`);
  console.log('─'.repeat(50));
  console.log('\n📌 Next steps:');
  console.log('   1. Verify data tại: https://cloud.mongodb.com');
  console.log('   2. git add -A && git commit && git push');
  console.log('   3. Deploy lên Vercel và thêm env vars: MONGODB_URI + OPENAI_API_KEY\n');

  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
