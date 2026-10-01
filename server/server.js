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

// ─── IT Communication questions pool ─────────────────────────────────────────
const IT_CONVO_QUESTIONS = [
  {
    type: 'it_communication',
    question: 'In a standup meeting, your task is delayed. What is the most professional way to communicate this?',
    options: [
      'I\'m blocked on the API integration — I need help from the backend team to unblock me.',
      'I didn\'t finish because it was too hard.',
      'I will try my best to finish it today.',
      'The task is delayed, not my fault.'
    ],
    answer: 'I\'m blocked on the API integration — I need help from the backend team to unblock me.',
    explanation: 'Option A is correct: it clearly states the blocker, identifies the dependency, and signals what\'s needed.',
    optionExplanations: [
      '✅ Correct: Clear blocker + dependency + next action. This is the standard pattern in Agile standups.',
      '❌ Vague and unprofessional — no specific blocker, no request for help.',
      '❌ Too vague — doesn\'t communicate a blocker or ETA. Use this only if no blocker exists.',
      '❌ Defensive tone, no actionable info. Never blame-shift in professional standups.'
    ],
    optionExplanationsVi: [
      '✅ Đúng: Nêu rõ blocker + team phụ thuộc + hành động cần làm. Đây là chuẩn mực trong standup Agile.',
      '❌ Mơ hồ và thiếu chuyên nghiệp — không nêu blocker cụ thể, không xin hỗ trợ.',
      '❌ Quá chung chung — không truyền đạt được blockerr hay ETA. Chỉ dùng khi không có blocker.',
      '❌ Giọng điệu đổ lỗi, không có thông tin hành động. Không bao giờ đùn đẩy trách nhiệm trong standup.'
    ]
  },
  {
    type: 'it_communication',
    question: 'A client asks: "When will this feature be ready?" You\'re uncertain. Which reply is best?',
    options: [
      'I\'ll have it done by tomorrow.',
      'I\'m not sure, maybe next week.',
      'Based on current progress, we\'re estimating end of this sprint (Friday). I\'ll keep you updated if anything changes.',
      'It depends on many factors, I cannot say.'
    ],
    answer: 'Based on current progress, we\'re estimating end of this sprint (Friday). I\'ll keep you updated if anything changes.',
    explanation: 'Option C gives a specific estimate, grounds it in current data, and promises follow-up.',
    optionExplanations: [
      '❌ Overpromising — risky if you\'re uncertain. Never commit to a deadline you can\'t be confident about.',
      '❌ Too vague. "Maybe next week" doesn\'t give the client anything to plan around.',
      '✅ Correct: Specific timeframe + data-based reasoning + follow-up commitment = professional ETA response.',
      '❌ Evasive. This frustrates clients. Always provide your best estimate with caveats instead.'
    ],
    optionExplanationsVi: [
      '❌ Hứa hẹn quá mức — rủi ro cao nếu bạn chưa chắc chắn. Đừng cam kết deadline không tự tin được.',
      '❌ Quá mơ hồ. "Có thể tuần sau" không giúp khách hàng lên kế hoạch được gì.',
      '✅ Đúng: Có mốc thời gian cụ thể + dựa trên tiến độ thực tế + cam kết cập nhật = chuẩn mực giao tiếp ETA.',
      '❌ Né tránh câu hỏi. Luôn đưa ra ước tính tốt nhất kèm lưu ý thay vì từ chối trả lời.'
    ]
  },
  {
    type: 'it_communication',
    question: 'Your PR (Pull Request) receives this comment: "This could be refactored." How should you respond?',
    options: [
      'I disagree, my code is fine as is.',
      'Thanks for the feedback! Could you suggest the preferred pattern? Happy to refactor if it improves maintainability.',
      'OK I will fix it.',
      'Why do you think it needs refactoring?'
    ],
    answer: 'Thanks for the feedback! Could you suggest the preferred pattern? Happy to refactor if it improves maintainability.',
    explanation: 'Option B acknowledges feedback positively, asks for guidance, and shows willingness to improve.',
    optionExplanations: [
      '❌ Defensive. Code reviews are collaborative, not competitive. Always stay open to feedback.',
      '✅ Correct: Grateful tone + clarifying question + openness to improve = ideal PR response etiquette.',
      '❌ Too passive. "OK I will fix it" gives no signal you understood what or why needs changing.',
      '❌ "Why?" can sound confrontational in text. Better to ask "Could you clarify?" or "What pattern do you prefer?"'
    ],
    optionExplanationsVi: [
      '❌ Phòng thủ. Code review là cộng tác, không phải thi đấu. Hãy luôn cởi mở với phản hồi.',
      '✅ Đúng: Tông giọng biết ơn + hỏi làm rõ + sẵn sàng cải thiện = cách phản hồi PR lý tưởng.',
      '❌ Quá thụ động. "OK tôi sẽ sửa" không cho thấy bạn hiểu cần sửa gì và tại sao.',
      '❌ "Tại sao?" nghe có vẻ thách thức qua văn bản. Tốt hơn nên hỏi "Bạn có thể làm rõ không?"'
    ]
  },
  {
    type: 'it_communication',
    question: 'You find a critical bug in production on Friday evening. What is the correct action?',
    options: [
      'Fix it quietly and deploy without telling anyone.',
      'Wait until Monday to report it.',
      'Immediately notify your team lead, assess severity, and follow your incident response protocol.',
      'Post it in the general chat and wait for someone else to handle it.'
    ],
    answer: 'Immediately notify your team lead, assess severity, and follow your incident response protocol.',
    explanation: 'Option C: production incidents require immediate escalation, severity assessment, and structured response.',
    optionExplanations: [
      '❌ Silent fixes bypass team awareness and can introduce new issues without review or communication.',
      '❌ A production bug left unaddressed over a weekend can cause significant business impact.',
      '✅ Correct: Notify → Assess → Respond. This is the Incident Response golden rule in IT ops.',
      '❌ General chat creates noise without accountability. Always escalate directly to your on-call or team lead.'
    ],
    optionExplanationsVi: [
      '❌ Sửa lặng lẽ bỏ qua nhận thức của nhóm và có thể gây thêm lỗi mới mà không ai hay biết.',
      '❌ Bug production để qua cuối tuần có thể gây thiệt hại nghiêm trọng cho hoạt động kinh doanh.',
      '✅ Đúng: Thông báo → Đánh giá mức độ → Xử lý. Đây là quy tắc vàng trong Incident Response IT.',
      '❌ Chat chung tạo ra nhiễu loạn mà không có trách nhiệm rõ ràng. Luôn leo thang thẳng đến team lead.'
    ]
  },
  {
    type: 'it_communication',
    question: 'What does "LGTM" mean in a code review context?',
    options: [
      'Let\'s Get The Meeting (start a meeting)',
      'Looks Good To Me (approval)',
      'Latest Git Tag Merged (git term)',
      'Log Generation Task Manager (DevOps tool)'
    ],
    answer: 'Looks Good To Me (approval)',
    explanation: '"LGTM" is used in code reviews to indicate approval for merging.',
    optionExplanations: [
      '❌ No such abbreviation exists. LGTM has nothing to do with meetings.',
      '✅ Correct: "Looks Good To Me" — the standard approval signal in GitHub/GitLab PR reviews.',
      '❌ Not a real Git term. Don\'t confuse technical acronyms with communication ones.',
      '❌ Invented. LGTM is strictly a communication shorthand, not a DevOps tool name.'
    ],
    optionExplanationsVi: [
      '❌ Viết tắt này không tồn tại. LGTM không liên quan gì đến cuộc họp.',
      '✅ Đúng: "Looks Good To Me" — tín hiệu phê duyệt tiêu chuẩn trong review PR trên GitHub/GitLab.',
      '❌ Không phải thuật ngữ Git thực sự. Đừng nhầm lẫn viết tắt kỹ thuật với viết tắt giao tiếp.',
      '❌ Bịa đặt. LGTM là viết tắt giao tiếp thuần túy, không phải tên công cụ DevOps.'
    ]
  },
  {
    type: 'it_communication',
    question: 'A colleague sends you a Slack message at 11 PM about a non-urgent issue. What is the most professional response?',
    options: [
      'Reply immediately to show dedication.',
      'Ignore it — it\'s after hours.',
      'Acknowledge the next morning: "Got it, will look into this first thing today."',
      'Tell them never to message you after hours again.'
    ],
    answer: 'Acknowledge the next morning: "Got it, will look into this first thing today."',
    explanation: 'Option C: acknowledge at the start of the next workday — professional without encouraging "always-on" culture.',
    optionExplanations: [
      '❌ For non-urgent issues, late replies reinforce unhealthy expectations of 24/7 availability.',
      '❌ Ignoring with no follow-up can leave colleagues uncertain whether you saw the message.',
      '✅ Correct: Acknowledge promptly at the start of the next day — clear, professional, and respects boundaries.',
      '❌ Aggressive tone. Better to set expectations calmly, or use "Do Not Disturb" settings proactively.'
    ],
    optionExplanationsVi: [
      '❌ Với vấn đề không khẩn, trả lời trễ củng cố kỳ vọng không lành mạnh về khả năng làm việc 24/7.',
      '❌ Bỏ qua không theo dõi khiến đồng nghiệp không biết bạn có thấy tin nhắn không.',
      '✅ Đúng: Xác nhận ngay đầu ngày làm việc tiếp theo — rõ ràng, chuyên nghiệp và tôn trọng ranh giới.',
      '❌ Tông giọng hung hăng. Tốt hơn nên thiết lập kỳ vọng nhẹ nhàng hoặc dùng "Không làm phiền" proactively.'
    ]
  },
  {
    type: 'it_communication',
    question: 'In an email thread about a technical decision, someone writes "Per my last email..." — what tone does this convey?',
    options: [
      'Friendly reminder',
      'Technical update',
      'Passive-aggressive frustration (I already said this)',
      'Formal escalation'
    ],
    answer: 'Passive-aggressive frustration (I already said this)',
    explanation: '"Per my last email" is a passive-aggressive phrase signaling frustration that a previous message was ignored.',
    optionExplanations: [
      '❌ The phrase sounds polite on the surface but is widely understood as a subtle reprimand.',
      '❌ "Per my last email" has no technical connotation — it\'s purely a communication tone marker.',
      '✅ Correct: This is a well-known passive-aggressive phrase in workplace English, signaling frustration.',
      '❌ It\'s not a formal escalation — that would involve CC-ing managers or using specific escalation language.'
    ],
    optionExplanationsVi: [
      '❌ Cụm từ nghe có vẻ lịch sự bề ngoài nhưng được hiểu rộng rãi là một lời khiển trách kín đáo.',
      '❌ "Per my last email" không mang nghĩa kỹ thuật — đây thuần túy là dấu hiệu về tông giọng giao tiếp.',
      '✅ Đúng: Đây là cụm từ passive-aggressive nổi tiếng trong tiếng Anh công sở, báo hiệu sự bực bội.',
      '❌ Đây không phải leo thang chính thức — leo thang thực sự cần CC quản lý hay dùng ngôn ngữ escalation cụ thể.'
    ]
  },
  {
    type: 'it_communication',
    question: 'Which phrase best opens a professional technical email to a client you\'ve never met?',
    options: [
      'Hey! Hope you\'re well!',
      'I am writing to you today because...',
      'Hope this email finds you well. My name is [Name] from [Team], reaching out regarding [Topic].',
      'As per your request, please see below.'
    ],
    answer: 'Hope this email finds you well. My name is [Name] from [Team], reaching out regarding [Topic].',
    explanation: 'Option C is warm but professional, self-introduces clearly, and states purpose immediately.',
    optionExplanations: [
      '❌ Too informal for a first-contact professional email, especially with a new client.',
      '❌ "I am writing to you because" is outdated business English — it sounds stiff and verbose.',
      '✅ Correct: Warm greeting + self-intro + clear purpose = the gold standard for professional first-contact emails.',
      '❌ "As per your request" implies prior communication — inappropriate for an introduction email.'
    ],
    optionExplanationsVi: [
      '❌ Quá thân mật cho email chuyên nghiệp lần đầu gặp, đặc biệt với khách hàng mới.',
      '❌ "Tôi viết thư cho bạn vì..." là tiếng Anh công sở cổ lỗ — nghe cứng nhắc và dài dòng.',
      '✅ Đúng: Chào hỏi thân thiện + tự giới thiệu + nêu mục đích = chuẩn vàng cho email lần đầu tiếp xúc.',
      '❌ "As per your request" ngụ ý đã có giao tiếp trước — không phù hợp cho email giới thiệu.'
    ]
  },
  {
    type: 'it_communication',
    question: 'What is "technical debt" in a team discussion context?',
    options: [
      'Money owed to software vendors',
      'The cost of choosing a quick/easy solution now, creating more work later',
      'A bug that hasn\'t been fixed in a long time',
      'Outstanding invoices for developer salaries'
    ],
    answer: 'The cost of choosing a quick/easy solution now, creating more work later',
    explanation: '"Technical debt" refers to the future cost of rework caused by choosing an expedient solution now.',
    optionExplanations: [
      '❌ "Debt" here is a metaphor, not a financial obligation to vendors.',
      '✅ Correct: Technical debt = shortcuts taken now → extra work/refactoring needed later.',
      '❌ An old bug is a "legacy bug" or "known issue," not technical debt specifically.',
      '❌ Developer compensation has nothing to do with technical debt.'
    ],
    optionExplanationsVi: [
      '❌ "Nợ" ở đây là ẩn dụ, không phải nghĩa vụ tài chính thực sự với nhà cung cấp.',
      '✅ Đúng: Nợ kỹ thuật = giải pháp tắt bây giờ → phải refactor/làm lại nhiều hơn sau này.',
      '❌ Bug cũ lâu chưa sửa gọi là "legacy bug" hoặc "known issue", không phải technical debt.',
      '❌ Lương developer không liên quan gì đến technical debt.'
    ]
  },
  {
    type: 'it_communication',
    question: 'Your team is using Scrum. What is the main purpose of a "Sprint Retrospective"?',
    options: [
      'To plan the next sprint\'s tasks',
      'To demo completed features to stakeholders',
      'To reflect on what went well, what didn\'t, and how to improve the team\'s process',
      'To review code quality metrics'
    ],
    answer: 'To reflect on what went well, what didn\'t, and how to improve the team\'s process',
    explanation: 'Sprint Retrospective is focused entirely on team process improvement, not planning or demos.',
    optionExplanations: [
      '❌ Sprint Planning happens at the START of a sprint, not the end.',
      '❌ That\'s the Sprint Review (Demo), a separate Scrum ceremony.',
      '✅ Correct: Retro = team reflection + continuous improvement. Core to the Agile mindset.',
      '❌ Code quality reviews happen in code review sessions or via automated tools, not in Retros.'
    ],
    optionExplanationsVi: [
      '❌ Sprint Planning diễn ra ở ĐẦU sprint, không phải cuối sprint.',
      '❌ Đó là Sprint Review (Demo), một buổi lễ Scrum riêng biệt.',
      '✅ Đúng: Retro = nhóm nhìn lại + cải tiến liên tục. Cốt lõi của tư duy Agile.',
      '❌ Đánh giá chất lượng code diễn ra trong code review session hoặc qua công cụ tự động, không phải Retro.'
    ]
  }
];

