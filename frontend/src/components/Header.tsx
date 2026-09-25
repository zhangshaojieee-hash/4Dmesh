import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationData,
} from '../services/api';

const HeaderIcon = ({ name }: { name: 'search' | 'bell' | 'close' | 'collapse' | 'home' | 'models' | 'ai' | 'editor' | 'projects' | 'device' }) => {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
    case 'bell':
      return <svg {...common}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>;
    case 'close':
      return <svg {...common}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
    case 'collapse':
      return <svg {...common}><path d="M15 18l-6-6 6-6" /><path d="M20 4v16" /></svg>;
    case 'home':
      return <svg {...common}><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9Z" /></svg>;
    case 'models':
      return <svg {...common}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" /><path d="M4 7.5 12 12l8-4.5" /><path d="M12 12v9" /></svg>;
    case 'ai':
      return <svg {...common}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></svg>;
    case 'editor':
      return <svg {...common}><path d="m8 9-4 3 4 3" /><path d="m16 9 4 3-4 3" /><path d="m14 5-4 14" /></svg>;
    case 'projects':
      return <svg {...common}><path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /><rect x="2" y="6" width="20" height="14" rx="2" /></svg>;
    case 'device':
      return <svg {...common}><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v8H6z" /></svg>;
    default:
      return null;
  }
};

type NavIconName = 'home' | 'models' | 'ai' | 'editor' | 'projects' | 'device';

type HeaderProps = {
  railCollapsed?: boolean;
  onToggleRail?: () => void;
};

const formatNotificationTime = (value: string) => {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return value;
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(value).toLocaleDateString('zh-CN');
};

