import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || '未知错误',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '60vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
              maxWidth: '520px',
              width: '100%',
              textAlign: 'center',
            }}
          >
            <h2 style={{ margin: '0 0 12px', fontSize: '1.5rem' }}>出错了</h2>
            <p style={{ margin: '0 0 20px', color: '#666', wordBreak: 'break-word' }}>
              {this.state.errorMessage}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => window.location.reload()}>
                重试
              </button>
              <a href="/" className="btn btn-secondary" style={{ textDecoration: 'none' }}>
                返回首页
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
