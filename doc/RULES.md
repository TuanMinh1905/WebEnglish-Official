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
  sentence: string;        // Context sentence — lưu dạng HTML rich text (có thể có <b>, <i>, <span style>...)
                           // Plain text dùng .replace(/<[^>]*>/g, '') khi cần TTS
  sentenceImage: string | null; // Base64 data URL "data:image/...;base64,..." hoặc null
  newWords: string[];      // Mảng từ kèm loại từ viết tắt, ví dụ: ["property (n)", "properly (adv)"]
                           // TTS hook dùng regex .replace(/\s*\([^)]{1,10}\)\s*$/, '') để đọc đúng
  pronunciation: string;   // Phát âm IPA, ví dụ "/ˈkwɒlɪfaɪ/"
  meaning: string;         // Nghĩa tiếng Việt.
                           // - Nhập thủ công (đơn giản): "(v) Đủ điều kiện; tương xứng"
                           // - Batch (word family): dùng " | " làm separator giữa các từ:
                           //   "property (n) : tài sản | properly (adv) : một cách đúng đắn"
                           //   → Display tách ra thành từng dòng riêng
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
| POST | `/api/parse-vocab` | **Smart Batch**: gọi OpenAI parse văn bản → JSON array entries. Body: `{ text, group, sentence }`. AI trả mảng word-family entries, server gán `sentence` từ user vào mỗi entry rồi lưu MongoDB. |
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

### Vocab Card — Color Palette (KHÔNG thay đổi tùy tiện)
```
Sentence (chữ thường) : #dde1e7   — trắng nhẹ, 14px, line-height 1.7
Bold words trong sentence : #a78bfa — violet glow (text-shadow)
Word term "govern (v)"  : #7dd3fc  — sky-blue, font-weight 600
Word separator " : "    : #475569  — xám mờ
Word definition (VN)    : #94a3b8  — slate
Phát âm IPA             : #6ee7b7  — mint-green
Từ đồng nghĩa           : #fbbf24  — warm amber
```

### Classes đã có (KHÔNG đổi tên)
```
.glass-card           → Card nền kính mờ
.btn / .btn-primary / .btn-ghost / .btn-danger / .btn-sm → Buttons
.form-input / .form-textarea → Input fields
.input-group / .form-grid / .full-span → Form layout
.navbar / .navbar-brand / .nav-tab → Navigation
.page-header          → Tiêu đề trang
.word-tag / .word-tag-container / .word-tag-input → Multi-word tags
.vocab-card / .vocab-card-inner / .vocab-card-header → Vocab list items
.vocab-sentence-highlight → Sentence hiển thị đầu card (HTML rich text)
.vocab-word-list / .vocab-word-line → Word family rows
.vocab-word-line-term / .vocab-word-line-sep / .vocab-word-line-def → Parts of each word line
.vocab-meaning        → Nghĩa đơn giản (non-batch entries)
.vocab-pronunciation / .vocab-pronunciation-row → Phát âm
.vocab-synonyms / .synonyms-label → Từ đồng nghĩa
.input-mode-toggle / .mode-toggle-btn → 3-mode input toggle
.batch-input-area / .batch-hint / .batch-textarea / .batch-spinner → Batch mode UI
.convo-input-area     → Giao tiếp mode UI
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
- **Quiz format**: JSON array, số câu do `count` quyết định (1–50), types: `word_to_meaning | meaning_to_word | fill_in | synonym_match | context_usage | it_communication`
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

**Remote**: `https://github.com/TuanMinh1905/WebEnglish.git` — branch **`minhDev`** ⚠️
> `git push origin minhDev` — KHÔNG dùng `main` hay `master` (không tồn tại)

**Production URL**: `https://web-english-official.vercel.app`

> Auto-deploy: mỗi lần `git push origin minhDev` → Vercel tự build + deploy trong ~3 phút

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

## 13. Input Modes — VocabManager

VocabManager có **3 chế độ nhập** (toggle ở đầu form):

| Mode | Button | Mục đích |
|------|--------|---------|
| Smart Batch (AI) | 🤖 | Dán đoạn từ vựng → AI parse → lưu nhiều entries. **Mặc định** |
| Giao tiếp | 💬 | Nhập 1 câu giao tiếp thực tế + giải thích nghĩa |
| Nhập thủ công | 📝 | Nhập từng field riêng lẻ (sentence, words, pronunciation, meaning, synonyms) |

### Smart Batch
- Người dùng paste đoạn văn bản chứa word family
- AI (`/api/parse-vocab`) group theo gốc từ → 1 entry duy nhất
- `newWords`: `["property (n)", "proprietary (adj)", "proper (adj)"]`
- `meaning`: `"property (n) : tài sản | proprietary (adj) : thuộc quyền sở hữu | ..."`
- Separator ` | ` → display tách thành từng dòng riêng
- Có thêm ô **Sentence** (Rich Text Editor) riêng → truyền vào `sentence` field

