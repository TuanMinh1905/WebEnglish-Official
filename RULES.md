# VocabMaster — Project Rules for AI Agents

> **Đọc kỹ file này trước khi sửa bất kỳ thứ gì trong project.**
> Mọi thay đổi phải tuân theo các quy tắc dưới đây để không phá vỡ cấu trúc hiện có.

---

## 1. Tech Stack

| Layer | Technology | Version | Ghi chú |
|-------|-----------|---------|---------|
| Frontend | React + TypeScript | CRA (react-scripts) | **KHÔNG** dùng Vite hay Next.js |
| Routing | react-router-dom | v7+ | `BrowserRouter` + `NavLink` + `Routes/Route` |
| Styling | Vanilla CSS | - | `src/index.css` — **KHÔNG** dùng Tailwind |
| Backend | Express.js | **v4** (không phải v5) | Express 5 bị lỗi exit ngay lập tức |
| Database | **MongoDB Atlas** | Mongoose v8+ | Free tier M0, cluster `cluster0.c45of7a.mongodb.net` |
| AI | OpenAI | v7+ | Named import: `const { OpenAI } = require('openai')` |
| Image upload | Multer | - | **Memory storage** → lưu Base64 vào MongoDB (`sentenceImage`) |
| ID generation | UUID | **v9** ⚠️ | `const { v4: uuidv4 } = require('uuid')` — **KHÔNG** dùng v10+ (ESM only, vỡ Vercel) |
| Hosting | **Vercel** | - | Auto-deploy từ GitHub `master` branch |

---

## 2. Cấu trúc thư mục

```
vocab-app/
├── api/
│   └── index.js               ← Vercel serverless entry point (require('../server/server'))
├── data/                      ← Được push lên Git (JSON backup)
│   ├── vocab.json             ← Backup từ vựng (source of truth là MongoDB)
│   ├── tabs.json              ← Backup tabs/groups
│   └── images/                ← Legacy (ảnh nay lưu Base64 trong MongoDB)
├── scripts/
│   └── migrate.js             ← Chạy 1 lần: JSON → MongoDB (`npm run migrate`)
├── server/
│   ├── server.js              ← Backend Express (CommonJS, KHÔNG dùng ESM)
│   └── db.js                  ← MongoDB connection + Mongoose models
├── src/
│   ├── App.tsx                ← Root component + VocabEntry type + BrowserRouter
│   ├── index.css              ← Toàn bộ CSS (design system, tất cả components)
│   └── components/
│       ├── VocabManager.tsx   ← Page /vocab: CRUD form + danh sách
│       ├── QuizMode.tsx       ← Page /quiz: AI quiz generator + tab selector
│       ├── ChatMode.tsx       ← Page /chat: AI conversation + history sidebar
│       └── Toast.tsx          ← Notification system
├── vercel.json                ← Deploy config: builds + routes cho Express + React
├── .env                       ← KHÔNG push Git (chứa API keys + MONGODB_URI)
├── .gitignore                 ← data/ được include, .env được exclude
└── package.json               ← proxy: "http://localhost:3002"
```

---

## 3. Data Model — VocabEntry

```typescript
// Định nghĩa trong src/App.tsx — phải sync với server/db.js
export interface VocabEntry {
  id: string;              // UUID v4
  sentence: string;        // Context sentence (text), hoặc '' nếu dùng ảnh
  sentenceImage: string | null; // Base64 data URL "data:image/...;base64,..." hoặc null
  newWords: string[];      // Mảng từ (word family), ví dụ ["qualify","qualification"]
  pronunciation: string;   // Phát âm IPA, ví dụ "/ˈkwɒlɪfaɪ/"
  meaning: string;         // Nghĩa tiếng Việt, ví dụ "(v) Đủ điều kiện"
  synonyms: string;        // Từ đồng nghĩa, ví dụ "eligible, certified"
  group: string;           // Tên tab/group, ví dụ "T9/2026" hoặc "" nếu chưa phân nhóm
  dateAdded: string;       // Định dạng vi-VN: "26/9/2026"
}

// Tab model — lưu trong MongoDB collection "tabs"
interface Tab {
  id: string;    // UUID v4
  name: string;  // Tên tab, ví dụ "T9/2026"
  color: string; // Màu hex, ví dụ "#8b5cf6"
}

// ChatSession model — lưu trong MongoDB collection "chatsessions"
interface ChatSession {
  id: string;
  topic: string;
  topicLabel: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  savedAt: string;      // ISO date string
  messageCount: number; // số lượt user message
}
```

