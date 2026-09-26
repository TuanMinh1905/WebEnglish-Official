import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const TOPICS = [
  { id: 'interview', label: '💼 Job Interview', prompt: 'Let\'s practice a job interview conversation. Act as the interviewer and ask me questions.' },
  { id: 'daily', label: '☀️ Daily Life', prompt: 'Let\'s have a casual conversation about daily life topics.' },
  { id: 'travel', label: '✈️ Travel', prompt: 'Let\'s talk about travel experiences and plans.' },
  { id: 'work', label: '🏢 Workplace', prompt: 'Let\'s discuss workplace situations and professional communication.' },
  { id: 'freeform', label: '💬 Free Chat', prompt: 'Let\'s have a free conversation. I\'ll talk about whatever I want.' },
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const selectTopic = async (topic: typeof TOPICS[0]) => {
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

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!activeTopic) { addToast('Please select a topic first!', 'info'); return; }

    const newMessages: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setSending(true);

    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          systemPrompt: SYSTEM_PROMPT,
        }),
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const autoResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const renderMessage = (msg: Message) => {
    const content = msg.content;

    if (msg.role === 'user') {
      return <p>{content}</p>;
    }

    // Parse corrections section
    const parts = content.split('---');
    return (
      <>
        {parts.map((part, i) => {
          const trimmed = part.trim();
          if (trimmed.startsWith('📝') || trimmed.startsWith('✨')) {
            // Corrections block
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
          // Regular text
          return <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{trimmed}</p>;
        })}
      </>
    );
  };

  return (
    <>
      <div className="page-header">
        <h2>💬 English Conversation</h2>
        <p>Practice speaking with AI — get corrections and feedback</p>
      </div>

      <div className="glass-card chat-wrapper">
        {/* Header */}
        <div className="chat-header">
          <div className="chat-header-left">
            <div className="ai-avatar">🤖</div>
            <div className="chat-header-info">
              <h3>English Coach</h3>
              <p><span className="status-dot" /> Online & Ready</p>
            </div>
          </div>
          {messages.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setMessages([]); setActiveTopic(null); }}>
              🔄 New Chat
            </button>
          )}
        </div>

        {/* Topic Chips */}
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

        {/* Messages */}
        <div className="chat-messages">
          {messages.length === 0 && !sending && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>👆</div>
              <p style={{ fontSize: 14 }}>Choose a topic above to start practicing English!</p>
            </div>
          )}

          {messages.map((msg, i) => (
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

        {/* Input */}
        <div className="chat-input-area">
          <textarea
            id="chat-input"
            ref={textareaRef}
            className="chat-textarea"
            placeholder={activeTopic ? "Type your message... (Enter to send, Shift+Enter for newline)" : "Select a topic above to start..."}
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
      </div>
    </>
  );
};

export default ChatMode;
