import React, { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  id: string;
  topic: string;
  topicLabel: string;
  messages: Message[];
  savedAt: string;
  messageCount: number;
}

interface Props {
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const TOPICS = [
  { id: 'interview', label: '💼 Job Interview', prompt: 'Let\'s practice a job interview conversation. Act as the interviewer and ask me questions.' },
  { id: 'daily',     label: '☀️ Daily Life',    prompt: 'Let\'s have a casual conversation about daily life topics.' },
  { id: 'travel',    label: '✈️ Travel',         prompt: 'Let\'s talk about travel experiences and plans.' },
  { id: 'work',      label: '🏢 Workplace',      prompt: 'Let\'s discuss workplace situations and professional communication.' },
  { id: 'freeform',  label: '💬 Free Chat',      prompt: 'Let\'s have a free conversation. I\'ll talk about whatever I want.' },
];

const SYSTEM_PROMPT = `You are an English conversation coach helping a Vietnamese learner improve their English.

Your job:
1. Engage in natural conversation on the chosen topic
2. After your response, if the user made any grammar or vocabulary mistakes, add a corrections section formatted EXACTLY like this:

---
📝 **Corrections:**
❌ *[wrong phrase]* → ✅ **[correct phrase]** — [brief explanation]
❌ *[wrong phrase]* → ✅ **[correct phrase]** — [brief explanation]
---

3. If no mistakes were made, add: "✨ Great job! Your English sounds natural."
4. Keep responses friendly, encouraging and concise
5. Suggest more natural or advanced vocabulary when appropriate`;

const ChatMode: React.FC<Props> = ({ addToast }) => {
  const [messages, setMessages]         = useState<Message[]>([]);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [activeTopic, setActiveTopic]   = useState<string | null>(null);

  // History sidebar
  const [history, setHistory]           = useState<ChatSession[]>([]);
  const [historyOpen, setHistoryOpen]   = useState(false);
  const [viewingSession, setViewingSession] = useState<ChatSession | null>(null);
  const [saving, setSaving]             = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Load history when sidebar opens
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch('/api/chat-history');
      if (res.ok) setHistory(await res.json());
    } catch { /* ignore */ } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (historyOpen) loadHistory();
  }, [historyOpen, loadHistory]);

  // ─── Topic selection ─────────────────────────────────────────────────────
  const selectTopic = async (topic: typeof TOPICS[0]) => {
    setViewingSession(null);
    setActiveTopic(topic.id);
    setMessages([]);
    setSending(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: topic.prompt }],
          systemPrompt: SYSTEM_PROMPT,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setMessages([
        { role: 'user', content: topic.prompt },
        { role: 'assistant', content: data.reply },
      ]);
    } catch {
      addToast('Failed to start conversation. Check your API key.', 'error');
    } finally {
      setSending(false);
    }
  };

  // ─── Send message ─────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!activeTopic) { addToast('Please select a topic first!', 'info'); return; }

    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setSending(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, systemPrompt: SYSTEM_PROMPT }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      addToast('Failed to send message.', 'error');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  };

  // ─── Save current session ─────────────────────────────────────────────────
  const saveSession = async () => {
    if (messages.length === 0) { addToast('No messages to save.', 'info'); return; }
    setSaving(true);
    try {
      const topic = TOPICS.find(t => t.id === activeTopic);
      const res = await fetch('/api/chat-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: activeTopic || 'freeform',
          topicLabel: topic?.label || '💬 Free Chat',
          messages,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      addToast('Conversation saved! ✅', 'success');
      if (historyOpen) loadHistory();
    } catch {
      addToast('Failed to save conversation.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Delete one session ───────────────────────────────────────────────────
  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/chat-history/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setHistory(prev => prev.filter(s => s.id !== id));
      if (viewingSession?.id === id) setViewingSession(null);
      addToast('Deleted.', 'info');
    } catch {
      addToast('Failed to delete.', 'error');
    }
  };

  // ─── New chat ─────────────────────────────────────────────────────────────
  const newChat = () => {
    setMessages([]);
    setActiveTopic(null);
    setViewingSession(null);
  };

  // ─── Keyboard / resize ───────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };
  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  // ─── Format date ─────────────────────────────────────────────────────────
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  };

  // ─── Render message ───────────────────────────────────────────────────────
  const renderMessage = (msg: Message) => {
    if (msg.role === 'user') return <p>{msg.content}</p>;
    const parts = msg.content.split('---');
    return (
      <>
        {parts.map((part, i) => {
          const trimmed = part.trim();
          if (trimmed.startsWith('📝') || trimmed.startsWith('✨')) {
            const lines = trimmed.split('\n');
            return (
              <div key={i} className="corrections">
                {lines.map((line, j) => {
                  if (line.startsWith('❌')) {
                    const match = line.match(/❌\s*\*?(.*?)\*?\s*→\s*✅\s*\*{0,2}(.*?)\*{0,2}\s*—\s*(.*)/);
                    if (match) {
                      return (
                        <div key={j} className="correction-item">
                          <span className="correction-wrong">❌ {match[1].trim()}</span>
                          {' → '}
                          <span className="correction-right">✅ {match[2].trim()}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> — {match[3].trim()}</span>
                        </div>
                      );
                    }
                  }
                  return <div key={j}>{line}</div>;
                })}
              </div>
            );
          }
          return <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{trimmed}</p>;
        })}
      </>
    );
  };

  // Which messages to display (active or viewed session)
  const displayMessages = viewingSession ? viewingSession.messages : messages;
  const isViewing       = !!viewingSession;

  return (
    <>
      <div className="page-header">
        <h2>💬 English Conversation</h2>
        <p>Practice speaking with AI — get corrections and feedback</p>
      </div>

      <div className="chat-layout">
        {/* ── History Sidebar ─────────────────────────────────────── */}
        <aside className={`chat-history-sidebar ${historyOpen ? 'open' : ''}`}>
          <div className="chat-history-header">
            <span>📋 History</span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setHistoryOpen(false)}
              title="Close sidebar"
            >✕</button>
          </div>

          {loadingHistory && (
            <div className="chat-history-empty">Loading…</div>
          )}

          {!loadingHistory && history.length === 0 && (
            <div className="chat-history-empty">
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗂️</div>
              <p>No saved conversations yet.</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Click 💾 Save to keep a session.
              </p>
            </div>
          )}

          <div className="chat-history-list">
            {history.map(session => (
              <div
                key={session.id}
                className={`chat-history-item ${viewingSession?.id === session.id ? 'active' : ''}`}
                onClick={() => setViewingSession(viewingSession?.id === session.id ? null : session)}
              >
                <div className="chat-history-item-top">
                  <span className="chat-history-topic">{session.topicLabel}</span>
                  <button
                    className="chat-history-delete"
                    onClick={(e) => deleteSession(session.id, e)}
                    title="Delete"
                  >🗑️</button>
                </div>
                <div className="chat-history-meta">
                  <span>💬 {session.messageCount} messages</span>
                  <span>{formatDate(session.savedAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Main Chat Panel ──────────────────────────────────────── */}
        <div className={`glass-card chat-wrapper ${historyOpen ? 'sidebar-open' : ''}`}>
          {/* Header */}
          <div className="chat-header">
            <div className="chat-header-left">
              <div className="ai-avatar">🤖</div>
              <div className="chat-header-info">
                <h3>{isViewing ? viewingSession!.topicLabel : 'English Coach'}</h3>
                <p>
                  {isViewing
                    ? <span style={{ color: 'var(--yellow)' }}>👁️ Viewing saved session</span>
                    : <><span className="status-dot" /> Online &amp; Ready</>
                  }
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Save button */}
              {!isViewing && messages.length > 0 && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={saveSession}
                  disabled={saving}
                  title="Save this conversation"
                >
                  {saving ? '…' : '💾 Save'}
                </button>
              )}
              {/* Back to live chat */}
              {isViewing && (
                <button className="btn btn-ghost btn-sm" onClick={() => setViewingSession(null)}>
                  ↩️ Back
                </button>
              )}
              {/* New Chat */}
              {!isViewing && messages.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={newChat}>
                  🔄 New Chat
                </button>
              )}
              {/* History toggle */}
              <button
                className={`btn btn-ghost btn-sm ${historyOpen ? 'active' : ''}`}
                onClick={() => setHistoryOpen(o => !o)}
                title="Chat history"
              >
                📋 History
              </button>
            </div>
          </div>

          {/* Topic Chips — hidden when viewing */}
          {!isViewing && (
            <div className="chat-topic-chips">
              {TOPICS.map(t => (
                <button
                  key={t.id}
                  id={`topic-${t.id}`}
                  className={`topic-chip ${activeTopic === t.id ? 'active' : ''}`}
                  onClick={() => selectTopic(t)}
                  disabled={sending}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="chat-messages">
            {displayMessages.length === 0 && !sending && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>👆</div>
                <p style={{ fontSize: 14 }}>Choose a topic above to start practicing English!</p>
              </div>
            )}

            {displayMessages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className={`msg-avatar ${msg.role}`}>
                  {msg.role === 'assistant' ? '🤖' : '👤'}
                </div>
                <div className={`msg-bubble ${msg.role === 'assistant' ? 'ai' : 'user'}`}>
                  {renderMessage(msg)}
                </div>
              </div>
            ))}

            {sending && (
              <div className="chat-message">
                <div className="msg-avatar ai">🤖</div>
                <div className="msg-bubble ai">
                  <div className="typing-indicator">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input — disabled when viewing history */}
          {!isViewing && (
            <div className="chat-input-area">
              <textarea
                id="chat-input"
                ref={textareaRef}
                className="chat-textarea"
                placeholder={activeTopic ? 'Type your message… (Enter to send, Shift+Enter for newline)' : 'Select a topic above to start…'}
                value={input}
                onChange={autoResize}
                onKeyDown={handleKeyDown}
                disabled={!activeTopic || sending}
                rows={1}
              />
              <button
                id="btn-send-chat"
                className="send-btn"
                onClick={sendMessage}
                disabled={!input.trim() || sending || !activeTopic}
              >
                ➤
              </button>
            </div>
          )}

          {/* Read-only notice when viewing */}
          {isViewing && (
            <div className="chat-history-readonly-bar">
              👁️ Read-only — <button className="btn btn-ghost btn-sm" onClick={() => setViewingSession(null)}>↩️ Back to chat</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default ChatMode;