> **QUAN TRỌNG**: Nếu thêm field mới vào VocabEntry, phải cập nhật cả:
> - `src/App.tsx` (TypeScript interface)
> - `server/db.js` (Mongoose Schema)
> - `server/server.js` (POST /api/vocab handler)
> - `src/components/VocabManager.tsx` (form + display)

---

## 4. API Endpoints

| Method | Endpoint | Mô tả |
|--------|---------|-------|
| GET | `/api/vocab` | Lấy toàn bộ vocab từ MongoDB |
| POST | `/api/vocab` | Thêm entry mới, tự gán `id` (UUID) và `dateAdded` |
| PUT | `/api/vocab/:id` | Cập nhật entry theo id |
| DELETE | `/api/vocab/:id` | Xóa entry khỏi MongoDB |
| POST | `/api/upload` | Upload ảnh → convert Base64 → trả về `{ url: "data:image/..." }` |
| POST | `/api/quiz` | Gọi OpenAI tạo câu trắc nghiệm — nhận `{ vocabList, count }`, count từ 1–50 |
| POST | `/api/chat` | Gọi OpenAI chat với systemPrompt, trả về `{ reply }` |
| GET | `/api/tabs` | Lấy danh sách tabs từ MongoDB |
| POST | `/api/tabs` | Tạo tab mới `{ name, color }` |
| PUT | `/api/tabs/:id` | Đổi tên tab + cập nhật `group` trên tất cả vocab thuộc tab đó |
| DELETE | `/api/tabs/:id` | Xóa tab, các vocab thuộc tab đó → `group: ""` |
| GET | `/api/chat-history` | Lấy tất cả chat sessions (mới nhất trước) |
| POST | `/api/chat-history` | Lưu 1 session mới |
| DELETE | `/api/chat-history/:id` | Xóa 1 session |
| DELETE | `/api/chat-history` | Xóa tất cả sessions |

> Local dev: proxy `/api/*` → `http://localhost:3002` (cấu hình trong `package.json`)
> Production: Vercel route `/api/*` → `api/index.js` serverless function

---

## 5. Ports

| Service | Port | Cố định? |
|---------|------|---------|
| React dev server | **3000** | Cố định bằng `set PORT=3000` trong package.json scripts |
| Express backend | **3002** | Cố định trong `.env` (PORT=3002) |

> **KHÔNG** thay đổi port mà không cập nhật cả `package.json` proxy và `.env`

---

## 6. MongoDB — Quan trọng

### Kết nối
```js
// server/db.js — connection được cache để không reconnect mỗi request
const mongoose = require('mongoose');
let connectionPromise = null;
async function connectDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!connectionPromise) connectionPromise = mongoose.connect(process.env.MONGODB_URI, { dbName: 'vocabmaster' });
  await connectionPromise;
}
```

### Collections trong database `vocabmaster`
- `vocabs` — từ vựng
- `tabs` — nhóm/tab
- `chatsessions` — lịch sử chat

### Lỗi thường gặp
- `ERR_REQUIRE_ESM` với uuid → **uuid phải là v9**, KHÔNG dùng v10+
- `MONGODB_URI not set` → kiểm tra `.env` local hoặc Vercel Environment Variables
- Mongoose model re-registration (HMR) → dùng `mongoose.models.X || mongoose.model('X', schema)`

---

## 7. CSS Design System (`src/index.css`)

### CSS Variables (định nghĩa ở `:root`)
```
--bg-primary      Nền chính: #0f1117
--bg-secondary    Card/panel nền
--accent          Màu chính: tím #8b5cf6
--accent-2        Màu phụ: indigo #6366f1
--text-primary    Chữ chính: trắng
--text-secondary  Chữ phụ: xám nhạt
--text-muted      Chữ mờ
--border          Viền: rgba trắng mờ
--border-focus    Viền khi focus: var(--accent)
--font            Font chữ: 'Inter'
--mono            Font mono: 'JetBrains Mono'
--radius          Border radius lớn: 12px
--radius-sm       Border radius nhỏ: 8px
```

### Rules CSS
- Dark mode glassmorphism — nền tối, các card dùng `background: rgba(255,255,255,0.04)`
- KHÔNG dùng class utility kiểu Tailwind
- KHÔNG dùng CSS modules — tất cả styles trong `src/index.css`
- Thêm style mới → append vào cuối `index.css`, TRƯỚC `/* Responsive */`
- Animations/transitions: dùng `transition: all 0.2s ease`

