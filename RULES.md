# VocabMaster — Project Rules for AI Agents

> **Đọc kỹ file này trước khi sửa bất kỳ thứ gì trong project.**
> Mọi thay đổi phải tuân theo các quy tắc dưới đây để không phá vỡ cấu trúc hiện có.

---

## 1. Tech Stack

| Layer | Technology | Version | Ghi chú |
|-------|-----------|---------|---------|
| Frontend | React + TypeScript | CRA (react-scripts) | **KHÔNG** dùng Vite hay Next.js |
| Styling | Vanilla CSS | - | `src/index.css` — **KHÔNG** dùng Tailwind |
| Backend | Express.js | **v4** (không phải v5) | Express 5 bị lỗi exit ngay lập tức |
| Storage | JSON file | - | `data/vocab.json` — **KHÔNG** dùng Google Sheets hay DB |
| AI | OpenAI | v7+ | Named import: `const { OpenAI } = require('openai')` |
| Image upload | Multer | - | Upload vào `data/images/` |
| ID generation | UUID | v4 | `const { v4: uuidv4 } = require('uuid')` |

---

## 2. Cấu trúc thư mục

```
vocab-app/
├── data/                      ← Được push lên Git
│   ├── vocab.json             ← Database (JSON array of VocabEntry)
│   └── images/                ← Ảnh đính kèm sentence
├── server/
│   └── server.js              ← Backend Express (CommonJS, KHÔNG dùng ESM)
├── src/
│   ├── App.tsx                ← Root component + VocabEntry type + navigation
│   ├── index.css              ← Toàn bộ CSS (design system, tất cả components)
│   └── components/
│       ├── VocabManager.tsx   ← Tab Vocab: CRUD form + danh sách
│       ├── QuizMode.tsx       ← Tab Quiz: AI quiz generator
│       ├── ChatMode.tsx       ← Tab Chat: AI conversation + corrections
│       └── Toast.tsx          ← Notification system
├── .env                       ← KHÔNG push Git (chứa API keys)
├── .gitignore                 ← data/ được include, .env được exclude
└── package.json               ← proxy: "http://localhost:3002"
```

---

## 3. Data Model — VocabEntry

```typescript
// Định nghĩa trong src/App.tsx — phải sync với server/server.js
export interface VocabEntry {
  id: string;              // UUID v4
  sentence: string;        // Context sentence (text), hoặc '' nếu dùng ảnh
  sentenceImage: string | null; // URL path ví dụ "/images/abc.jpg", hoặc null
  newWords: string[];      // Mảng từ (word family), ví dụ ["qualify","qualification"]
  pronunciation: string;   // Phát âm IPA, ví dụ "/ˈkwɒlɪfaɪ/"
  meaning: string;         // Nghĩa tiếng Việt, ví dụ "(v) Đủ điều kiện"
  synonyms: string;        // Từ đồng nghĩa, ví dụ "eligible, certified"
  dateAdded: string;       // Định dạng vi-VN: "26/9/2026"
}
```

> **QUAN TRỌNG**: Nếu thêm field mới vào VocabEntry, phải cập nhật cả:
> - `src/App.tsx` (TypeScript interface)
> - `server/server.js` (POST /api/vocab handler)
> - `src/components/VocabManager.tsx` (form + display)

---

## 4. API Endpoints

| Method | Endpoint | Mô tả |
|--------|---------|-------|
| GET | `/api/vocab` | Lấy toàn bộ danh sách từ `data/vocab.json` |
| POST | `/api/vocab` | Thêm entry mới, tự gán `id` (UUID) và `dateAdded` |
| PUT | `/api/vocab/:id` | Cập nhật entry theo id |
| DELETE | `/api/vocab/:id` | Xóa entry + xóa file ảnh nếu có |
| POST | `/api/upload` | Upload ảnh → lưu vào `data/images/`, trả về `{ url }` |
| POST | `/api/quiz` | Gọi OpenAI tạo 5 câu trắc nghiệm từ vocabList |
| POST | `/api/chat` | Gọi OpenAI chat với systemPrompt, trả về `{ reply }` |

> Frontend dùng proxy: mọi request `/api/*` được forward đến `http://localhost:3002`
> Cấu hình proxy ở `package.json` → `"proxy": "http://localhost:3002"`

---

## 5. Ports

| Service | Port | Cố định? |
|---------|------|---------|
| React dev server | **3000** | Cố định bằng `set PORT=3000` trong package.json scripts |
| Express backend | **3002** | Cố định trong `.env` (PORT=3002) |

> **KHÔNG** thay đổi port mà không cập nhật cả `package.json` proxy và `.env`

---

## 6. CSS Design System (`src/index.css`)

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
.corrections / .correction-item → Grammar corrections
```

---

## 7. Navigation (3 pages — React Router)

| NavLink ID | Route | Component |
|------------|-------|-----------|
| `tab-vocab` | `/vocab` | `VocabManager` |
| `tab-quiz` | `/quiz` | `QuizMode` |
| `tab-chat` | `/chat` | `ChatMode` |

> Dùng `react-router-dom` — `BrowserRouter` ở `App.tsx`, `NavLink` trong navbar (tự thêm class `active` khi match route), `Routes/Route` trong `<main>`.
> Root `/` redirect về `/vocab`. Để thêm page mới: tạo component, thêm `<NavLink>` trong navbar, thêm `<Route>` trong `<Routes>`.

---

## 8. OpenAI Configuration

- **Model**: `gpt-4o-mini` (nhanh + rẻ)
- **Import trong server**: `const { OpenAI } = require('openai')` — named import, không phải default
- **Quiz format**: JSON array, 5 câu, types: `word_to_meaning | meaning_to_word | fill_in`
- **Chat format**: AI reply kèm `---` section có `📝 **Corrections:**` hoặc `✨ Great job!`

---

## 9. Git / Backup Rules

```
Push lên Git:
  - Toàn bộ source code (src/, server/, public/)
  - data/vocab.json (vocabulary database)
  - data/images/ (sentence images)
  - package.json, package-lock.json
  - .gitignore, RULES.md

KHÔNG push lên Git:
  - .env (chứa OPENAI_API_KEY)
  - google-key.json
  - node_modules/
  - build/
```

---

## 10. Rules Khi Thêm Feature Mới

1. **Thêm field vào VocabEntry** → Sửa 3 nơi: `App.tsx` (type) + `server.js` (POST handler) + `VocabManager.tsx` (form + display)
2. **Thêm API endpoint** → Chỉ sửa `server/server.js`, không tạo file backend mới
3. **Thêm component** → Tạo file trong `src/components/`, import vào `App.tsx`
4. **Thêm styles** → Append vào `src/index.css`, dùng CSS variables đã có
5. **KHÔNG** install thêm CSS framework (Tailwind, Bootstrap, etc.)
6. **KHÔNG** chuyển sang Express v5 — bị lỗi silent exit trên Node.js v22
7. **KHÔNG** chuyển sang ESM (import/export) trong server — dùng CommonJS (require)
8. **KHÔNG** thay đổi cấu trúc `data/vocab.json` mà không có migration plan

---

## 11. Khởi động Development

```bash
# Trong thư mục vocab-app/
npm run dev

# Kết quả mong đợi:
# [0] VocabMaster API running at http://localhost:3002
# [1] Compiled successfully!
# [1] Local: http://localhost:3000
```

Nếu bị lỗi port occupied, dùng PowerShell:
```powershell
Get-Process node | Stop-Process -Force
npm run dev
```

---

*Cập nhật file này mỗi khi thay đổi cấu trúc quan trọng của project.*