// ─── Quiz Endpoint ────────────────────────────────────────────────────────────
app.post('/api/quiz', async (req, res) => {
  try {
    const { vocabList, count } = req.body;
    const numQuestions = Math.max(1, Math.min(parseInt(count) || 5, 50));
    if (!vocabList || vocabList.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 vocab items.' });
    }

    // ── Inject 4–6 random IT communication questions ──────────────────────────
    const itCount = Math.min(Math.floor(Math.random() * 3) + 4, numQuestions); // 4–6 IT questions
    const shuffledIT = [...IT_CONVO_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, itCount);
    const vocabCount = numQuestions - itCount;

    let vocabQuestions = [];

    if (vocabCount > 0 && vocabList.length >= 2) {
      const vocabText = vocabList.map((v, i) => {
        const words   = Array.isArray(v.newWords) ? v.newWords.join(', ') : (v.newWords || '');
        const synPart  = v.synonyms ? ` | Synonyms: "${v.synonyms}"`   : '';
        const sentPart = v.sentence ? ` | Sentence: "${v.sentence.replace(/<[^>]*>/g, '')}"` : '';
        const meaningPart = v.meaning || '';
        return `${i + 1}. Word(s): "${words}" | Meaning: "${meaningPart}"${synPart}${sentPart}`;
      }).join('\n');

      const prompt = `You are an English vocabulary quiz generator for an IT professional learning English.
Based on the vocabulary list below, generate exactly ${vocabCount} multiple-choice questions.
Each question MUST have exactly 4 options and exactly 1 correct answer.

Mix these question types creatively (spread them evenly):
- "word_to_meaning": Show the English word/phrase, ask which Vietnamese meaning is correct
- "meaning_to_word": Show the Vietnamese meaning, ask which English word matches
- "fill_in": Show the context sentence with the target word blanked as "___", ask which word fits
- "synonym_match": Ask which word from the options is a synonym/closest in meaning to the target
- "context_usage": Show a new sentence using the word in context, ask what the word means in that context

Rules:
- Wrong options must be plausible (similar-sounding words, related meanings, or from other vocabulary in the list)
- The "explanation" field: write a SHORT 1-sentence reason why the correct answer is right (in English)
- The "optionExplanations" field: array of 4 strings in ENGLISH, one per option. Correct → start with "✅ Correct: " + reason. Wrong → start with "❌ " + brief reason.
- The "optionExplanationsVi" field: array of 4 strings — the EXACT Vietnamese translation of "optionExplanations". Correct → start with "✅ Đúng: ". Wrong → start with "❌ ".
- Questions should cover vocabulary words, phrases, AND sentence usage patterns
- Shuffle the position of the correct answer randomly among options A–D

Vocabulary list:
${vocabText}

Return ONLY a valid JSON array with exactly ${vocabCount} items (no markdown, no extra text):
[{"type":"word_to_meaning","question":"...","options":["...","...","...","..."],"answer":"...","explanation":"...","optionExplanations":["...","...","...","..."],"optionExplanationsVi":["...","...","...","..."]}]`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.75,
      });
      const raw = completion.choices[0].message.content.trim();
      vocabQuestions = JSON.parse(raw);
    }

    // Merge vocab questions + IT questions, then shuffle
    const allQuestions = [...vocabQuestions, ...shuffledIT].sort(() => Math.random() - 0.5);
    res.json(allQuestions);
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

// ─── Parse Vocab Batch Endpoint ───────────────────────────────────────────────
// POST /api/parse-vocab — parse free-form text into structured VocabEntry array
app.post('/api/parse-vocab', async (req, res) => {
  try {
    const { text, group, sentence: batchSentence } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

    const prompt = `You are an English vocabulary extractor. The user has pasted a block of Vietnamese-annotated English vocabulary text.
Parse it and return a JSON array. Each element represents ONE entry for a WORD FAMILY GROUP.

Rules:
1. GROUP all word forms of the same root into ONE single entry (do NOT create separate entries per form).
   Example: "property (n)", "proprietary (adj)", "proper (adj)", "properly (adv)" → ALL go into ONE entry.
2. "newWords": array of ALL the English word forms, each with its part of speech abbreviation appended.
   Format: "word (pos)" — use short abbreviations: (n), (v), (adj), (adv), (phrase), (prep), etc.
   Example: ["property (n)", "proprietary (adj)", "proper (adj)", "properly (adv)"]
3. "meaning": a single combined string with each form's Vietnamese meaning only (no need to repeat the word name since it's in newWords), format:
   "property (n) : tài sản; bất động sản | proprietary (adj) : thuộc quyền sở hữu | proper (adj) : thích hợp | properly (adv) : một cách đúng đắn"
   Use " | " as separator between forms.
4. "synonyms": if there is a "Từ đồng nghĩa" / synonyms section, put only the ENGLISH words (comma-separated) here, e.g. "possession, characteristic". Do NOT create separate entries for synonyms.
5. "pronunciation": leave as "" (user fills later)
6. "sentence": leave as ""

Input text:
${text}

Return ONLY a valid JSON array (no markdown, no explanation):
[{"newWords":["word1 (n)","word2 (adj)"],"meaning":"word1 (n) : nghĩa1 | word2 (adj) : nghĩa2","synonyms":"syn1, syn2","pronunciation":"","sentence":""}]`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    let raw = completion.choices[0].message.content.trim();
    // Strip markdown code fences if present
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('AI did not return an array');

    // Save each entry to MongoDB
    const saved = [];
    for (const item of parsed) {
      const entry = {
        id:            uuidv4(),
        sentence:      batchSentence      || item.sentence || '',
        sentenceImage: null,
        newWords:      Array.isArray(item.newWords) ? item.newWords : [item.newWords].filter(Boolean),
        pronunciation: item.pronunciation || '',
        meaning:       item.meaning       || '',
        synonyms:      item.synonyms      || '',
        group:         group              || '',
        dateAdded:     new Date().toLocaleDateString('vi-VN'),
      };
      const doc = await Vocab.create(entry);
      saved.push(toPlain(doc));
    }

    res.json({ entries: saved, count: saved.length });
  } catch (err) {
    console.error('parse-vocab error:', err);
    res.status(500).json({ error: err.message });
  }
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