### Classes đã có (KHÔNG đổi tên)
```
.glass-card           → Card nền kính mờ
.btn / .btn-primary / .btn-ghost / .btn-danger / .btn-sm → Buttons
.form-input / .form-textarea → Input fields
.input-group / .form-grid / .full-span → Form layout
.navbar / .navbar-brand / .nav-tab → Navigation
.page-header          → Tiêu đề trang
.word-tag / .word-tag-container / .word-tag-input → Multi-word tags
.vocab-card / .vocab-card-inner / .vocab-word-chip → Vocab list items
.sentence-mode-toggle / .mode-btn → Text/Image toggle
.image-upload-area / .upload-placeholder → Image upload zone
.chat-messages / .msg-bubble / .chat-input-area → Chat UI
.chat-layout / .chat-history-sidebar / .chat-history-item → History sidebar
.corrections / .correction-item → Grammar corrections
.vtab / .vtab-active / .vtab-count → Vocab group tab bar
.quiz-setup-card / .quiz-preset-btn / .quiz-group-btn → Quiz setup UI
.option-btn / .option-label / .option-text → Quiz answer options
.explanation-box / .expl-correct / .expl-wrong → Quiz instant feedback
.result-score-ring / .result-chips / .result-review → Quiz result page
```

---

## 8. Navigation (3 pages — React Router)

| NavLink ID | Route | Component |
|------------|-------|-----------|
| `tab-vocab` | `/vocab` | `VocabManager` |
| `tab-quiz` | `/quiz` | `QuizMode` |
| `tab-chat` | `/chat` | `ChatMode` |

> Root `/` redirect về `/vocab`.

---

## 9. OpenAI Configuration

- **Model**: `gpt-4o-mini` (nhanh + rẻ)
- **Import trong server**: `const { OpenAI } = require('openai')` — named import, không phải default
- **Quiz format**: JSON array, số câu do `count` quyết định (1–50), types: `word_to_meaning | meaning_to_word | fill_in`
- **Chat format**: AI reply kèm `---` section có `📝 **Corrections:**` hoặc `✨ Great job!`

---

## 10. Git / Backup Rules

```
Push lên Git:
  - Toàn bộ source code (src/, server/, api/, scripts/, public/)
  - data/vocab.json  ← JSON backup (source of truth là MongoDB)
  - data/tabs.json
  - data/images/     ← Legacy folder (giữ lại để tham chiếu)
  - package.json, package-lock.json
  - vercel.json, .gitignore, RULES.md

KHÔNG push lên Git:
  - .env  (chứa OPENAI_API_KEY + MONGODB_URI)
  - data/chat-history.json  (personal, local only)
  - node_modules/
  - build/
```

**Remote**: `https://github.com/TuanMinh1905/WebEnglish-Official.git` — branch `master`
**Production URL**: `https://web-english-official.vercel.app`

> Auto-deploy: mỗi lần `git push origin master` → Vercel tự build + deploy trong ~3 phút

---

## 11. Lỗi Thường Gặp

| Lỗi | Nguyên nhân | Fix |
|-----|-------------|-----|
| `ERR_REQUIRE_ESM` trên Vercel | uuid v10+ là ESM only | `npm install uuid@9` |
| `MONGODB_URI not set` | Chưa thêm vào .env hoặc Vercel env vars | Thêm vào .env + Vercel dashboard |
| ESLint error `is assigned a value but never used` | Vercel CI dùng `CI=true`, warnings = errors | Xóa biến không dùng |
| Port conflict local | Node process cũ chưa tắt | `Get-Process node \| Stop-Process -Force` |
| Express v5 exit ngay | Express 5 không tương thích | Dùng Express **v4** |
| MongoDB model re-register | Hot reload tái khởi tạo model | `mongoose.models.X \|\| mongoose.model('X', schema)` |

---

## 12. Khởi động Development

```bash
# Trong thư mục vocab-app/
npm run dev

# Kết quả mong đợi:
# [0] ✅ VocabMaster API running at http://localhost:3002
# [0] 🍃 MongoDB: Connected
# [1] Compiled successfully!
# [1] Local: http://localhost:3000
```

```bash
# Migrate dữ liệu từ JSON → MongoDB (chạy 1 lần duy nhất)
npm run migrate
```

```powershell
# Nếu bị lỗi port occupied:
Get-Process node | Stop-Process -Force
npm run dev
```

---

*Cập nhật lần cuối: 26/9/2026 — Đã migrate sang MongoDB Atlas + deploy Vercel.*