const Header: React.FC<HeaderProps> = ({ railCollapsed = false, onToggleRail }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = useCallback(async () => {
    if (!isAuthenticated) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      const data = await getNotifications({ limit: 20 });
      setNotifications(data.notifications);
      setUnreadCount(data.unread_count);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [isAuthenticated]);

  const markAllAsRead = async () => {
    await markAllNotificationsRead().catch(() => undefined);
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || now })));
    setUnreadCount(0);
  };

  const handleNotificationClick = async (notif: NotificationData) => {
    if (!notif.read_at) {
      markNotificationRead(notif.id).catch(() => undefined);
      setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read_at: new Date().toISOString() } : n));
      setUnreadCount(count => Math.max(0, count - 1));
    }
    setShowNotifications(false);
    if (notif.link) navigate(notif.link);
  };

  const navItems: Array<{ path: string; label: string; icon: NavIconName; match: (p: string) => boolean }> = [
    { path: '/', label: '首页', icon: 'home', match: (p: string) => p === '/' },
    { path: '/models', label: '模型库', icon: 'models', match: (p: string) => p.startsWith('/models') },
    { path: '/ai', label: 'AI创作', icon: 'ai', match: (p: string) => p === '/ai' },
    { path: '/editor', label: 'G-code', icon: 'editor', match: (p: string) => p === '/editor' },
    { path: '/projects', label: '项目中心', icon: 'projects', match: (p: string) => p === '/projects' },
    { path: '/device', label: '设备', icon: 'device', match: (p: string) => p === '/device' },
  ];

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close menus on route change
  useEffect(() => {
    const resetMenus = () => {
      setShowUserMenu(false);
      setMobileMenuOpen(false);
      if (!location.pathname.startsWith('/models')) {
        setSearchQuery('');
      }
    };

    const timeoutId = window.setTimeout(resetMenus, 0);
    return () => window.clearTimeout(timeoutId);
  }, [location.pathname]);

  useEffect(() => {
    loadNotifications();
    if (!isAuthenticated) return;
    const timer = window.setInterval(loadNotifications, 45000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, loadNotifications]);

  // Close mobile menu on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (!mobileMenuOpen) {
      document.body.classList.remove('mobile-nav-open');
      document.body.style.overflow = '';
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.classList.add('mobile-nav-open');
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.classList.remove('mobile-nav-open');
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  const performSearch = () => {
    const query = searchQuery.trim();
    if (!query) return;
    setMobileMenuOpen(false);
    navigate(`/models?search=${encodeURIComponent(query)}`);
  };

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  };

  const handleMobileSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch();
  };

  const handleLogout = () => {
    logout();
    setShowUserMenu(false);
    navigate('/');
  };

  return (
    <>
    <header className="header">
      <div className="header-inner">
        <div className="header-left">
          <div className="header-brand-row">
            <button
              type="button"
              className={`mobile-hamburger ${mobileMenuOpen ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="打开移动导航"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
            >
              <span />
              <span />
              <span />
            </button>
            <Link to="/" className="header-logo">
              <div className="header-logo-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              </div>
              <span>创客学堂</span>
            </Link>
            <button
              type="button"
              className="header-rail-toggle"
              onClick={onToggleRail}
              aria-label={railCollapsed ? '展开左侧导航' : '收起左侧导航'}
              aria-pressed={railCollapsed}
            >
              <HeaderIcon name="collapse" />
            </button>
          </div>

          <nav className="header-nav">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${item.match(location.pathname) ? 'active' : ''}`}
                aria-label={item.label}
              >
                <span className="nav-item-icon"><HeaderIcon name={item.icon} /></span>
                <span className="nav-item-label">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="header-center">
          <div className="search-box">
            <span className="search-icon">
              <HeaderIcon name="search" />
            </span>
            <input
              type="search"
              className="search-input"
              placeholder="搜索模型、作者、标签..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearch}
              aria-label="搜索模型、作者、标签"
            />
          </div>
        </div>

        <div className={`header-right ${isAuthenticated ? 'is-authenticated' : 'is-guest'}`}>
          <div ref={notifRef} className="header-notification-shell">
            <button
              type="button"
              className="header-notification" 
              aria-label="通知"
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <HeaderIcon name="bell" />
              {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
            </button>
            
            {showNotifications && (
              <div className="notification-dropdown animate-dropdown-in">
                <div className="notification-header">
                  <h3>通知</h3>
                  {unreadCount > 0 && <button className="mark-read-btn" onClick={markAllAsRead}>全部标为已读</button>}
                </div>
                <div className="notification-list">
                  {notifications.length > 0 ? (
                    notifications.map(notif => (
                      <div key={notif.id} className={`notification-item ${!notif.read_at ? 'unread' : ''}`} onClick={() => handleNotificationClick(notif)}>
                        <div className="notification-item-content">
                          <div className="notification-item-title">{notif.title}</div>
                          <div className="notification-item-message">{notif.message}</div>
                          <div className="notification-item-time">{formatNotificationTime(notif.created_at)}</div>
                        </div>
                        {!notif.read_at && <div className="notification-unread-dot" />}
                      </div>
                    ))
                  ) : (
                    <div className="notification-empty">暂无通知</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {isAuthenticated && user ? (
            <div ref={menuRef} className="user-identity-shell">
              <div
                className={`user-identity-card ${showUserMenu ? 'active' : ''}`}
                role="button"
                aria-label="用户菜单"
                aria-expanded={showUserMenu}
                tabIndex={0}
                onClick={() => setShowUserMenu(!showUserMenu)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowUserMenu(!showUserMenu); } }}
              >
                <span className="user-avatar">{user.username.charAt(0).toUpperCase()}</span>
                <span className="user-identity-copy">
                  <strong>{user.username}</strong>
                  <small>{user.email}</small>
                </span>
                <svg className="user-identity-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>

              {showUserMenu && (
                <div className="user-dropdown animate-dropdown-in" role="menu">
                  <div className="user-dropdown-info">
                    <div className="user-dropdown-info-avatar">{user.username.charAt(0).toUpperCase()}</div>
                    <div className="user-dropdown-info-text">
                      <div className="user-dropdown-info-name">{user.username}</div>
                      <div className="user-dropdown-info-email">{user.email}</div>
                    </div>
                    <Link to="/profile" className="user-dropdown-profile-link" onClick={() => setShowUserMenu(false)}>查看个人主页</Link>
                  </div>

                  <div className="user-dropdown-group">
                    <div className="user-dropdown-group-title">我的内容</div>
                    <Link to="/profile?tab=models" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      我的模型
                    </Link>
                    <Link to="/projects" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      我的项目
                    </Link>
                    <Link to="/profile?tab=favorites" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      收藏夹
                    </Link>
                    <Link to="/projects?tab=tasks" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      切片任务
                    </Link>
                  </div>

                  <div className="user-dropdown-group">
                    <div className="user-dropdown-group-title">社区互动</div>
                    <Link to="/profile?tab=notifications" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      消息通知
                    </Link>
                    <Link to="/profile?tab=comments" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      评论与回复
                    </Link>
                    <Link to="/profile?tab=following" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      我的关注
                    </Link>
                  </div>

                  <div className="user-dropdown-group">
                    <div className="user-dropdown-group-title">账户</div>
                    <Link to="/profile?tab=settings" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      账号设置
                    </Link>
                    <Link to="/profile?tab=settings" className="user-dropdown-item" onClick={() => setShowUserMenu(false)}>
                      帮助与反馈
                    </Link>
                    {user.is_admin && (
                      <Link to="/admin" className="user-dropdown-item admin-item" onClick={() => setShowUserMenu(false)}>
                        后台管理
                      </Link>
                    )}
                  </div>

                  <div className="user-dropdown-divider" />
                  
                  <div className="user-dropdown-group" style={{ paddingBottom: '4px' }}>
                    <button onClick={handleLogout} className="user-dropdown-item user-dropdown-logout">
                      退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="header-auth-panel" aria-label="登录入口">
              <div className="header-auth-actions">
                <Link to="/login" className="header-btn header-btn-ghost">
                  登录
                </Link>
                <Link to="/login?tab=register" className="header-btn header-btn-primary">
                  注册
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>

      {mobileMenuOpen && (
        <div className="mobile-nav-overlay" aria-hidden="true" onClick={() => setMobileMenuOpen(false)} />
      )}

      <nav
        id="mobile-navigation"
        className={`mobile-nav-drawer ${mobileMenuOpen ? 'open' : ''}`}
        aria-label="Mobile navigation"
        aria-hidden={!mobileMenuOpen}
      >
        <div className="mobile-nav-header">
          <Link to="/" className="header-logo" onClick={() => setMobileMenuOpen(false)}>
            <div className="header-logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            </div>
            <span>创客学堂</span>
          </Link>
            <button
              type="button"
              className="mobile-nav-close"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="关闭移动导航"
          >
            <HeaderIcon name="close" />
          </button>
        </div>

        <form className="mobile-nav-search" onSubmit={handleMobileSearch} role="search">
          <span className="mobile-nav-search-icon" aria-hidden="true">
            <HeaderIcon name="search" />
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索模型、作者、标签..."
            aria-label="搜索模型"
          />
          <button type="submit" disabled={!searchQuery.trim()}>搜索</button>
        </form>

        <div className="mobile-nav-links">
          <div className="mobile-nav-section-label">主要功能</div>
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`mobile-nav-item ${item.match(location.pathname) ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(false)}
            >
              <span className="mobile-nav-item-icon"><HeaderIcon name={item.icon} /></span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>

        <div className="mobile-nav-divider" />

        <div className="mobile-nav-auth">
          {isAuthenticated && user ? (
            <>
              <div className="mobile-nav-section-label">账户</div>
              <div className="mobile-nav-user">
                <div className="mobile-nav-user-avatar">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="mobile-nav-user-name">{user.username}</div>
                  <div className="mobile-nav-user-email">{user.email}</div>
                </div>
              </div>
              <Link
                to="/profile"
                className="mobile-nav-item"
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className="mobile-nav-item-icon"><HeaderIcon name="home" /></span>
                <span>个人中心</span>
              </Link>
              <Link
                to="/projects?tab=models"
                className="mobile-nav-item"
                onClick={() => setMobileMenuOpen(false)}
              >
                <span className="mobile-nav-item-icon"><HeaderIcon name="models" /></span>
                <span>我的模型</span>
              </Link>
              {user.is_admin && (
                <Link
                  to="/admin"
                  className="mobile-nav-item"
                  onClick={() => setMobileMenuOpen(false)}
                  style={{ color: 'var(--primary)' }}
                >
                  <span className="mobile-nav-item-icon"><HeaderIcon name="projects" /></span>
                  <span>后台管理</span>
                </Link>
              )}
              <button
                type="button"
                className="mobile-nav-item mobile-nav-logout"
                onClick={() => { handleLogout(); setMobileMenuOpen(false); }}
              >
                <span>退出登录</span>
              </button>
            </>
          ) : (
            <>
              <div className="mobile-nav-section-label">账户</div>
              <div className="mobile-nav-auth-actions" aria-label="登录或注册">
                <Link
                  to="/login"
                  className="mobile-nav-auth-btn mobile-nav-auth-login"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  登录
                </Link>
                <Link
                  to="/login?tab=register"
                  className="mobile-nav-auth-btn mobile-nav-auth-register"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  注册
                </Link>
              </div>
            </>
          )}
        </div>
      </nav>
    </>
  );
};

export default Header;
