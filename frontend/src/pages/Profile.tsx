import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import * as authApi from '../services/auth';
import {
  getUserModels,
  getPrintHistory,
  createPrintHistory,
  updatePrintHistory,
  deletePrintHistory,
  getFollowers,
  getFollowing,
  getMyFavorites,
  getNotifications,
  getAvatarUrl,
  type ModelData,
  type PrintHistoryRecord,
  type FollowUserData,
  type NotificationData,
  type PrintHistoryStatus,
} from '../services/api';
import ModelCard from '../components/ModelCard';
import { SkeletonGrid } from '../components/Skeleton';
import { useToast } from '../stores/toast';


const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null
);

const getApiErrorDetail = (error: unknown, fallback: string) => {
  if (!isRecord(error) || !isRecord(error.response)) return fallback;
  const data = error.response.data;
  if (!isRecord(data) || typeof data.detail !== 'string') return fallback;
  return data.detail.trim() || fallback;
};

const PROFILE_TABS = ['models', 'prints', 'devices', 'follows', 'favorites', 'notifications', 'comments', 'settings'] as const;
type ProfileMobilePanel = 'tabs' | 'actions' | 'account' | null;

const normalizeProfileTab = (tab: string | null) => {
  if (tab === 'following') return 'follows';
  if (tab === 'tasks') return 'tasks';
  if (tab && PROFILE_TABS.includes(tab as typeof PROFILE_TABS[number])) return tab;
  return 'models';
};

