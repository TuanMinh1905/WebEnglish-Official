import React from 'react';

export interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

const ICONS = { success: '✓', error: '✕', info: 'ℹ' };

const Toast: React.FC<{ toasts: ToastItem[] }> = ({ toasts }) => (
  <div className="toast-container">
    {toasts.map(t => (
      <div key={t.id} className={`toast ${t.type}`}>
        <span>{ICONS[t.type]}</span>
        {t.message}
      </div>
    ))}
  </div>
);

export default Toast;
