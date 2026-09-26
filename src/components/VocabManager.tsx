import React, { useState, useRef, useCallback, useEffect } from 'react';
import { VocabEntry } from '../App';

// ── Word Tag Input (top-level so React never remounts it on parent re-render) ──
interface WordTagInputProps {
  words: string[];
  input: string;
  onAddWord: () => void;
  onRemoveWord: (i: number) => void;
  onInputChange: (v: string) => void;
  placeholder: string;
}

const WordTagInput: React.FC<WordTagInputProps> = ({
  words, input, onAddWord, onRemoveWord, onInputChange, placeholder,
}) => (
  <div className="word-tag-container">
    {words.map((w, i) => (
      <span key={i} className="word-tag">
        {w}
        <button type="button" className="word-tag-remove" onClick={() => onRemoveWord(i)}>×</button>
      </span>
    ))}
    <input
      className="word-tag-input"
      value={input}
      onChange={e => onInputChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); onAddWord(); }
        if (e.key === 'Backspace' && !input && words.length) onRemoveWord(words.length - 1);
      }}
      placeholder={words.length === 0 ? placeholder : 'Add more...'}
    />
  </div>
);


interface Props {
  vocabList: VocabEntry[];
  loading: boolean;
  onRefresh: () => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

interface VocabTab {
  id: string;
  name: string;
  color: string;
}

const EMPTY_FORM = {
  sentence: '',
  sentenceImage: null as string | null,
  newWords: [] as string[],
  wordInput: '',
  pronunciation: '',
  meaning: '',
  synonyms: '',
  group: '',
};

const VocabManager: React.FC<Props> = ({ vocabList, loading, onRefresh, addToast }) => {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Omit<VocabEntry, 'id' | 'dateAdded'> & { wordInput: string }>({
    sentence: '', sentenceImage: null, newWords: [], wordInput: '',
    pronunciation: '', meaning: '', synonyms: '', group: '',
  });

  // ── Tabs state ────────────────────────────────────────────────
  const [tabs, setTabs] = useState<VocabTab[]>([]);
  const [activeVocabTab, setActiveVocabTab] = useState<string>('__all__');
  const [newTabName, setNewTabName] = useState('');
  const [showAddTab, setShowAddTab] = useState(false);
  const [renamingTab, setRenamingTab] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const fetchTabs = useCallback(async () => {
    try {
      const res = await fetch('/api/tabs');
      const data: VocabTab[] = await res.json();
      setTabs(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchTabs(); }, [fetchTabs]);

  const handleCreateTab = async () => {
    const name = newTabName.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) { const e = await res.json(); addToast(e.error || 'Error', 'error'); return; }
      const tab = await res.json();
      setTabs(prev => [...prev, tab]);
      setActiveVocabTab(tab.name);
      setNewTabName('');
      setShowAddTab(false);
      addToast(`Tab “${tab.name}” created!`, 'success');
    } catch { addToast('Failed to create tab', 'error'); }
  };

  const handleRenameTab = async (tab: VocabTab) => {
    const name = renameValue.trim();
    if (!name || name === tab.name) { setRenamingTab(null); return; }
    try {
      const res = await fetch(`/api/tabs/${tab.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) { addToast('Rename failed', 'error'); return; }
      setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, name } : t));
      if (activeVocabTab === tab.name) setActiveVocabTab(name);
      setRenamingTab(null);
      onRefresh();
      addToast('Tab renamed!', 'success');
    } catch { addToast('Failed to rename', 'error'); }
  };

  const handleDeleteTab = async (tab: VocabTab) => {
    if (!window.confirm(`Delete tab “${tab.name}”? Entries will become ungrouped.`)) return;
    try {
      await fetch(`/api/tabs/${tab.id}`, { method: 'DELETE' });
      setTabs(prev => prev.filter(t => t.id !== tab.id));
      if (activeVocabTab === tab.name) setActiveVocabTab('__all__');
      onRefresh();
      addToast('Tab deleted', 'success');
    } catch { addToast('Failed to delete tab', 'error'); }
  };

  // ── Word tag helpers ──────────────────────────────────────────────
  const addWord = (words: string[], input: string, setWords: (w: string[]) => void, setInput: (s: string) => void) => {
    const trimmed = input.trim();
    if (trimmed && !words.includes(trimmed)) {
      setWords([...words, trimmed]);
    }
    setInput('');
  };

  const removeWord = (words: string[], idx: number, setWords: (w: string[]) => void) => {
    setWords(words.filter((_, i) => i !== idx));
  };

  // ── Image upload — returns URL for inline insertion ───────────────
  const handleImageUpload = async (file: File): Promise<string> => {
    const fd = new FormData();
    fd.append('image', file);
    setUploading(true);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();
      addToast('Image pasted! ✨', 'success');
      return url as string;
    } catch {
      addToast('Image upload failed', 'error');
      return '';
    } finally {
      setUploading(false);
    }
  };

  // ── Add vocab ─────────────────────────────────────────────────────
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const allWords = form.wordInput.trim()
      ? [...form.newWords, form.wordInput.trim()]
      : form.newWords;
    if (allWords.length === 0 && !form.meaning) {
      addToast('Please enter at least a word or meaning', 'error'); return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/vocab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentence: form.sentence,
          sentenceImage: null,
          newWords: allWords,
          pronunciation: form.pronunciation,
          meaning: form.meaning,
          synonyms: form.synonyms,
          group: form.group,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      addToast('Word added! 🎉', 'success');
      setForm(EMPTY_FORM);
      onRefresh();
    } catch {
      addToast('Failed to add. Is the server running?', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this entry?')) return;
    try {
      await fetch(`/api/vocab/${id}`, { method: 'DELETE' });
      addToast('Deleted', 'success');
      onRefresh();
    } catch {
      addToast('Failed to delete', 'error');
    }
  };

  // ── Edit ──────────────────────────────────────────────────────────
  const startEdit = (v: VocabEntry) => {
    setEditingId(v.id);
    setEditForm({
      sentence: v.sentence, sentenceImage: v.sentenceImage,
      newWords: v.newWords || [], wordInput: '',
      pronunciation: v.pronunciation, meaning: v.meaning,
      synonyms: v.synonyms, group: v.group || '',
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const allWords = editForm.wordInput.trim()
      ? [...editForm.newWords, editForm.wordInput.trim()]
      : editForm.newWords;
    try {
      await fetch(`/api/vocab/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, newWords: allWords, wordInput: undefined }),
      });
      addToast('Updated! ✨', 'success');
      setEditingId(null);
      onRefresh();
    } catch {
      addToast('Failed to update', 'error');
    }
  };

  // ── Filter (by active tab + search) ─────────────────────────────────────
  const filtered = vocabList.filter(v => {
    // Tab filter
    if (activeVocabTab === '__ungrouped__') {
      if (v.group && v.group !== '') return false;
    } else if (activeVocabTab !== '__all__') {
      if ((v.group || '') !== activeVocabTab) return false;
    }
    // Search filter
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      (v.newWords || []).some(w => w.toLowerCase().includes(q)) ||
      v.meaning.toLowerCase().includes(q) ||
      v.sentence.toLowerCase().includes(q) ||
      v.synonyms.toLowerCase().includes(q)
    );
  });

  const ungroupedCount = vocabList.filter(v => !v.group || v.group === '').length;


  return (
    <>
      <div className="page-header">
        <h2>📝 Vocabulary Manager</h2>
        <p>Add words, phrases, sentences — stored locally & Git-ready</p>
      </div>

      {/* ── Add Form ── */}
      <div className="glass-card vocab-add-form" style={{ marginBottom: 20 }}>
        <div
          className="form-title"
          style={{ cursor: 'pointer', justifyContent: 'space-between', display: 'flex', alignItems: 'center' }}
          onClick={() => setShowForm(f => !f)}
        >
          <span>✨ Add New Entry</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{showForm ? '▲ Hide' : '▼ Show'}</span>
        </div>

        {showForm && (
          <form onSubmit={handleAdd}>
            {/* Sentence — Rich Text Editor */}
            <RichSentenceEditor
              value={form.sentence}
              onChange={v => setForm(f => ({ ...f, sentence: v }))}
              uploadImage={handleImageUpload}
              uploading={uploading}
            />

            <div className="form-grid">
              {/* New Words */}
              <div className="input-group full-span">
                <label>NEW WORD(S) — Press Enter or comma to add, can add multiple (word family)</label>
                <WordTagInput
                  words={form.newWords}
                  input={form.wordInput}
                  onAddWord={() => addWord(form.newWords, form.wordInput, w => setForm(f => ({ ...f, newWords: w })), v => setForm(f => ({ ...f, wordInput: v })))}
                  onRemoveWord={i => removeWord(form.newWords, i, w => setForm(f => ({ ...f, newWords: w })))}
                  onInputChange={v => setForm(f => ({ ...f, wordInput: v }))}
                  placeholder="E.g. qualify, qualification, qualified..."
                />
              </div>

              {/* Pronunciation */}
              <div className="input-group">
                <label>PRONUNCIATION</label>
                <input id="input-pronunciation" className="form-input" placeholder="/ˈkwɒlɪfaɪ/" value={form.pronunciation} onChange={e => setForm(f => ({ ...f, pronunciation: e.target.value }))} />
              </div>

              {/* Synonyms */}
              <div className="input-group">
                <label>SYNONYMS (TỪ ĐỒNG NGHĨA)</label>
                <input id="input-synonyms" className="form-input" placeholder="E.g. eligible, certified" value={form.synonyms} onChange={e => setForm(f => ({ ...f, synonyms: e.target.value }))} />
              </div>

              {/* Meaning */}
              <div className="input-group full-span">
                <label>MEANING / NGHĨA</label>
                <textarea className="form-textarea" placeholder="E.g. (v) Đủ điều kiện; (n) vòng loại, sự đủ tiêu chuẩn" value={form.meaning} onChange={e => setForm(f => ({ ...f, meaning: e.target.value }))} rows={2} />
              </div>

              {/* Group / Tab selector */}
              <div className="input-group full-span">
                <label>THÊM VÀO TAB</label>
                <select
                  className="form-input"
                  value={form.group}
                  onChange={e => setForm(f => ({ ...f, group: e.target.value }))}
                >
                  <option value="">— Không phân nhóm —</option>
                  {tabs.map(t => (
                    <option key={t.id} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => { setForm(EMPTY_FORM); }}>Clear</button>
              <button id="btn-add-vocab" type="submit" className="btn btn-primary" disabled={saving || uploading}>
                {saving ? '⏳ Saving...' : '+ Add Entry'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── Vocab List ── */}
      <div className="glass-card">
        {/* Tab Bar */}
        <div className="vocab-tab-bar">
          <button
            className={`vtab ${activeVocabTab === '__all__' ? 'vtab-active' : ''}`}
            onClick={() => setActiveVocabTab('__all__')}
          >
            All <span className="vtab-count">{vocabList.length}</span>
          </button>

          {tabs.map(tab => (
            <div key={tab.id} className="vtab-wrap">
              {renamingTab === tab.id ? (
                <input
                  className="vtab-rename-input"
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => handleRenameTab(tab)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameTab(tab);
                    if (e.key === 'Escape') setRenamingTab(null);
                  }}
                />
              ) : (
                <button
                  className={`vtab ${activeVocabTab === tab.name ? 'vtab-active' : ''}`}
                  style={activeVocabTab === tab.name ? { borderColor: tab.color, color: tab.color } : {}}
                  onClick={() => setActiveVocabTab(tab.name)}
                  onDoubleClick={() => { setRenamingTab(tab.id); setRenameValue(tab.name); }}
                >
                  {tab.name}
                  <span className="vtab-count">{vocabList.filter(v => (v.group || '') === tab.name).length}</span>
                </button>
              )}
              <div className="vtab-actions">
                <button title="Rename" onClick={() => { setRenamingTab(tab.id); setRenameValue(tab.name); }}>✏️</button>
                <button title="Delete" onClick={() => handleDeleteTab(tab)}>🗑️</button>
              </div>
            </div>
          ))}

          {ungroupedCount > 0 && (
            <button
              className={`vtab ${activeVocabTab === '__ungrouped__' ? 'vtab-active' : ''}`}
              onClick={() => setActiveVocabTab('__ungrouped__')}
            >
              Chưa phân nhóm <span className="vtab-count">{ungroupedCount}</span>
            </button>
          )}

          {/* Add tab */}
          {showAddTab ? (
            <div className="vtab-add-wrap">
              <input
                className="vtab-rename-input"
                autoFocus
                placeholder="Tên tab mới..."
                value={newTabName}
                onChange={e => setNewTabName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateTab();
                  if (e.key === 'Escape') { setShowAddTab(false); setNewTabName(''); }
                }}
              />
              <button className="vtab vtab-confirm" onClick={handleCreateTab}>✓</button>
              <button className="vtab vtab-cancel" onClick={() => { setShowAddTab(false); setNewTabName(''); }}>✕</button>
            </div>
          ) : (
            <button className="vtab vtab-add" onClick={() => setShowAddTab(true)} title="Thêm tab mới">＋ Tab</button>
          )}
        </div>

        <div className="vocab-table-header" style={{ borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
          <h3>Your Vocabulary <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>({filtered.length} entries)</span></h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="search-input-wrap">
              <span className="search-icon">🔍</span>
              <input id="search-vocab" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={onRefresh}>↻ Refresh</button>
          </div>
        </div>

        <div className="vocab-list">
          {loading ? (
            [1, 2, 3].map(i => (
              <div key={i} className="skeleton-item">
                <div className="skeleton-line" style={{ width: '50%' }} />
                <div className="skeleton-line" style={{ width: '70%' }} />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">{search ? '🔍' : '📭'}</div>
              <p>{search ? `No results for "${search}"` : 'No vocabulary yet. Add your first entry above!'}</p>
            </div>
          ) : (
            filtered.map(v => (
              <div key={v.id} className={`vocab-card ${editingId === v.id ? 'editing' : ''}`}>
                {editingId === v.id ? (
                  /* ── Edit Mode ── */
                  <div className="edit-mode">
                    <div className="edit-section-label">SENTENCE</div>
                    <textarea className="form-textarea" value={editForm.sentence} onChange={e => setEditForm(f => ({ ...f, sentence: e.target.value }))} rows={2} placeholder="Sentence..." />

                    <div className="edit-section-label" style={{ marginTop: 10 }}>NEW WORD(S)</div>
                    <div className="word-tag-container">
                      {editForm.newWords.map((w, i) => (
                        <span key={i} className="word-tag">{w}
                          <button type="button" className="word-tag-remove" onClick={() => setEditForm(f => ({ ...f, newWords: f.newWords.filter((_, j) => j !== i) }))}>×</button>
                        </span>
                      ))}
                      <input className="word-tag-input" value={editForm.wordInput} placeholder="Add word..." onChange={e => setEditForm(f => ({ ...f, wordInput: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            if (editForm.wordInput.trim()) {
                              setEditForm(f => ({ ...f, newWords: [...f.newWords, f.wordInput.trim()], wordInput: '' }));
                            }
                          }
                        }} />
                    </div>

                    <div className="edit-grid-2col" style={{ marginTop: 10 }}>
                      <div>
                        <div className="edit-section-label">PRONUNCIATION</div>
                        <input className="form-input" value={editForm.pronunciation} onChange={e => setEditForm(f => ({ ...f, pronunciation: e.target.value }))} />
                      </div>
                      <div>
                        <div className="edit-section-label">SYNONYMS</div>
                        <input className="form-input" value={editForm.synonyms} onChange={e => setEditForm(f => ({ ...f, synonyms: e.target.value }))} />
                      </div>
                    </div>

                    <div className="edit-section-label" style={{ marginTop: 10 }}>MEANING</div>
                    <textarea className="form-textarea" value={editForm.meaning} onChange={e => setEditForm(f => ({ ...f, meaning: e.target.value }))} rows={2} />

                    <div className="edit-actions">
                      <button className="btn btn-primary btn-sm" onClick={saveEdit}>✓ Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  /* ── View Mode ── */
                  <div className="vocab-card-inner">
                    {/* Top: words + actions */}
                    <div className="vocab-card-header">
                      <div className="vocab-words-group">
                        {(v.newWords || []).map((w, i) => (
                          <span key={i} className="vocab-word-chip">{w}</span>
                        ))}
                        {v.pronunciation && <span className="vocab-pronunciation">/{v.pronunciation}/</span>}
                      </div>
                      <div className="vocab-actions">
                        <span className="vocab-date">{v.dateAdded}</span>
                        <button className="btn btn-ghost btn-icon btn-sm" onClick={() => startEdit(v)} title="Edit">✏️</button>
                        <button className="btn btn-danger btn-icon btn-sm" onClick={() => handleDelete(v.id)} title="Delete">🗑</button>
                      </div>
                    </div>

                    {/* Sentence / Image */}
                    {v.sentenceImage ? (
                      <div className="vocab-sentence-img-wrap">
                        <img src={v.sentenceImage} alt="Sentence" className="vocab-sentence-img" />
                      </div>
                    ) : v.sentence ? (
                      <div
                        className="vocab-sentence"
                        dangerouslySetInnerHTML={{ __html: v.sentence }}
                      />
                    ) : null}

                    {/* Meaning */}
                    {v.meaning && <div className="vocab-meaning">{v.meaning}</div>}

                    {/* Synonyms */}
                    {v.synonyms && (
                      <div className="vocab-synonyms">
                        <span className="synonyms-label">≈</span> {v.synonyms}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
};

// ── Rich Sentence Editor ─────────────────────────────────────────────
const FONT_SIZES = ['12px', '13px', '14px', '16px', '18px', '20px', '24px'];
const COLORS = [
  '#f0f0f5', '#8b5cf6', '#6366f1', '#10b981', '#f59e0b',
  '#ef4444', '#3b82f6', '#ec4899', '#f97316', '#14b8a6',
];

interface RichEditorProps {
  value: string;
  onChange: (html: string) => void;
  uploadImage: (file: File) => Promise<string>;
  uploading: boolean;
}

const RichSentenceEditor: React.FC<RichEditorProps> = ({ value, onChange, uploadImage, uploading }) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const [activeFmt, setActiveFmt] = useState({ bold: false, italic: false });
  const [fontSize, setFontSize] = useState('14px');
  const [color, setColor] = useState('#f0f0f5');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const savedRangeRef = useRef<Range | null>(null);

  // Sync editor content when value is reset externally (e.g. Clear)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    if (savedRangeRef.current) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedRangeRef.current);
      }
    }
  };

  const exec = (cmd: string, val?: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(cmd, false, val);
    updateActiveState();
    onChange(editorRef.current?.innerHTML || '');
  };

  const updateActiveState = () => {
    setActiveFmt({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
    });
  };

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(item => item.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      // Save cursor position before async upload
      const sel = window.getSelection();
      let savedRange: Range | null = null;
      if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
      const url = await uploadImage(file);
      if (!url) return;
      // Restore cursor and insert image
      if (savedRange && sel) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'pasted';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '200px';
      img.style.borderRadius = '6px';
      img.style.marginTop = '4px';
      img.style.display = 'block';
      const range = sel?.getRangeAt(0);
      if (range && editorRef.current) {
        range.deleteContents();
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      onChange(editorRef.current?.innerHTML || '');
      return;
    }
    // Plain text paste — strip HTML
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, [uploadImage, onChange]);

  const handleKeyUp = () => {
    updateActiveState();
    onChange(editorRef.current?.innerHTML || '');
  };

  const applyFontSize = (size: string) => {
    setFontSize(size);
    saveSelection();
    editorRef.current?.focus();
    restoreSelection();
    // Wrap selection in a span with font-size
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const span = document.createElement('span');
      span.style.fontSize = size;
      range.surroundContents(span);
      onChange(editorRef.current?.innerHTML || '');
    } else {
      // No selection: set default for next typed chars
      document.execCommand('fontSize', false, '7');
      // Override the font size on the created element
      const els = editorRef.current?.querySelectorAll('font[size="7"]');
      els?.forEach(el => {
        (el as HTMLElement).removeAttribute('size');
        (el as HTMLElement).style.fontSize = size;
      });
      onChange(editorRef.current?.innerHTML || '');
    }
  };

  const applyColor = (c: string) => {
    setColor(c);
    setShowColorPicker(false);
    exec('foreColor', c);
  };

  return (
    <div className="input-group rich-sentence-group" style={{ marginBottom: 14 }}>
      <label>SENTENCE / CONTEXT</label>

      {/* Toolbar */}
      <div className="rich-toolbar">
        <button
          type="button"
          className={`rich-btn ${activeFmt.bold ? 'active' : ''}`}
          onMouseDown={e => { e.preventDefault(); saveSelection(); exec('bold'); }}
          title="Bold (Ctrl+B)"
        ><b>B</b></button>

        <button
          type="button"
          className={`rich-btn ${activeFmt.italic ? 'active' : ''}`}
          onMouseDown={e => { e.preventDefault(); saveSelection(); exec('italic'); }}
          title="Italic (Ctrl+I)"
        ><i>I</i></button>

        <div className="rich-divider" />

        {/* Font size */}
        <select
          className="rich-select"
          value={fontSize}
          onMouseDown={saveSelection}
          onChange={e => applyFontSize(e.target.value)}
          title="Font size"
        >
          {FONT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <div className="rich-divider" />

        {/* Color picker */}
        <div className="rich-color-wrap" style={{ position: 'relative' }}>
          <button
            type="button"
            className="rich-btn rich-color-btn"
            onMouseDown={e => { e.preventDefault(); saveSelection(); setShowColorPicker(v => !v); }}
            title="Text color"
          >
            <span style={{
              display: 'inline-block', width: 13, height: 13,
              borderRadius: 3, background: color, border: '1px solid rgba(255,255,255,0.3)', verticalAlign: 'middle'
            }} />
            <span style={{ marginLeft: 3, fontSize: 9 }}>▼</span>
          </button>
          {showColorPicker && (
            <div className="rich-color-picker">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className="rich-color-swatch"
                  style={{ background: c, outline: c === color ? '2px solid white' : 'none' }}
                  onMouseDown={e => { e.preventDefault(); applyColor(c); }}
                  title={c}
                />
              ))}
            </div>
          )}
        </div>

        <div className="rich-divider" />

        <span className="rich-hint">
          {uploading ? '⏳ Uploading image...' : '💡 Ctrl+V để paste ảnh'}
        </span>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        className="form-textarea rich-editor-area"
        contentEditable
        suppressContentEditableWarning
        data-placeholder="Type your sentence, context, or notes here..."
        onPaste={handlePaste}
        onKeyUp={handleKeyUp}
        onKeyDown={e => {
          // Ctrl+B / Ctrl+I handled natively by browser in contentEditable,
          // we just sync state after
          if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i')) {
            setTimeout(updateActiveState, 10);
          }
        }}
        onSelect={updateActiveState}
        onMouseUp={updateActiveState}
        onBlur={saveSelection}
        style={{ minHeight: 72, cursor: 'text', whiteSpace: 'pre-wrap', outline: 'none' }}
      />
    </div>
  );
};

export default VocabManager;
