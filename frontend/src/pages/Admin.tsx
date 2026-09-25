import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/toast';
import {
  getAdminStats,
  getAdminUsers,
  getAdminModels,
  getAdminProjects,
  deleteAdminUser,
  deleteAdminModel,
  deleteAdminProject,
  getAdminReports,
  updateAdminReportStatus,
  type AdminStats,
  type AdminUserRow,
  type AdminModelRow,
  type AdminProjectRow,
  type AdminReportRow,
} from '../services/api';

type AdminTab = 'overview' | 'users' | 'models' | 'projects' | 'reports';
type AdminMobilePanel = 'tabs' | null;

const STAT_CARDS: { key: keyof AdminStats; label: string }[] = [
  { key: 'users', label: '用户' },
  { key: 'admins', label: '管理员' },
  { key: 'models', label: '模型' },
  { key: 'projects', label: '项目' },
  { key: 'gcode_files', label: 'G-code 文件' },
  { key: 'comments', label: '评论' },
  { key: 'print_history', label: '打印记录' },
];

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

const Admin: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated, isHydrated } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [models, setModels] = useState<AdminModelRow[]>([]);
  const [projects, setProjects] = useState<AdminProjectRow[]>([]);
  const [reports, setReports] = useState<AdminReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<AdminMobilePanel>(null);

  useEffect(() => {
    if (!isHydrated) return;
    if (!isAuthenticated) {
      navigate('/login');
    } else if (!user?.is_admin) {
      showToast('需要管理员权限', 'error');
      navigate('/');
    }
  }, [isHydrated, isAuthenticated, user, navigate, showToast]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await getAdminStats());
    } catch {
      showToast('加载统计数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      setUsers(await getAdminUsers());
    } catch {
      showToast('加载用户列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      setModels(await getAdminModels());
    } catch {
      showToast('加载模型列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      setProjects(await getAdminProjects());
    } catch {
      showToast('加载项目列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await getAdminReports());
    } catch {
      showToast('加载举报列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const tab = searchParams.get('tab') as AdminTab | null;
    if (tab && ['overview', 'users', 'models', 'projects', 'reports'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!user?.is_admin) return;
    if (activeTab === 'overview') loadStats();
    else if (activeTab === 'users') loadUsers();
    else if (activeTab === 'models') loadModels();
    else if (activeTab === 'projects') loadProjects();
    else if (activeTab === 'reports') loadReports();
  }, [activeTab, user, loadStats, loadUsers, loadModels, loadProjects, loadReports]);

  useEffect(() => {
    document.body.classList.toggle('admin-mobile-panel-open', mobilePanel !== null);
    return () => document.body.classList.remove('admin-mobile-panel-open');
  }, [mobilePanel]);

  const switchTab = (tab: AdminTab) => {
    setActiveTab(tab);
    setMobilePanel(null);
    setSearchParams(tab === 'overview' ? {} : { tab });
  };

  const handleDeleteUser = async (row: AdminUserRow) => {
    if (!window.confirm(`确认删除用户「${row.username}」？该用户的关联数据将一并移除，且不可恢复。`)) return;
    setBusyId(`user-${row.id}`);
    try {
      await deleteAdminUser(row.id);
      setUsers((prev) => prev.filter((u) => u.id !== row.id));
      showToast('用户已删除', 'success');
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      showToast(detail || '删除用户失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteModel = async (row: AdminModelRow) => {
    if (!window.confirm(`确认删除模型「${row.name}」？此操作不可恢复。`)) return;
    setBusyId(`model-${row.id}`);
    try {
      await deleteAdminModel(row.id);
      setModels((prev) => prev.filter((m) => m.id !== row.id));
      showToast('模型已删除', 'success');
    } catch {
      showToast('删除模型失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteProject = async (row: AdminProjectRow) => {
    if (!window.confirm(`确认删除项目「${row.name}」？此操作不可恢复。`)) return;
    setBusyId(`project-${row.id}`);
    try {
      await deleteAdminProject(row.id);
      setProjects((prev) => prev.filter((p) => p.id !== row.id));
      showToast('项目已删除', 'success');
    } catch {
      showToast('删除项目失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleReportStatus = async (row: AdminReportRow, status: AdminReportRow['status']) => {
    setBusyId(`report-${row.id}`);
    try {
      await updateAdminReportStatus(row.id, status);
      setReports((prev) => prev.map((item) => (
        item.id === row.id ? { ...item, status, reviewed_at: new Date().toISOString() } : item
      )));
      showToast('举报状态已更新', 'success');
    } catch {
      showToast('更新举报状态失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (!user?.is_admin) return null;

  const tabs: { key: AdminTab; label: string }[] = [
    { key: 'overview', label: '概览' },
    { key: 'users', label: '用户管理' },
    { key: 'models', label: '模型管理' },
    { key: 'projects', label: '项目管理' },
    { key: 'reports', label: '举报处理' },
  ];

  return (
    <div className={`page-enter admin-page ${mobilePanel ? `mobile-panel-${mobilePanel}` : ''}`}>
      <div className="route-shell__rail route-shell__rail--wide admin-rail">
        {mobilePanel && (
          <button
            type="button"
            className="mobile-panel-backdrop admin-mobile-backdrop"
            aria-label="关闭移动端后台面板"
            onClick={() => setMobilePanel(null)}
          />
        )}
        <div className="page-header admin-header">
          <div>
            <h1 className="page-title">后台管理</h1>
            <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>
              当前管理员：{user.username}（{user.email}）
            </p>
          </div>
        </div>

        <div className="admin-mobile-command-bar" aria-label="后台管理移动操作栏">
          <button type="button" onClick={() => setMobilePanel('tabs')}>
            当前：{tabs.find((t) => t.key === activeTab)?.label || '概览'}
          </button>
        </div>

        <div className="admin-mobile-tabs-panel">
          <div className="mobile-panel-head">
            <div>
              <strong>后台模块</strong>
              <span>移动端用卡片列表查看管理数据</span>
            </div>
            <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
          </div>
          <div className="admin-mobile-panel-list">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                className={activeTab === t.key ? 'active' : ''}
                onClick={() => switchTab(t.key)}
              >
                <span>{t.label}</span>
                {activeTab === t.key && <strong>当前</strong>}
              </button>
            ))}
          </div>
        </div>

        <div className="admin-tabs" style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`btn ${activeTab === t.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => switchTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="admin-state" style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <div className="loading-spinner" />
          </div>
        )}

        {!loading && activeTab === 'overview' && stats && (
        <div
          className="stagger-children admin-overview-grid"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px' }}
        >
          {STAT_CARDS.map((card) => (
            <div
              key={card.key}
              className="card-lift"
              style={{
                background: 'var(--bg-card, #fff)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg, 12px)',
                padding: '20px',
              }}
            >
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{card.label}</div>
              <div style={{ fontSize: '1.8rem', fontWeight: 700, marginTop: '6px', color: 'var(--text-primary)' }}>
                {stats[card.key]}
              </div>
            </div>
          ))}
        </div>
        )}

        {!loading && activeTab === 'users' && (
        <div className="admin-table-shell admin-table-shell--users" style={{ overflowX: 'auto' }}>
          <div className="admin-mobile-card-list">
            {users.map((row) => (
              <article key={row.id} className="admin-mobile-row-card">
                <div className="admin-mobile-row-head">
                  <strong>{row.username}</strong>
                  <span>{row.is_admin ? '管理员' : '普通用户'}</span>
                </div>
                <dl>
                  <div><dt>ID</dt><dd>{row.id}</dd></div>
                  <div><dt>邮箱</dt><dd>{row.email}</dd></div>
                  <div><dt>模型 / 项目</dt><dd>{row.model_count} / {row.project_count}</dd></div>
                  <div><dt>注册时间</dt><dd>{formatTime(row.created_at)}</dd></div>
                </dl>
                {row.id === user.id ? (
                  <span className="admin-mobile-current-user">当前账号</span>
                ) : (
                  <button className="btn btn-secondary" disabled={busyId === `user-${row.id}`} onClick={() => handleDeleteUser(row)}>删除</button>
                )}
              </article>
            ))}
            {users.length === 0 && <div className="admin-mobile-empty">暂无用户</div>}
          </div>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px' }}>ID</th>
                <th style={{ padding: '10px' }}>用户名</th>
                <th style={{ padding: '10px' }}>邮箱</th>
                <th style={{ padding: '10px' }}>角色</th>
                <th style={{ padding: '10px' }}>模型</th>
                <th style={{ padding: '10px' }}>项目</th>
                <th style={{ padding: '10px' }}>注册时间</th>
                <th style={{ padding: '10px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>{row.id}</td>
                  <td style={{ padding: '10px' }}>{row.username}</td>
                  <td style={{ padding: '10px' }}>{row.email}</td>
                  <td style={{ padding: '10px' }}>
                    {row.is_admin ? (
                      <span style={{ color: 'var(--primary)', fontWeight: 600 }}>管理员</span>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>普通用户</span>
                    )}
                  </td>
                  <td style={{ padding: '10px' }}>{row.model_count}</td>
                  <td style={{ padding: '10px' }}>{row.project_count}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{formatTime(row.created_at)}</td>
                  <td style={{ padding: '10px' }}>
                    {row.id === user.id ? (
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>当前账号</span>
                    ) : (
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', color: 'var(--error, #dc2626)' }}
                        disabled={busyId === `user-${row.id}`}
                        onClick={() => handleDeleteUser(row)}
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>暂无用户</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {!loading && activeTab === 'models' && (
        <div className="admin-table-shell admin-table-shell--models" style={{ overflowX: 'auto' }}>
          <div className="admin-mobile-card-list">
            {models.map((row) => (
              <article key={row.id} className="admin-mobile-row-card">
                <div className="admin-mobile-row-head">
                  <strong>{row.name}</strong>
                  <span>#{row.id}</span>
                </div>
                <dl>
                  <div><dt>分类</dt><dd>{row.category || '—'}</dd></div>
                  <div><dt>作者</dt><dd>{row.author || '—'}</dd></div>
                  <div><dt>下载 / 点赞</dt><dd>{row.downloads} / {row.likes}</dd></div>
                  <div><dt>创建时间</dt><dd>{formatTime(row.created_at)}</dd></div>
                </dl>
                <button className="btn btn-secondary" disabled={busyId === `model-${row.id}`} onClick={() => handleDeleteModel(row)}>删除</button>
              </article>
            ))}
            {models.length === 0 && <div className="admin-mobile-empty">暂无模型</div>}
          </div>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px' }}>ID</th>
                <th style={{ padding: '10px' }}>名称</th>
                <th style={{ padding: '10px' }}>分类</th>
                <th style={{ padding: '10px' }}>作者</th>
                <th style={{ padding: '10px' }}>下载</th>
                <th style={{ padding: '10px' }}>点赞</th>
                <th style={{ padding: '10px' }}>创建时间</th>
                <th style={{ padding: '10px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {models.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>{row.id}</td>
                  <td style={{ padding: '10px' }}>{row.name}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{row.category || '—'}</td>
                  <td style={{ padding: '10px' }}>{row.author || '—'}</td>
                  <td style={{ padding: '10px' }}>{row.downloads}</td>
                  <td style={{ padding: '10px' }}>{row.likes}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{formatTime(row.created_at)}</td>
                  <td style={{ padding: '10px' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', color: 'var(--error, #dc2626)' }}
                      disabled={busyId === `model-${row.id}`}
                      onClick={() => handleDeleteModel(row)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>暂无模型</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {!loading && activeTab === 'projects' && (
        <div className="admin-table-shell admin-table-shell--projects" style={{ overflowX: 'auto' }}>
          <div className="admin-mobile-card-list">
            {projects.map((row) => (
              <article key={row.id} className="admin-mobile-row-card">
                <div className="admin-mobile-row-head">
                  <strong>{row.name}</strong>
                  <span>{row.step}</span>
                </div>
                <dl>
                  <div><dt>作者</dt><dd>{row.author || '—'}</dd></div>
                  <div><dt>模型</dt><dd>{row.model_name || '—'}</dd></div>
                  <div><dt>更新时间</dt><dd>{formatTime(row.updated_at)}</dd></div>
                </dl>
                <button className="btn btn-secondary" disabled={busyId === `project-${row.id}`} onClick={() => handleDeleteProject(row)}>删除</button>
              </article>
            ))}
            {projects.length === 0 && <div className="admin-mobile-empty">暂无项目</div>}
          </div>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px' }}>名称</th>
                <th style={{ padding: '10px' }}>作者</th>
                <th style={{ padding: '10px' }}>模型</th>
                <th style={{ padding: '10px' }}>阶段</th>
                <th style={{ padding: '10px' }}>更新时间</th>
                <th style={{ padding: '10px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>{row.name}</td>
                  <td style={{ padding: '10px' }}>{row.author || '—'}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{row.model_name || '—'}</td>
                  <td style={{ padding: '10px' }}>{row.step}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{formatTime(row.updated_at)}</td>
                  <td style={{ padding: '10px' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', color: 'var(--error, #dc2626)' }}
                      disabled={busyId === `project-${row.id}`}
                      onClick={() => handleDeleteProject(row)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>暂无项目</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        {!loading && activeTab === 'reports' && (
        <div className="admin-table-shell admin-table-shell--reports" style={{ overflowX: 'auto' }}>
          <div className="admin-mobile-card-list">
            {reports.map((row) => (
              <article key={row.id} className="admin-mobile-row-card">
                <div className="admin-mobile-row-head">
                  <strong>{row.model_name || `#${row.model_id}`}</strong>
                  <span>{row.status}</span>
                </div>
                <dl>
                  <div><dt>举报人</dt><dd>{row.reporter || `#${row.reporter_id}`}</dd></div>
                  <div><dt>原因</dt><dd>{row.reason}</dd></div>
                  <div><dt>说明</dt><dd>{row.details || '—'}</dd></div>
                  <div><dt>提交时间</dt><dd>{row.created_at ? formatTime(row.created_at) : '—'}</dd></div>
                </dl>
                <div className="admin-mobile-row-actions">
                  <button className="btn btn-secondary" disabled={busyId === `report-${row.id}` || row.status === 'reviewed'} onClick={() => handleReportStatus(row, 'reviewed')}>已查看</button>
                  <button className="btn btn-secondary" disabled={busyId === `report-${row.id}` || row.status === 'resolved'} onClick={() => handleReportStatus(row, 'resolved')}>已处理</button>
                  <button className="btn btn-secondary" disabled={busyId === `report-${row.id}` || row.status === 'dismissed'} onClick={() => handleReportStatus(row, 'dismissed')}>驳回</button>
                </div>
              </article>
            ))}
            {reports.length === 0 && <div className="admin-mobile-empty">暂无举报</div>}
          </div>
          <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px' }}>模型</th>
                <th style={{ padding: '10px' }}>举报人</th>
                <th style={{ padding: '10px' }}>原因</th>
                <th style={{ padding: '10px' }}>说明</th>
                <th style={{ padding: '10px' }}>状态</th>
                <th style={{ padding: '10px' }}>提交时间</th>
                <th style={{ padding: '10px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px' }}>{row.model_name || `#${row.model_id}`}</td>
                  <td style={{ padding: '10px' }}>{row.reporter || `#${row.reporter_id}`}</td>
                  <td style={{ padding: '10px' }}>{row.reason}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)', maxWidth: 280 }}>{row.details || '—'}</td>
                  <td style={{ padding: '10px' }}>{row.status}</td>
                  <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>{row.created_at ? formatTime(row.created_at) : '—'}</td>
                  <td style={{ padding: '10px' }}>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem' }}
                        disabled={busyId === `report-${row.id}` || row.status === 'reviewed'}
                        onClick={() => handleReportStatus(row, 'reviewed')}
                      >
                        已查看
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', color: 'var(--success, #16a34a)' }}
                        disabled={busyId === `report-${row.id}` || row.status === 'resolved'}
                        onClick={() => handleReportStatus(row, 'resolved')}
                      >
                        已处理
                      </button>
                      <button
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}
                        disabled={busyId === `report-${row.id}` || row.status === 'dismissed'}
                        onClick={() => handleReportStatus(row, 'dismissed')}
                      >
                        驳回
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {reports.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>暂无举报</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
};

export default Admin;
