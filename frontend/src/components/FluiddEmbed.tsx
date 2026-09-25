import React, { useState, useEffect } from 'react';

interface FluiddEmbedProps {
  moonrakerUrl: string;
  fluiddUrl?: string;
  isOpen: boolean;
  onClose: () => void;
}

export const FluiddEmbed: React.FC<FluiddEmbedProps> = ({
  moonrakerUrl,
  fluiddUrl,
  isOpen,
  onClose,
}) => {
  const [iframeError, setIframeError] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIframeError(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const embedUrl = fluiddUrl || moonrakerUrl.replace(':7125', '').replace(/\/$/, '');

  const handleOpenNewTab = () => {
    window.open(embedUrl, '_blank');
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fluidd-modal-backdrop" onClick={handleBackdropClick}>
      <div className="fluidd-modal-container">
        <div className="fluidd-modal-header">
          <h3>Fluidd 控制中心</h3>
          <button className="fluidd-modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {iframeError ? (
          <div className="fluidd-error-state">
            <div className="fluidd-error-icon">⚠️</div>
            <h4>无法加载控制界面</h4>
            <p>可能是跨域限制或网络问题</p>
            <button className="btn btn-primary" onClick={handleOpenNewTab}>
              在新标签页打开
            </button>
          </div>
        ) : (
          <iframe
            src={embedUrl}
            className="fluidd-iframe"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            allow="camera; microphone"
            title="Fluidd Interface"
            onError={() => setIframeError(true)}
          />
        )}
      </div>

      <style>{`
        .fluidd-modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.75);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 1rem;
        }

        .fluidd-modal-container {
          background: var(--bg-primary, #1a1a1a);
          border-radius: 12px;
          width: 90vw;
          height: 90vh;
          max-width: 1600px;
          max-height: 900px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        }

        .fluidd-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 1.5rem;
          border-bottom: 1px solid var(--border-color, #333);
          background: var(--bg-secondary, #222);
        }

        .fluidd-modal-header h3 {
          margin: 0;
          font-size: 1.125rem;
          font-weight: 600;
          color: var(--text-primary, #fff);
        }

        .fluidd-modal-close {
          background: none;
          border: none;
          font-size: 1.5rem;
          color: var(--text-secondary, #999);
          cursor: pointer;
          padding: 0.25rem 0.5rem;
          line-height: 1;
          transition: color 0.2s;
        }

        .fluidd-modal-close:hover {
          color: var(--text-primary, #fff);
        }

        .fluidd-iframe {
          flex: 1;
          border: none;
          width: 100%;
          height: 100%;
        }

        .fluidd-error-state {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem;
          text-align: center;
        }

        .fluidd-error-icon {
          font-size: 3rem;
          margin-bottom: 1rem;
        }

        .fluidd-error-state h4 {
          margin: 0 0 0.5rem;
          font-size: 1.25rem;
          color: var(--text-primary, #fff);
        }

        .fluidd-error-state p {
          margin: 0 0 1.5rem;
          color: var(--text-secondary, #999);
        }

        @media (max-width: 768px) {
          .fluidd-modal-container {
            width: 100vw;
            height: 100vh;
            max-width: none;
            max-height: none;
            border-radius: 0;
          }

          .fluidd-modal-backdrop {
            padding: 0;
          }
        }
      `}</style>
    </div>
  );
};
