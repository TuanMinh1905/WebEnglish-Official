import React, { useState, useRef, useMemo, useEffect } from 'react';
import { VocabEntry } from '../App';

interface QuizQuestion {
  type: string;
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

interface TabInfo {
  id: string;
  name: string;
  color: string;
}

interface Props {
  vocabList: VocabEntry[];
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const LABELS = ['A', 'B', 'C', 'D'];
const PRESET_COUNTS = [5, 10, 15, 20];

const QuizMode: React.FC<Props> = ({ vocabList, addToast }) => {
  const [questions, setQuestions]   = useState<QuizQuestion[]>([]);
  const [current, setCurrent]       = useState(0);
  const [selected, setSelected]     = useState<string | null>(null);
  const [score, setScore]           = useState(0);
  const [finished, setFinished]     = useState(false);
  const [generating, setGenerating] = useState(false);
  const [started, setStarted]       = useState(false);
  const [count, setCount]           = useState(5);
  const [customCount, setCustomCount] = useState('');
  const [answers, setAnswers]       = useState<{ q: QuizQuestion; chosen: string; correct: boolean }[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set(['__all__']));
  const [tabs, setTabs]             = useState<TabInfo[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);

  // Fetch tabs from server
  useEffect(() => {
    fetch('/api/tabs')
      .then(r => r.ok ? r.json() : [])
      .then(data => setTabs(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // ── Derived data ──
  // Accept any entry that has a meaning or a sentence — AI can quiz on those
  const allVocab = vocabList.filter(v => v.meaning || v.sentence);

  // Count vocab per group key
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allVocab.forEach(v => {
      const g = v.group?.trim() || '__ungrouped__';
      counts[g] = (counts[g] || 0) + 1;
    });
    return counts;
  }, [allVocab]);

  const ungroupedCount = groupCounts['__ungrouped__'] || 0;

  // Build selectable group options: named tabs from API + ungrouped if any
  const groupOptions = useMemo(() => {
    const opts: { key: string; label: string; count: number; color?: string }[] = [];
    tabs.forEach(t => {
      opts.push({ key: t.name, label: t.name, count: groupCounts[t.name] || 0, color: t.color });
    });
    if (ungroupedCount > 0) {
      opts.push({ key: '__ungrouped__', label: 'Chưa phân nhóm', count: ungroupedCount });
    }
    return opts;
  }, [tabs, groupCounts, ungroupedCount]);

  // Show group selector when there are named tabs from API
  const showGroupSelector = tabs.length > 0;

  // Filter vocab by selected groups
  const availableVocab = useMemo(() => {
    if (selectedGroups.has('__all__')) return allVocab;
    return allVocab.filter(v => {
      const g = v.group?.trim() || '__ungrouped__';
      return selectedGroups.has(g);
    });
  }, [allVocab, selectedGroups]);

  const effectiveCount = customCount ? parseInt(customCount) || count : count;
  const isAllSelected = selectedGroups.has('__all__');

  // ── Group toggle ──
  const toggleGroup = (gKey: string) => {
    setSelectedGroups(prev => {
      const next = new Set(prev);
      if (gKey === '__all__') return new Set(['__all__']);
      next.delete('__all__');
      if (next.has(gKey)) {
        next.delete(gKey);
        if (next.size === 0) return new Set(['__all__']);
      } else {
        next.add(gKey);
      }
      return next;
    });
  };

  // ── Label for selected groups ──
  const groupSelectionLabel = useMemo(() => {
    if (isAllSelected) return 'Tất cả';
    const names = Array.from(selectedGroups).map(g =>
      g === '__ungrouped__' ? 'Chưa phân nhóm' : g
    );
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }, [selectedGroups, isAllSelected]);

  // ── Quiz logic ──
  const generateQuiz = async () => {
    if (availableVocab.length < 2) {
      addToast('Cần ít nhất 2 từ trong nhóm đã chọn để tạo quiz.', 'error');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabList: availableVocab, count: effectiveCount }),
      });
      if (!res.ok) throw new Error('Failed');
      const data: QuizQuestion[] = await res.json();
      setQuestions(data);
      setCurrent(0);
      setSelected(null);
      setScore(0);
      setFinished(false);
      setAnswers([]);
      setStarted(true);
    } catch {
      addToast('Không thể tạo quiz. Kiểm tra OpenAI API key.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleSelect = (option: string) => {
    if (selected !== null) return;
    setSelected(option);
    const isCorrect = option === questions[current].answer;
    if (isCorrect) setScore(s => s + 1);
    setAnswers(a => [...a, { q: questions[current], chosen: option, correct: isCorrect }]);
  };

  const handleNext = () => {
    if (current + 1 >= questions.length) {
      setFinished(true);
    } else {
      setCurrent(c => c + 1);
      setSelected(null);
      setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  };

  const resetQuiz = () => {
    setStarted(false);
    setFinished(false);
    setQuestions([]);
    setSelected(null);
    setScore(0);
    setAnswers([]);
  };

  const getResultEmoji = () => {
    const pct = score / questions.length;
    if (pct === 1) return '🏆';
    if (pct >= 0.8) return '🎉';
    if (pct >= 0.6) return '👍';
    return '📚';
  };

  const getResultTitle = () => {
    const pct = score / questions.length;
    if (pct === 1) return 'Perfect Score!';
    if (pct >= 0.8) return 'Excellent!';
    if (pct >= 0.6) return 'Good Job!';
    return 'Keep Practicing!';
  };

  const getTypeLabel = (type: string) => {
    if (type === 'word_to_meaning') return '📖 Word → Meaning';
    if (type === 'meaning_to_word') return '🔡 Meaning → Word';
    return '✏️ Fill in the Blank';
  };

  // ── Not started ──
  if (!started) {
    return (
      <>
        <div className="page-header">
          <h2>🎯 Quiz Mode</h2>
          <p>Ôn luyện từ vựng, cụm từ và câu bằng trắc nghiệm AI</p>
        </div>

        <div className="glass-card quiz-setup-card">
          <div className="quiz-setup-icon">🎯</div>
          <h3 className="quiz-setup-title">Sẵn sàng ôn luyện?</h3>
          <p className="quiz-setup-desc">
            Chọn tab muốn ôn, đặt số câu hỏi, rồi bắt đầu!<br />
            AI sẽ tạo câu trắc nghiệm và hiện đáp án ngay khi bạn chọn.
          </p>

          {/* ── Tab / Group selector ── */}
          {showGroupSelector && (
            <div className="quiz-group-section">
              <label className="quiz-count-label">
                📂 Chọn tab để ôn
                <span className="quiz-group-selection-label"> — {groupSelectionLabel}</span>
              </label>

              <div className="quiz-group-grid">
                {/* All button */}
                <button
                  className={`quiz-group-btn ${isAllSelected ? 'active' : ''}`}
                  onClick={() => toggleGroup('__all__')}
                >
                  <span className="quiz-group-check">{isAllSelected ? '✓' : ''}</span>
                  <span className="quiz-group-name">Tất cả</span>
                  <span className="quiz-group-count">{allVocab.length}</span>
                </button>

                {/* Per-group buttons */}
                {groupOptions.map(opt => {
                  const isActive = !isAllSelected && selectedGroups.has(opt.key);
                  return (
                    <button
                      key={opt.key}
                      className={`quiz-group-btn ${isActive ? 'active' : ''}`}
                      onClick={() => toggleGroup(opt.key)}
                      style={opt.color && isActive
                        ? { borderColor: opt.color, color: opt.color, background: `${opt.color}22` }
                        : opt.color
                          ? { '--tab-color': opt.color } as React.CSSProperties
                          : undefined}
                    >
                      <span className="quiz-group-check" style={opt.color && isActive ? { color: opt.color } : {}}>
                        {isActive ? '✓' : ''}
                      </span>
                      <span className="quiz-group-name">{opt.label}</span>
                      <span className="quiz-group-count">{opt.count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Summary */}
              <div className="quiz-group-summary">
                {isAllSelected
                  ? `📚 Đang dùng toàn bộ ${allVocab.length} từ`
                  : availableVocab.length >= 2
                    ? `✅ Đã chọn ${availableVocab.length} từ từ ${selectedGroups.size} tab`
                    : `⚠️ Chỉ có ${availableVocab.length} từ — cần ít nhất 2`}
              </div>
            </div>
          )}

          {/* ── Count selector ── */}
          <div className="quiz-count-section">
            <label className="quiz-count-label">🎯 Số câu hỏi</label>

            <div className="quiz-preset-row">
              {PRESET_COUNTS.map(n => (
                <button
                  key={n}
                  className={`quiz-preset-btn ${!customCount && count === n ? 'active' : ''}`}
                  onClick={() => { setCount(n); setCustomCount(''); }}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="quiz-custom-input-wrap">
              <input
                id="quiz-custom-count"
                type="number"
                className="form-input quiz-custom-input"
                placeholder="Hoặc nhập số bất kỳ (1–50)..."
                min={1}
                max={50}
                value={customCount}
                onChange={e => setCustomCount(e.target.value)}
              />
            </div>
          </div>

          <div className="quiz-info-row">
            <span className="quiz-info-chip">📚 {availableVocab.length} từ có sẵn</span>
            <span className="quiz-info-chip">🎯 {effectiveCount} câu hỏi</span>
            <span className="quiz-info-chip">⏱ ~{Math.round(effectiveCount * 0.5)} phút</span>
          </div>

          {availableVocab.length < 2 ? (
            <p className="quiz-warn">⚠️ Cần ít nhất 2 từ trong nhóm đã chọn để tạo quiz.</p>
          ) : (
            <button
              id="btn-start-quiz"
              className="btn btn-primary quiz-start-btn"
              onClick={generateQuiz}
              disabled={generating}
            >
              {generating
                ? <><span className="quiz-spinner" />Đang tạo câu hỏi...</>
                : '🚀 Bắt đầu Quiz'}
            </button>
          )}
        </div>
      </>
    );
  }

  // ── Finished ──
  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    const deg = (pct / 100) * 360;
    return (
      <>
        <div className="page-header">
          <h2>🏆 Kết quả Quiz</h2>
        </div>

        <div className="glass-card quiz-result">
          <div className="result-emoji">{getResultEmoji()}</div>
          <h2 className="result-title">{getResultTitle()}</h2>
          <p className="result-subtitle">
            Bạn trả lời đúng <strong>{score}</strong> / <strong>{questions.length}</strong> câu
          </p>

          <div className="result-score-ring" style={{ '--pct': `${deg}deg` } as React.CSSProperties}>
            <div className="result-score-inner">{pct}%</div>
          </div>

          <div className="result-chips">
            <span className="result-chip correct-chip">✅ Đúng: {score}</span>
            <span className="result-chip wrong-chip">❌ Sai: {questions.length - score}</span>
          </div>

          {answers.length > 0 && (
            <div className="result-review">
              <h4 className="result-review-title">📋 Xem lại toàn bộ câu hỏi</h4>
              {answers.map(({ q, chosen, correct }, i) => (
                <div key={i} className={`result-review-item ${correct ? 'review-correct' : 'review-wrong'}`}>
                  <div className="review-item-header">
                    <span className="review-num">Q{i + 1}</span>
                    <span className="review-type">{getTypeLabel(q.type)}</span>
                    <span className={`review-badge ${correct ? 'badge-correct' : 'badge-wrong'}`}>
                      {correct ? '✅ Đúng' : '❌ Sai'}
                    </span>
                  </div>
                  <div className="review-question">{q.question}</div>
                  {!correct && (
                    <div className="review-chosen">
                      Bạn chọn: <span className="chosen-wrong">{chosen}</span>
                    </div>
                  )}
                  <div className="review-answer">
                    ✓ Đáp án: <span className="answer-text">{q.answer}</span>
                  </div>
                  <div className="review-explanation">{q.explanation}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24 }}>
            <button className="btn btn-primary" onClick={generateQuiz} disabled={generating}>
              {generating ? '⏳ Đang tạo...' : '🔄 Làm lại'}
            </button>
            <button className="btn btn-ghost" onClick={resetQuiz}>← Về trang chính</button>
          </div>
        </div>
      </>
    );
  }

  // ── Active quiz ──
  const q = questions[current];
  const progress = (current / questions.length) * 100;
  const isCorrect = selected === q.answer;

  return (
    <>
      <div className="page-header">
        <h2>🎯 Quiz Mode</h2>
        <p style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={resetQuiz}>← Thoát</button>
        </p>
      </div>

      <div className="quiz-progress">
        <div className="quiz-progress-bar-wrap">
          <div className="quiz-progress-bar" style={{ width: `${progress}%` }} />
        </div>
        <span className="quiz-progress-text">{current + 1} / {questions.length}</span>
        <span className="quiz-score-display">
          Điểm: <span className="score-num">{score}</span>
        </span>
      </div>

      <div className="glass-card question-card" ref={cardRef}>
        <div className="question-type-badge">{getTypeLabel(q.type)}</div>

        <div className="question-text">
          {q.question.split('___').map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 && <span className="blank">___</span>}
            </span>
          ))}
        </div>

        <div className="options-grid">
          {q.options.map((opt, i) => {
            let cls = '';
            if (selected !== null) {
              if (opt === q.answer) cls = 'correct';
              else if (opt === selected) cls = 'wrong';
              else cls = 'dimmed';
            }
            return (
              <button
                key={i}
                id={`option-${LABELS[i]}`}
                className={`option-btn ${cls}`}
                onClick={() => handleSelect(opt)}
                disabled={selected !== null}
              >
                <span className="option-label">{LABELS[i]}</span>
                <span className="option-text">{opt}</span>
                {selected !== null && opt === q.answer && <span className="option-check">✓</span>}
                {selected !== null && opt === selected && opt !== q.answer && <span className="option-cross">✗</span>}
              </button>
            );
          })}
        </div>

        {selected && (
          <div className={`explanation-box ${isCorrect ? 'expl-correct' : 'expl-wrong'}`}>
            <div className="expl-header">
              {isCorrect ? '✅ Chính xác!' : `❌ Chưa đúng — Đáp án: "${q.answer}"`}
            </div>
            <div className="expl-body">{q.explanation}</div>
          </div>
        )}

        <div className="quiz-nav">
          <div />
          {selected && (
            <button id="btn-next-question" className="btn btn-primary" onClick={handleNext}>
              {current + 1 >= questions.length ? 'Xem kết quả 🏆' : 'Câu tiếp theo →'}
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default QuizMode;
