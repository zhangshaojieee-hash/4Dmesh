import React, { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let toastId = 0;

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const colors = {
    success: { bg: '#E8F5EE', border: '#7BC9A6', text: '#2C7A4B' },
    error: { bg: '#FFEBEE', border: '#EF9A9A', text: '#C62828' },
    info: { bg: '#E3F2FD', border: '#90CAF9', text: '#1565C0' },
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => {
          const c = colors[toast.type];
          return (
            <div
              key={toast.id}
              className={`toast toast-${toast.type}`}
              style={{
                background: c.bg,
                borderColor: c.border,
                color: c.text,
              }}
            >
              <span className="toast-message">{toast.message}</span>
              <button
                type="button"
                aria-label="关闭通知"
                className="toast-close"
                onClick={() => removeToast(toast.id)}
                style={{ color: c.text }}
              >
                &times;
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};