### Giao tiếp (Convo mode)
- `sentence` = HTML rich text (câu giao tiếp)
- `meaning` = giải thích nghĩa plain text
- `newWords` = `[]` (không có word chips)
- Hiển thị: sentence highlight + meaning dưới

### Nhập thủ công
- Form đầy đủ: Sentence (Rich Text) + Words + Pronunciation + Synonyms + Meaning + Tab
- `newWords` thêm bằng Enter/comma trong word tag input

---

## 14. Vocab Card — Thứ tự hiển thị

```
1. Sentence (vocab-sentence-highlight)
   - Plain text màu #dde1e7
   - Từ in đậm (<b>/<strong>) glow violet #a78bfa
   - Preserve bold/italic/color từ rich text editor

2. Actions row (vocab-card-header)
   - Chỉ: date | ✏️ | 🗑️  (không có word chips)

3. Word list (vocab-word-list)
   - Mỗi dòng: [term sky-blue] [sep dim] [def slate]
   - Parse từ meaning bằng " | " separator
   - Nếu không có " | " → hiển thị plain (vocab-meaning)

4. Pronunciation (vocab-pronunciation)
   - Màu mint-green #6ee7b7

5. Synonyms (vocab-synonyms)
   - Màu amber #fbbf24
   - Prefix: ≈
```

---

## 15. Quiz System — Chi tiết

### Question Types (6 loại)
| Type | Mô tả |
|------|-------|
| `word_to_meaning` | Hiện từ/cụm, hỏi nghĩa tiếng Việt |
| `meaning_to_word` | Hiện nghĩa tiếng Việt, hỏi từ tiếng Anh |
| `fill_in` | Điền từ vào câu có blank `___` |
| `synonym_match` | Tìm từ đồng nghĩa gần nhất |
| `context_usage` | Hiểu nghĩa từ trong ngữ cảnh câu mới |
| `it_communication` | Tình huống giao tiếp IT thực tế (hardcoded pool) |

### IT Communication Questions Pool
- **Vị trí**: `server/server.js` — hằng số `IT_CONVO_QUESTIONS` (10 câu hardcoded)
- **Inject**: Mỗi quiz random **4–6 câu** từ pool này vào câu hỏi từ vựng
- **Nội dung**: standup blocker, client ETA, PR review, production bug, LGTM, Slack after-hours, "Per my last email", email mở đầu, technical debt, Sprint Retro
- **Badge**: màu amber `💬 IT Communication` (CSS class `.it-badge`)
- **KHÔNG** gọi OpenAI cho câu IT — data có sẵn trong code

### QuizQuestion Interface (`src/components/QuizMode.tsx`)
```typescript
interface QuizQuestion {
  type: string;
  question: string;
  options: string[];          // luôn 4 options
  answer: string;             // phải là 1 trong 4 options
  explanation: string;        // 1 câu giải thích ngắn (EN)
  optionExplanations?: string[];   // 4 giải thích EN, 1 per option
  optionExplanationsVi?: string[]; // 4 giải thích VI (bản dịch của trên)
}
```

### Bilingual Explanation UI
- Sau khi chọn đáp án: hiện **2 ô giải thích** chồng nhau
- **Ô 1** `🇬🇧 EN`: giải thích từng option bằng tiếng Anh
- **Ô 2** `🇻🇳 VI`: bản dịch tiếng Việt tương ứng (badge amber)
- Đúng → nền xanh `.expl-opt-correct` | Sai bạn chọn → đỏ `.expl-opt-wrong` | Còn lại → mờ `.expl-opt-neutral`
- CSS classes: `.expl-lang-badge`, `.vi-badge`, `.expl-vi`, `.expl-opt-vi`, `.expl-options-breakdown`
- **Vocab questions**: `optionExplanationsVi` do AI tạo tự động (prompt yêu cầu dịch sang tiếng Việt)
- **IT questions**: `optionExplanationsVi` hardcoded sẵn trong `IT_CONVO_QUESTIONS`

### Rules khi thêm IT questions mới
- Mỗi question object phải có đủ: `type`, `question`, `options[4]`, `answer`, `explanation`, `optionExplanations[4]`, `optionExplanationsVi[4]`
- `answer` phải khớp chính xác với 1 trong 4 strings trong `options`
- Giải thích đúng bắt đầu bằng `✅ Correct:` (EN) / `✅ Đúng:` (VI)
- Giải thích sai bắt đầu bằng `❌` (cả EN lẫn VI)

---

> **Tab persistence**: tab đang chọn lưu vào `localStorage` key `vocabActiveTab`.
> Mỗi lần refresh trang sẽ restore về tab cũ, không cần chọn lại.

---

*Cập nhật lần cuối: 2/10/2026 — Thêm Smart Batch, Giao tiếp mode, unified card design, MongoDB Atlas. Quiz nâng cấp: 5 question types, IT communication pool, bilingual explanation (EN + VI).*