const Profile: React.FC = () => {
  const { user, login, logout, isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState('models');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ username: '', email: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [myModels, setMyModels] = useState<ModelData[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [totalModels, setTotalModels] = useState(0);
  const [printHistory, setPrintHistory] = useState<PrintHistoryRecord[]>([]);
  const [printHistoryLoading, setPrintHistoryLoading] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followers, setFollowers] = useState<FollowUserData[]>([]);
  const [followingUsers, setFollowingUsers] = useState<FollowUserData[]>([]);
  const [favoriteModels, setFavoriteModels] = useState<ModelData[]>([]);
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [showPrintForm, setShowPrintForm] = useState(false);
  const [printFormLoading, setPrintFormLoading] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<ProfileMobilePanel>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [printForm, setPrintForm] = useState({
    model_name: '',
    status: 'completed' as PrintHistoryStatus,
    notes: '',
  });

  const switchTab = (tab: string) => {
    if (tab === 'tasks') {
      navigate('/projects?tab=tasks');
      return;
    }
    setActiveTab(tab);
    setMobilePanel(null);
    setSearchParams({ tab });
    if (tab === 'settings') setIsEditing(true);
  };

  const loadMyModels = useCallback(async () => {
    if (!user) return;
    try {
      setModelsLoading(true);
      const data = await getUserModels(user.id);
      setMyModels(data.models);
      setTotalModels(data.total);
    } catch {
      console.error('Failed to load user models');
    } finally {
      setModelsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      setEditForm({ username: user.username, email: user.email });
      loadMyModels();
      getFollowers(user.id, { limit: 1 }).then(r => setFollowersCount(r.total)).catch(() => {});
      getFollowing(user.id, { limit: 1 }).then(r => setFollowingCount(r.total)).catch(() => {});
    }
  }, [user, loadMyModels]);

  useEffect(() => {
    const nextTab = normalizeProfileTab(searchParams.get('tab'));
    if (nextTab === 'tasks') {
      navigate('/projects?tab=tasks', { replace: true });
      return;
    }
    setActiveTab(nextTab);
    if (nextTab === 'settings') setIsEditing(true);
  }, [searchParams, navigate]);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (activeTab === 'prints' && user) {
      loadPrintHistory();
    }
    if (activeTab === 'follows' && user) {
      getFollowers(user.id).then(r => setFollowers(r.users)).catch(() => {});
      getFollowing(user.id).then(r => setFollowingUsers(r.users)).catch(() => {});
    }
    if (activeTab === 'favorites' && user) {
      getMyFavorites().then(r => { setFavoriteModels(r.models); setFavoritesCount(r.total); }).catch(() => {});
    }
    if ((activeTab === 'notifications' || activeTab === 'comments') && user) {
      loadNotifications(activeTab === 'comments' ? ['comment', 'print_feedback'] : undefined);
    }
  }, [activeTab, user]);

  useEffect(() => {
    document.body.classList.toggle('profile-mobile-panel-open', mobilePanel !== null);
    return () => document.body.classList.remove('profile-mobile-panel-open');
  }, [mobilePanel]);

  const loadNotifications = async (types?: string[]) => {
    try {
      setNotificationsLoading(true);
      const data = await getNotifications({ limit: 50 });
      const rows = types
        ? data.notifications.filter(n => types.some(type => n.type.includes(type)))
        : data.notifications;
      setNotifications(rows);
    } catch {
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const loadPrintHistory = async () => {
    try {
      setPrintHistoryLoading(true);
      const data = await getPrintHistory({ limit: 50 });
      setPrintHistory(data.records);
    } catch {
      console.error('Failed to load print history');
    } finally {
      setPrintHistoryLoading(false);
    }
  };

  const handleCreatePrintHistory = async () => {
    if (!printForm.model_name.trim()) {
      setError('请填写模型名称');
      return;
    }
    try {
      setPrintFormLoading(true);
      setError('');
      await createPrintHistory({
        model_name: printForm.model_name.trim(),
        status: printForm.status,
        notes: printForm.notes.trim() || undefined,
      });
      setPrintForm({ model_name: '', status: 'completed', notes: '' });
      setShowPrintForm(false);
      await loadPrintHistory();
    } catch (err: unknown) {
      setError(getApiErrorDetail(err, '记录打印失败'));
    } finally {
      setPrintFormLoading(false);
    }
  };

  const handleUpdatePrintStatus = async (record: PrintHistoryRecord, status: PrintHistoryStatus) => {
    try {
      const updated = await updatePrintHistory(record.id, {
        status,
        completed_at: ['completed', 'failed', 'cancelled'].includes(status) ? new Date().toISOString() : undefined,
      });
      setPrintHistory(prev => prev.map(item => item.id === record.id ? updated : item));
      showToast('打印状态已更新', 'success');
    } catch (err: unknown) {
      showToast(getApiErrorDetail(err, '更新打印状态失败'), 'error');
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    try {
      return new Date(dateStr).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (status: PrintHistoryRecord['status']) => {
    if (status === 'completed') {
      return <span className="badge badge-success">已完成</span>;
    }
    if (status === 'failed') {
      return <span className="badge badge-danger">失败</span>;
    }
    if (status === 'uploaded' || status === 'queued' || status === 'started' || status === 'printing') {
      return (
        <span className="badge" style={{ background: '#E8F2FF', color: '#2563EB' }}>
          {status === 'uploaded' ? '已上传' : status === 'queued' ? '已排队' : status === 'started' ? '已开始' : '打印中'}
        </span>
      );
    }
    return (
      <span className="badge" style={{ background: '#F3F5F7', color: '#6C757D' }}>
        已取消
      </span>
    );
  };

  const handleSaveProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const updatedUser = await authApi.updateProfile(editForm.username, editForm.email);
      const token = localStorage.getItem('token');
      if (token) {
        login(token, updatedUser);
      }
      setIsEditing(false);
    } catch (err: unknown) {
      setError(getApiErrorDetail(err, '更新失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await authApi.uploadAvatar(file);
      if (user) {
        const token = localStorage.getItem('token');
        if (token) login(token, { ...user, avatar_path: result.avatar_path });
      }
    } catch (err: unknown) {
      setError(getApiErrorDetail(err, '头像上传失败'));
    }
  };

  const totalDownloads = myModels.reduce((sum, m) => sum + m.downloads, 0);
  const totalLikes = myModels.reduce((sum, m) => sum + m.likes, 0);

  const stats = [
    { value: totalModels.toString(), label: '我的模型' },
    { value: totalLikes.toString(), label: '获赞' },
    { value: totalDownloads.toString(), label: '下载量' },
  ];

  const profileTabItems = [
    { id: 'models', label: `我的模型 (${totalModels})`, shortLabel: '模型' },
    { id: 'prints', label: '打印历史', shortLabel: '打印' },
    { id: 'devices', label: '我的设备', shortLabel: '设备' },
    { id: 'follows', label: `关注 / 粉丝 (${followingCount}/${followersCount})`, shortLabel: '关系' },
    { id: 'favorites', label: `收藏夹 (${favoritesCount})`, shortLabel: '收藏' },
    { id: 'notifications', label: '消息通知', shortLabel: '消息' },
    { id: 'comments', label: '评论反馈', shortLabel: '评论' },
    { id: 'settings', label: '账号设置', shortLabel: '设置' },
  ];
  const activeTabLabel = profileTabItems.find((tab) => tab.id === activeTab)?.shortLabel || '模型';

  if (!user) {
    return (
      <div className="page-enter profile-page">
        <div className="route-shell__rail route-shell__rail--wide profile-rail">
          <div className="profile-tab-state" style={{ textAlign: 'center', padding: '48px' }}>
            <p>加载中...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`page-enter profile-page ${mobilePanel ? `mobile-panel-${mobilePanel}` : ''}`}>
      <div className="route-shell__rail route-shell__rail--wide profile-rail">
        {mobilePanel && (
          <button
            type="button"
            className="mobile-panel-backdrop profile-mobile-backdrop"
            aria-label="关闭移动端个人中心面板"
            onClick={() => setMobilePanel(null)}
          />
        )}
        {error && (
        <div style={{
          background: '#FFEBEE',
          color: '#C62828',
          padding: '12px',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          {error}
        </div>
        )}

      <div className="profile-header">
        <div className="profile-avatar" role="button" aria-label="点击上传头像" tabIndex={0} onClick={() => avatarInputRef.current?.click()} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') avatarInputRef.current?.click(); }} style={{ cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
          {user.avatar_path ? (
            <img src={getAvatarUrl(user.avatar_path)} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
          ) : (
            user.username.charAt(0).toUpperCase()
          )}
          <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
        </div>
        <div className="profile-info">
          {isEditing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input
                type="text"
                value={editForm.username}
                onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                className="form-input"
                placeholder="用户名"
                style={{ width: '200px' }}
              />
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="form-input"
                placeholder="邮箱"
                style={{ width: '200px' }}
              />
            </div>
          ) : (
            <>
              <div className="profile-name">{user.username}</div>
              <div className="profile-bio">{user.email}</div>
            </>
          )}
          <div className="profile-stats" style={{ marginTop: '12px' }}>
            {stats.map((stat, index) => (
              <div key={index} className="profile-stat">
                <div className="profile-stat-value">{stat.value}</div>
                <div className="profile-stat-label">{stat.label}</div>
              </div>
            ))}
          </div>
          <div className="profile-creator-summary" aria-label="创作者概览">
            <span>{followersCount} 粉丝</span>
            <span>{followingCount} 关注</span>
            <span>{favoritesCount} 收藏</span>
          </div>
        </div>
        <div className="profile-actions" style={{ display: 'flex', gap: '8px' }}>
          {isEditing ? (
            <>
              <button
                className="btn btn-primary"
                onClick={handleSaveProfile}
                disabled={loading}
              >
                {loading ? '保存中...' : '保存'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setIsEditing(false)}
              >
                取消
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => setIsEditing(true)}
              >
                编辑资料
              </button>
              <button
                className="btn btn-danger"
                onClick={handleLogout}
              >
                退出登录
              </button>
            </>
          )}
        </div>
      </div>

      <div className="profile-mobile-command-bar" aria-label="个人中心移动操作栏">
        <button type="button" onClick={() => setMobilePanel('tabs')}>当前：{activeTabLabel}</button>
        <button type="button" onClick={() => setMobilePanel('actions')}>快捷</button>
        <button type="button" onClick={() => setMobilePanel('account')}>账号</button>
      </div>

      <div className="profile-mobile-tabs-panel">
        <div className="mobile-panel-head">
          <div>
            <strong>切换内容</strong>
            <span>移动端一次只聚焦一个资料任务</span>
          </div>
          <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
        </div>
        <div className="profile-mobile-panel-list">
          {profileTabItems.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => switchTab(tab.id)}
            >
              <span>{tab.label}</span>
              {activeTab === tab.id && <strong>当前</strong>}
            </button>
          ))}
        </div>
      </div>

      <div className="profile-mobile-actions-panel">
        <div className="mobile-panel-head">
          <div>
            <strong>快捷入口</strong>
            <span>常用操作不挤占资料内容</span>
          </div>
          <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
        </div>
        <div className="profile-mobile-action-list">
          <Link to="/projects?tab=models" onClick={() => setMobilePanel(null)}>管理我的模型</Link>
          <Link to="/projects" onClick={() => setMobilePanel(null)}>打开项目中心</Link>
          <Link to="/projects?tab=tasks" onClick={() => setMobilePanel(null)}>查看切片任务</Link>
          <Link to="/models" onClick={() => setMobilePanel(null)}>发现模型</Link>
        </div>
      </div>

      <div className="profile-mobile-account-panel">
        <div className="mobile-panel-head">
          <div>
            <strong>账号操作</strong>
            <span>编辑资料、头像和登录状态</span>
          </div>
          <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
        </div>
        <div className="profile-mobile-account-actions">
          <button type="button" className="btn btn-secondary" onClick={() => avatarInputRef.current?.click()}>更换头像</button>
          {isEditing ? (
            <>
              <button type="button" className="btn btn-primary" onClick={handleSaveProfile} disabled={loading}>
                {loading ? '保存中...' : '保存资料'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setIsEditing(false)}>取消编辑</button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => setIsEditing(true)}>编辑资料</button>
          )}
          <button type="button" className="btn btn-danger" onClick={handleLogout}>退出登录</button>
        </div>
      </div>

      <div className="profile-action-grid" aria-label="账号快捷操作">
        <Link to="/projects?tab=models" className="card profile-action-card">
          <strong>管理我的模型</strong>
          <span>查看上传记录、模型数据与后续项目</span>
        </Link>
        <Link to="/projects" className="card profile-action-card">
          <strong>打开项目中心</strong>
          <span>继续编辑保存的 4D 打印项目</span>
        </Link>
        <Link to="/projects?tab=tasks" className="card profile-action-card">
          <strong>查看切片任务</strong>
          <span>追踪后台 G-code 处理与下载结果</span>
        </Link>
      </div>

      <div className="tabs profile-tabs">
        {profileTabItems.filter((tab) => tab.id !== 'comments').map((tab) => (
          <button
            key={tab.id}
            className={`tab ${
              tab.id === 'notifications'
                ? (activeTab === 'notifications' || activeTab === 'comments' ? 'active' : '')
                : (activeTab === tab.id ? 'active' : '')
            }`}
            onClick={() => switchTab(tab.id)}
          >
            {tab.id === 'notifications' ? '消息' : tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'models' && (
        modelsLoading ? (
          <div className="profile-tab-panel profile-tab-panel--models">
            <SkeletonGrid count={4} />
          </div>
        ) : myModels.length === 0 ? (
          <div className="empty-state profile-tab-state" style={{ textAlign: 'center', padding: '48px', color: '#999' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '16px' }}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            <p style={{ marginBottom: '16px' }}>你还没有上传过模型</p>
            <Link to="/models" className="btn btn-primary">去上传</Link>
          </div>
        ) : (
          <div className="model-grid stagger-children profile-tab-panel profile-tab-panel--models">
            {myModels.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
          </div>
        )
      )}

      {activeTab === 'prints' && (
        <div className="profile-tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>打印历史</h3>
            <button
              className="btn btn-primary"
              onClick={() => setShowPrintForm((v) => !v)}
            >
              {showPrintForm ? '取消' : '记录打印'}
            </button>
          </div>

          {showPrintForm && (
            <div className="card">
              <div className="card-body">
                <div className="form-group">
                  <label className="form-label">模型名称</label>
                  <input
                    className="form-input"
                    value={printForm.model_name}
                    onChange={(e) => setPrintForm({ ...printForm, model_name: e.target.value })}
                    placeholder="例如：磁吸收纳盒"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">状态</label>
                  <select
                    className="form-input form-select"
                    value={printForm.status}
                    onChange={(e) => setPrintForm({
                      ...printForm,
                      status: e.target.value as PrintHistoryStatus,
                    })}
                  >
                    <option value="completed">已完成</option>
                    <option value="failed">失败</option>
                    <option value="cancelled">已取消</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">备注</label>
                  <textarea
                    className="form-input form-textarea"
                    value={printForm.notes}
                    onChange={(e) => setPrintForm({ ...printForm, notes: e.target.value })}
                    placeholder="可填写耗材、失败原因、参数等"
                    rows={3}
                  />
                </div>
                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleCreatePrintHistory}
                    disabled={printFormLoading}
                  >
                    {printFormLoading ? '提交中...' : '保存记录'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {printHistoryLoading ? (
            <div className="profile-tab-state" style={{ textAlign: 'center', padding: '32px', color: '#999' }}>加载中...</div>
          ) : printHistory.length === 0 ? (
            <div className="empty-state profile-tab-state" style={{ textAlign: 'center', padding: '48px', color: '#999' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ddd" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '16px' }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <p>暂无打印记录</p>
              <p style={{ fontSize: '0.85rem', marginTop: '8px' }}>点击右上角“记录打印”开始添加</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {printHistory.map((record) => (
                <div key={record.id} className="card">
                  <div className="card-body" style={{ padding: '18px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: '8px' }}>{record.model_name}</div>
                        <div style={{ fontSize: '0.85rem', color: '#6C757D' }}>
                          开始时间: {formatDateTime(record.started_at)}
                        </div>
                        {record.gcode_filename && (
                          <div style={{ fontSize: '0.8rem', color: '#8A93A3', marginTop: 4 }}>
                            G-code: {record.gcode_filename}
                          </div>
                        )}
                        {record.notes && (
                          <p style={{ marginTop: '8px', fontSize: '0.9rem', color: '#5A6270' }}>{record.notes}</p>
                        )}
                      </div>
                      {getStatusBadge(record.status)}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                      {record.status !== 'completed' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                          onClick={() => handleUpdatePrintStatus(record, 'completed')}
                        >
                          标记完成
                        </button>
                      )}
                      {record.status !== 'failed' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                          onClick={() => handleUpdatePrintStatus(record, 'failed')}
                        >
                          标记失败
                        </button>
                      )}
                      {record.status !== 'cancelled' && (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                          onClick={() => handleUpdatePrintStatus(record, 'cancelled')}
                        >
                          取消记录
                        </button>
                      )}
                      {record.model_id && (
                        <button
                          className="btn btn-primary"
                          style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                          onClick={() => navigate(`/models/${record.model_id}?tab=feedback&history=${record.id}`)}
                        >
                          发布反馈
                        </button>
                      )}
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '4px 12px', fontSize: '0.75rem' }}
                        aria-label="删除记录"
                        onClick={async () => {
                          try {
                            await deletePrintHistory(record.id);
                            setPrintHistory(prev => prev.filter(r => r.id !== record.id));
                            showToast('记录已删除', 'success');
                          } catch { showToast('删除失败', 'error'); }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'devices' && (
        <div className="profile-tab-panel profile-device-panel" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          <div className="device-card" style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            border: '2px dashed #DEE2E6',
            minHeight: '160px',
          }}
            onClick={() => navigate('/device')}
          >
            <div style={{ textAlign: 'center', color: '#6C757D' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>+</div>
              <div>添加设备</div>
              <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>前往设备控制台</div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'follows' && (
        <div className="profile-tab-panel profile-follows-panel">
          <h3 style={{ marginBottom: 16, fontSize: '1.1rem' }}>我关注的 ({followingCount})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 32 }}>
            {followingUsers.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg-secondary, #F8F9FA)', borderRadius: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #7BC9A6, #A3D9C2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', flexShrink: 0 }}>
                  {u.avatar_path ? <img src={getAvatarUrl(u.avatar_path)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]}
                </div>
                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{u.username}</span>
              </div>
            ))}
            {followingUsers.length === 0 && <p className="profile-inline-empty" style={{ color: '#999', padding: 16 }}>暂无关注</p>}
          </div>
          <h3 style={{ marginBottom: 16, fontSize: '1.1rem' }}>粉丝 ({followersCount})</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {followers.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: 'var(--bg-secondary, #F8F9FA)', borderRadius: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'linear-gradient(135deg, #7BC9A6, #A3D9C2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', flexShrink: 0 }}>
                  {u.avatar_path ? <img src={getAvatarUrl(u.avatar_path)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : u.username[0]}
                </div>
                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{u.username}</span>
              </div>
            ))}
            {followers.length === 0 && <p className="profile-inline-empty" style={{ color: '#999', padding: 16 }}>暂无粉丝</p>}
          </div>
        </div>
      )}

      {activeTab === 'favorites' && (
        favoriteModels.length === 0 ? (
          <div className="empty-state profile-tab-state" style={{ textAlign: 'center', padding: '48px', color: '#999' }}>
            <p>暂无收藏的模型</p>
            <Link to="/models" className="btn btn-primary" style={{ marginTop: 12, display: 'inline-block' }}>去发现</Link>
          </div>
        ) : (
          <div className="model-grid stagger-children profile-tab-panel profile-tab-panel--models">
            {favoriteModels.map(m => (
              <ModelCard key={m.id} model={m} />
            ))}
          </div>
        )
      )}

      {(activeTab === 'notifications' || activeTab === 'comments') && (
        <div className="profile-tab-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{activeTab === 'comments' ? '评论与反馈消息' : '消息通知'}</h3>
            <button className="btn btn-secondary" onClick={() => loadNotifications(activeTab === 'comments' ? ['comment', 'print_feedback'] : undefined)}>
              刷新
            </button>
          </div>
          {notificationsLoading ? (
            <div className="profile-tab-state" style={{ textAlign: 'center', padding: '32px', color: '#999' }}>加载中...</div>
          ) : notifications.length === 0 ? (
            <div className="empty-state profile-tab-state" style={{ textAlign: 'center', padding: '48px', color: '#999' }}>
              <p>暂无消息</p>
            </div>
          ) : (
            notifications.map((item) => (
              <button
                key={item.id}
                className="card profile-notification-card"
                style={{ textAlign: 'left', border: '1px solid var(--border-light)', cursor: item.link ? 'pointer' : 'default' }}
                onClick={() => item.link && navigate(item.link)}
              >
                <div className="card-body profile-notification-body" style={{ padding: '16px 18px' }}>
                  <div className="profile-notification-head" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <strong className="profile-notification-title">{item.title}</strong>
                    {!item.read_at && <span className="badge" style={{ background: '#E8F2FF', color: '#2563EB' }}>未读</span>}
                  </div>
                  <p className="profile-notification-message" style={{ margin: '8px 0 0', color: '#5A6270', fontSize: '0.9rem' }}>{item.message}</p>
                  <div className="profile-notification-time" style={{ marginTop: 8, color: '#8A93A3', fontSize: '0.78rem' }}>{formatDateTime(item.created_at)}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="profile-tab-panel">
          <div className="card">
            <div className="card-body" style={{ padding: '24px' }}>
              <h3 style={{ marginBottom: 16, fontSize: '1.1rem' }}>账号设置</h3>
              <p style={{ color: '#6C757D', marginBottom: 16 }}>在页面顶部编辑用户名、邮箱和头像。账号更新后会立即同步到当前会话。</p>
              <button className="btn btn-primary" onClick={() => setIsEditing(true)}>编辑资料</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default Profile;
