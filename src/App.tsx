import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, type NavLinkRenderProps } from 'react-router-dom';
import './index.css';
import VocabManager from './components/VocabManager';
import QuizMode from './components/QuizMode';
import ChatMode from './components/ChatMode';
import Toast, { ToastItem } from './components/Toast';

export interface VocabEntry {
  id: string;
  sentence: string;
  sentenceImage: string | null;
  newWords: string[];
  pronunciation: string;
  meaning: string;
  synonyms: string;
  group: string;       // Tab/group name, e.g. "T9/2026" or "" for ungrouped
  dateAdded: string;
}

const navClass = ({ isActive }: NavLinkRenderProps) => `nav-tab${isActive ? ' active' : ''}`;

const App: React.FC = () => {
  const [vocabList, setVocabList] = useState<VocabEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
  }, []);

  const fetchVocab = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/vocab');
      if (!res.ok) throw new Error('Failed to fetch');
      const data: VocabEntry[] = await res.json();
      setVocabList(data);
    } catch {
      addToast('Could not load vocabulary. Is the server running?', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchVocab(); }, [fetchVocab]);

  return (
    <BrowserRouter>
      <div className="app-wrapper">
        <nav className="navbar">
          <div className="navbar-brand">
            <div className="logo-icon">📚</div>
            <span>VocabMaster</span>
          </div>

          <div className="navbar-tabs">
            <NavLink id="tab-vocab" to="/vocab" className={navClass}>
              📝 Vocab
              {vocabList.length > 0 && <span className="vocab-count-badge">{vocabList.length}</span>}
            </NavLink>
            <NavLink id="tab-quiz" to="/quiz" className={navClass}>
              🎯 Quiz
            </NavLink>
            <NavLink id="tab-chat" to="/chat" className={navClass}>
              💬 Chat
            </NavLink>
          </div>

          <div style={{ width: 140 }} />
        </nav>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<Navigate to="/vocab" replace />} />
            <Route
              path="/vocab"
              element={
                <VocabManager
                  vocabList={vocabList}
                  loading={loading}
                  onRefresh={fetchVocab}
                  addToast={addToast}
                />
              }
            />
            <Route
              path="/quiz"
              element={<QuizMode vocabList={vocabList} addToast={addToast} />}
            />
            <Route
              path="/chat"
              element={<ChatMode addToast={addToast} />}
            />
          </Routes>
        </main>

        <Toast toasts={toasts} />
      </div>
    </BrowserRouter>
  );
};

export default App;
