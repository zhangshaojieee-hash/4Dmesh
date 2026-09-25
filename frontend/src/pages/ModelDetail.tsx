import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  getModel,
  likeModel,
  deleteModel,
  updateModel,
  getModelDownloadUrl,
  getModelFileUrl,
  getThumbnailUrl,
  getModelComments,
  createComment,
  deleteComment,
  getModelVersions,
  uploadModelVersion,
  toggleFollow,
  getFollowStatus,
  toggleFavorite,
  getFavoriteStatus,
  createModelReport,
  createPrintFeedback,
  getPrintFeedback,
  type ModelData,
  type CommentData,
  type FollowStatusData,
  type FavoriteStatusData,
  type PrintFeedbackData,
} from '../services/api';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/toast';

const ModelPreview = React.lazy(() => import('../components/ModelViewer'));

const ModelPreviewFallback: React.FC = () => (
  <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
    <div className="loading-spinner" />
    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>正在加载模型预览...</div>
  </div>
);

/* ══════════════════════════════════════════
   Constants
   ══════════════════════════════════════════ */

const EDIT_CATEGORIES = [
  { key: 'home', label: '家用' },
  { key: 'toy', label: '玩具游戏' },
  { key: 'tool', label: '工具配件' },
  { key: 'art', label: '艺术装饰' },
  { key: '3dprint', label: '3D打印' },
  { key: 'miniature', label: '微缩模型' },
  { key: 'cosplay', label: '角色道具' },
  { key: 'education', label: '教育套件' },
  { key: 'other', label: '其他' },
];

const CATEGORY_LABELS: Record<string, string> = {};
EDIT_CATEGORIES.forEach(c => { CATEGORY_LABELS[c.key] = c.label; });

type CommunityTab = 'details' | 'comments' | 'feedback' | 'remixes' | 'versions';
type ModelDetailMobilePanel = 'info' | 'community' | null;

/* ══════════════════════════════════════════
   Inline SVG Icons (no external deps)
   ══════════════════════════════════════════ */

const svgBase = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const IconDownload = () => <svg {...svgBase}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const IconHeart = ({ filled }: { filled?: boolean }) => filled
  ? <svg {...svgBase} fill="var(--primary)" stroke="var(--primary)"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
  : <svg {...svgBase}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>;
const IconStar = ({ filled }: { filled?: boolean }) => filled
  ? <svg {...svgBase} fill="var(--primary)" stroke="var(--primary)"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
  : <svg {...svgBase}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>;
const IconShare = () => <svg {...svgBase}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>;
const IconCode = () => <svg {...svgBase}><path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/></svg>;
const IconMaximize = () => <svg {...svgBase}><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const IconRefresh = () => <svg {...svgBase}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
const IconMessageCircle = () => <svg {...svgBase}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>;
const IconPrinter = () => <svg {...svgBase}><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;
const IconGitBranch = () => <svg {...svgBase}><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>;
const IconClock = () => <svg {...svgBase}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const IconFlag = () => <svg {...svgBase}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>;
const IconEdit = () => <svg {...svgBase}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IconTrash = () => <svg {...svgBase}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
const IconUpload = () => <svg {...svgBase}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>;
const IconCopy = () => <svg {...svgBase}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>;
const IconFileText = () => <svg {...svgBase}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>;

/* ══════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════ */

const formatDate = (dateStr: string) => {
  try {
    return new Date(dateStr).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return dateStr; }
};

const formatDateTime = (dateStr: string | null) => {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return dateStr; }
};

const timeAgo = (dateStr: string | null): string => {
  if (!dateStr) return '—';
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    return formatDate(dateStr);
  } catch { return '—'; }
};

/* ── Shared card / section styles ── */
const sideCardStyle: React.CSSProperties = {
  background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)',
  boxShadow: 'var(--shadow-xs)', marginBottom: '16px', overflow: 'hidden',
};
const sideCardHeaderStyle: React.CSSProperties = {
  padding: '14px 20px 0', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)',
};
const sideCardBodyStyle: React.CSSProperties = { padding: '14px 20px 18px' };
const infoRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0',
  fontSize: '0.85rem', borderBottom: '1px solid var(--border-light)',
};
const emptyStateStyle: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px dashed var(--border-medium)', borderRadius: 'var(--radius-lg)',
  minHeight: '220px', maxHeight: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: '14px', padding: '32px',
};
const emptyIconStyle: React.CSSProperties = { color: 'var(--text-tertiary)', opacity: 0.6 };
const emptyTitleStyle: React.CSSProperties = { margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center' };
const emptyDescStyle: React.CSSProperties = { margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)', textAlign: 'center' };

/* ── Modals ── */
type ReportModalProps = { isOpen: boolean; onClose: () => void; onSubmit: (reason: string, details: string) => void; };
const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [reason, setReason] = useState('垃圾广告');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (!isOpen) return null;
  const handleSubmit = async () => { setSubmitting(true); await new Promise(r => setTimeout(r, 800)); setSubmitting(false); onSubmit(reason, details); };
  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content animate-dropdown-in" onClick={e => e.stopPropagation()} style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '400px', maxWidth: '90%' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1.2rem' }}>举报内容</h3>
        <div style={{ marginBottom: '16px' }}><label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>举报原因</label><select value={reason} onChange={e => setReason(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-medium)' }}><option value="垃圾广告">垃圾广告</option><option value="违规内容">违规内容</option><option value="侵权抄袭">侵权抄袭</option><option value="其他">其他</option></select></div>
        <div style={{ marginBottom: '20px' }}><label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>详细描述（可选）</label><textarea value={details} onChange={e => setDetails(e.target.value)} rows={4} placeholder="请提供更多细节以便我们更快处理..." style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-medium)', resize: 'vertical' }} /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}><button className="btn btn-secondary" onClick={onClose} disabled={submitting}>取消</button><button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>{submitting ? '提交中...' : '提交举报'}</button></div>
      </div>
    </div>
  );
};

type FeedbackModalProps = { isOpen: boolean; onClose: () => void; onSubmit: (rating: number, comment: string) => void; };
const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose, onSubmit }) => {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  if (!isOpen) return null;
  const handleSubmit = async () => { setSubmitting(true); await new Promise(r => setTimeout(r, 1000)); setSubmitting(false); onSubmit(rating, comment); };
  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-content animate-dropdown-in" onClick={e => e.stopPropagation()} style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '480px', maxWidth: '90%' }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1.2rem' }}>分享打印反馈</h3><p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>您的反馈将帮助作者优化模型，并为其他创客提供参考。</p>
        <div style={{ marginBottom: '16px' }}><label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>打印成功率 / 质量打分</label><div style={{ display: 'flex', gap: '8px' }}>{[1, 2, 3, 4, 5].map(star => (<svg key={star} onClick={() => setRating(star)} width="32" height="32" viewBox="0 0 24 24" fill={star <= rating ? "#F59E0B" : "none"} stroke={star <= rating ? "#F59E0B" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>))}</div></div>
        <div style={{ marginBottom: '20px' }}><label style={{ display: 'block', marginBottom: '8px', fontWeight: 600 }}>打印配置 & 经验分享</label><textarea value={comment} onChange={e => setComment(e.target.value)} rows={5} placeholder="例如：使用 PLA 耗材，0.2mm 层高，需要支撑。打印得很完美！" style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-medium)', resize: 'vertical' }} /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}><button className="btn btn-secondary" onClick={onClose} disabled={submitting}>取消</button><button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || !comment.trim()}>{submitting ? '提交中...' : '发布反馈'}</button></div>
      </div>
    </div>
  );
};

/* ══════════════════════════════════════════
   Component
   ══════════════════════════════════════════ */

const ModelDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const { showToast } = useToast();

  /* ── State ── */
  const [model, setModel] = useState<ModelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liked, setLiked] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('other');
  const [comments, setComments] = useState<CommentData[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [commentContent, setCommentContent] = useState('');
  const [versions, setVersions] = useState<ModelData[]>([]);
  const [followStatus, setFollowStatus] = useState<FollowStatusData | null>(null);
  const [favStatus, setFavStatus] = useState<FavoriteStatusData | null>(null);
  const [activeTab, setActiveTab] = useState<CommunityTab>('details');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedback, setFeedback] = useState<PrintFeedbackData[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<ModelDetailMobilePanel>(null);

  /* ── Data Loading ── */
  const loadModel = useCallback(async (modelId: number) => {
    try {
      setLoading(true);
      const data = await getModel(modelId);
      setModel(data);
      if (data.liked_by_current_user !== undefined) setLiked(data.liked_by_current_user);
      getModelVersions(data.id).then(setVersions).catch(() => {});
      if (user && data.user_id !== user.id) getFollowStatus(data.user_id).then(setFollowStatus).catch(() => {});
      if (user) getFavoriteStatus(data.id).then(setFavStatus).catch(() => {});
    } catch { setError('模型不存在或加载失败'); }
    finally { setLoading(false); }
  }, [user]);

  const loadComments = useCallback(async (modelId: number) => {
    try {
      setCommentsLoading(true);
      const data = await getModelComments(modelId, { limit: 50 });
      setComments(data.comments);
    } catch { showToast('评论加载失败', 'error'); }
    finally { setCommentsLoading(false); }
  }, [showToast]);

  const loadFeedback = useCallback(async (modelId: number) => {
    try {
      setFeedbackLoading(true);
      const data = await getPrintFeedback(modelId, { limit: 50 });
      setFeedback(data.feedback);
    } catch {
      showToast('打印反馈加载失败', 'error');
    } finally {
      setFeedbackLoading(false);
    }
  }, [showToast]);

  useEffect(() => { if (id) loadModel(parseInt(id)); }, [id, loadModel]);
  useEffect(() => { if (id) loadComments(parseInt(id)); }, [id, loadComments]);
  useEffect(() => { if (id) loadFeedback(parseInt(id)); }, [id, loadFeedback]);
  useEffect(() => {
    const tab = searchParams.get('tab') as CommunityTab | null;
    if (tab && ['details', 'comments', 'feedback', 'remixes', 'versions'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);
  useEffect(() => {
    document.body.classList.toggle('model-detail-mobile-panel-open', mobilePanel !== null);
    return () => document.body.classList.remove('model-detail-mobile-panel-open');
  }, [mobilePanel]);

  /* ── Handlers ── */
  const handleLike = async () => {
    if (!model) return;
    try {
      const result = await likeModel(model.id);
      setModel({ ...model, likes: result.likes });
      setLiked(result.liked);
      showToast(result.liked ? '已点赞' : '已取消点赞', 'success');
    } catch { showToast('请先登录后再操作', 'error'); }
  };

  const handleDownload = () => {
    if (!model) return;
    window.open(getModelDownloadUrl(model.file_path), '_blank');
    setModel({ ...model, downloads: model.downloads + 1 });
    showToast('开始下载', 'success');
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      showToast('链接已复制到剪贴板', 'success');
    }).catch(() => {
      showToast('复制链接失败', 'error');
    });
  };

  const handleReport = () => setShowReportModal(true);
  const submitReport = async (reason: string, details: string) => {
    if (!model) return;
    try {
      await createModelReport(model.id, { reason, details: details.trim() || null });
      setShowReportModal(false);
      showToast('举报已提交，管理员会尽快处理', 'success');
    } catch {
      showToast('举报提交失败', 'error');
    }
  };
  
  const submitFeedback = async (rating: number, comment: string) => {
    if (!model) return;
    try {
      const historyId = Number(searchParams.get('history'));
      await createPrintFeedback(model.id, {
        rating,
        content: comment,
        print_history_id: Number.isFinite(historyId) && historyId > 0 ? historyId : null,
      });
      setShowFeedbackModal(false);
      showToast('打印反馈已发布', 'success');
      setActiveTab('feedback');
      setSearchParams({ tab: 'feedback' });
      await loadFeedback(model.id);
      await loadModel(model.id);
    } catch {
      showToast('反馈发布失败', 'error');
    }
  };

  const handleToggleFavorite = async () => {
    if (!model || !user) { showToast('请先登录', 'error'); return; }
    try {
      const res = await toggleFavorite(model.id);
      setFavStatus({ is_favorited: res.favorited, favorites_count: res.favorites_count });
      showToast(res.favorited ? '已加入收藏夹' : '已取消收藏', 'success');
    } catch { showToast('操作失败', 'error'); }
  };

  const handleToggleFollow = async () => {
    if (!model || !user) { showToast('请先登录', 'error'); return; }
    try {
      const res = await toggleFollow(model.user_id);
      setFollowStatus({ is_followed: res.followed, followers_count: res.followers_count, following_count: res.following_count });
      showToast(res.followed ? '已关注' : '已取消关注', 'success');
    } catch { showToast('操作失败', 'error'); }
  };

  const handleDelete = () => setShowDeleteConfirm(true);
  const confirmDelete = async () => {
    if (!model) return;
    try { await deleteModel(model.id); showToast('模型已删除', 'success'); navigate('/models'); }
    catch { showToast('删除失败', 'error'); }
    finally { setShowDeleteConfirm(false); }
  };

  const handleStartEdit = () => {
    if (!model) return;
    setEditName(model.name || ''); setEditDescription(model.description || ''); setEditCategory(model.category || 'other');
    setIsEditing(true);
  };
  const handleCancelEdit = () => { if (!model) return; setEditName(model.name || ''); setEditDescription(model.description || ''); setEditCategory(model.category || 'other'); setIsEditing(false); };
  const handleSaveEdit = async () => {
    if (!model) return;
    const trimmedName = editName.trim();
    if (!trimmedName) { showToast('名称不能为空', 'error'); return; }
    try { setSaving(true); await updateModel(model.id, trimmedName, editDescription, editCategory); await loadModel(model.id); setIsEditing(false); showToast('模型信息已更新', 'success'); }
    catch { showToast('保存失败', 'error'); }
    finally { setSaving(false); }
  };

  const handleSubmitComment = async () => {
    if (!model) return;
    const content = commentContent.trim();
    if (!content) { showToast('请输入评论内容', 'error'); return; }
    try { setCommentSubmitting(true); const nc = await createComment(model.id, content); setComments(prev => [nc, ...prev]); setCommentContent(''); showToast('评论成功', 'success'); }
    catch { showToast('评论失败', 'error'); }
    finally { setCommentSubmitting(false); }
  };

  const handleDeleteComment = async (commentId: number) => {
    try { await deleteComment(commentId); setComments(prev => prev.filter(c => c.id !== commentId)); showToast('评论已删除', 'success'); }
    catch { showToast('删除评论失败', 'error'); }
  };

  /* ── Loading / Error states ── */
  if (loading) {
    return (
      <div className="model-detail-page page-enter">
        <div className="route-shell__rail route-shell__rail--wide model-detail-rail">
          <div className="model-detail-state-panel"><div className="loading-spinner" /></div>
        </div>
      </div>
    );
  }
  if (error || !model) {
    return (
      <div className="model-detail-page page-enter">
        <div className="route-shell__rail route-shell__rail--wide model-detail-rail">
          <div className="model-detail-state-panel">
            <div style={{ fontSize: '3rem', marginBottom: '16px', color: 'var(--text-tertiary)' }}>404</div>
            <p style={{ color: 'var(--text-tertiary)', marginBottom: '16px' }}>{error || '模型不存在'}</p>
            <Link to="/models" className="btn btn-primary">返回模型库</Link>
          </div>
        </div>
      </div>
    );
  }

  const isOwner = user && model.user_id === user.id;
  const modelFileUrl = getModelFileUrl(model.file_path);
  const is3DModel = /\.(glb|gltf|3mf|stl|obj|step)$/i.test(model.file_path || '');
  const fileFormat = model.file_path?.split('.').pop()?.toUpperCase() || '—';
  const categoryLabel = CATEGORY_LABELS[model.category] || model.category || '—';
  const favCount = favStatus?.favorites_count ?? 0;
  const isFav = favStatus?.is_favorited ?? false;

  /* ── Community tabs config ── */
  const tabs: { key: CommunityTab; label: string; count?: number }[] = [
    { key: 'details', label: '作品详情' },
    { key: 'comments', label: '评论讨论', count: comments.length },
    { key: 'feedback', label: '打印反馈', count: feedback.length },
    { key: 'remixes', label: '二创作品' },
    { key: 'versions', label: '版本记录', count: versions.length },
  ];

  const switchCommunityTab = (tab: CommunityTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  /* ══════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════ */
  return (
    <div className={`model-detail-page page-enter ${mobilePanel ? `mobile-panel-${mobilePanel}` : ''}`}>
      <div className="route-shell__rail route-shell__rail--wide model-detail-rail">
        {mobilePanel && (
          <button
            type="button"
            className="mobile-panel-backdrop model-detail-mobile-backdrop"
            aria-label="关闭移动端模型详情面板"
            onClick={() => setMobilePanel(null)}
          />
        )}

        {/* ═══════ 1. Title Bar ═══════ */}
        <div className="model-detail-title-bar" style={{
          background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)',
          boxShadow: 'var(--shadow-xs)', padding: '16px 24px', marginBottom: '20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap',
        }}>
          {/* Left: meta */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            {/* Author avatar mini */}
            <div style={{
              width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, var(--primary-light) 0%, var(--primary) 100%)',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.9rem',
            }}>
              {(model.author?.[0] || 'U').toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '400px' }}>
                  {model.name}
                </h1>
                <span style={{ padding: '2px 10px', borderRadius: '999px', background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: '0.7rem', fontWeight: 700 }}>
                  {fileFormat}
                </span>
                <span style={{ padding: '2px 10px', borderRadius: '999px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '0.7rem', fontWeight: 600 }}>
                  {categoryLabel}
                </span>
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: '2px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span>{model.author || '—'}</span>
                <span>·</span>
                <span>{model.created_at ? timeAgo(model.created_at) : '—'}</span>
              </div>
            </div>
          </div>

          {/* Right: actions */}
          <div className="model-detail-title-actions" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
            <button className="btn btn-primary" onClick={handleDownload} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', fontSize: '0.85rem' }}>
              <IconDownload /> 下载
            </button>
            <button className={`btn ${isFav ? 'btn-primary' : 'btn-secondary'}`} onClick={handleToggleFavorite} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', fontSize: '0.85rem', ...(isFav ? { background: 'var(--primary-soft)', color: 'var(--primary)', border: '1.5px solid var(--primary)' } : {}) }}>
              <IconStar filled={isFav} /> {isFav ? '已收藏' : '收藏'} {favCount > 0 && <span style={{ fontSize: '0.75rem' }}>({favCount})</span>}
            </button>
            <button className={`btn ${liked ? 'btn-primary' : 'btn-secondary'}`} onClick={handleLike} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', fontSize: '0.85rem', ...(liked ? { background: 'var(--primary-soft)', color: 'var(--primary)', border: '1.5px solid var(--primary)' } : {}) }}>
              <IconHeart filled={liked} /> {model.likes}
            </button>
            <button className="btn btn-secondary" onClick={handleShare} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', fontSize: '0.85rem' }}>
              <IconShare /> 分享
            </button>
            <button className="btn btn-secondary" onClick={() => navigate(`/editor?importModel=${encodeURIComponent(modelFileUrl)}&modelId=${model.id}&modelName=${encodeURIComponent(model.name)}`)} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 14px', fontSize: '0.85rem' }}>
              <IconCode /> G-code
            </button>
            {isOwner && (
              <>
                <button className="btn btn-secondary" onClick={handleStartEdit} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', fontSize: '0.85rem' }}><IconEdit /> 编辑</button>
                <button className="btn btn-secondary" onClick={handleDelete} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '7px 12px', fontSize: '0.85rem', color: 'var(--error, #dc2626)' }}><IconTrash /> 删除</button>
              </>
            )}
          </div>
        </div>

        <div className="model-detail-mobile-command-bar" aria-label="模型详情移动操作栏">
          <button type="button" onClick={handleDownload}>下载</button>
          <button type="button" onClick={() => navigate(`/editor?importModel=${encodeURIComponent(modelFileUrl)}&modelId=${model.id}&modelName=${encodeURIComponent(model.name)}`)}>G-code</button>
          <button type="button" onClick={handleToggleFavorite}>{isFav ? '已收藏' : '收藏'}</button>
          <button type="button" onClick={() => setMobilePanel('info')}>信息</button>
          <button type="button" onClick={() => setMobilePanel('community')}>讨论</button>
        </div>

        {/* ═══════ 2 + 3. Main Grid: 3D Preview + Sidebar ═══════ */}
        <div className="model-detail-grid">
          {/* 3D Preview */}
          <div className="model-detail-preview" style={{ position: 'relative' }}>
            {/* Edit panel (overlays preview when editing) */}
            {isEditing && (
              <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-sm)', padding: '24px', marginBottom: '16px' }}>
                <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontWeight: 700 }}>编辑模型信息</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>模型名称</label>
                    <input type="text" className="form-input" value={editName} onChange={e => setEditName(e.target.value)} disabled={saving} style={{ width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>模型描述</label>
                    <textarea className="form-input" value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={4} disabled={saving} style={{ resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>分类</label>
                    <select className="form-input" value={editCategory} onChange={e => setEditCategory(e.target.value)} disabled={saving} style={{ width: '100%', boxSizing: 'border-box' }}>
                      {EDIT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving}>{saving ? '保存中...' : '保存'}</button>
                    <button className="btn btn-secondary" onClick={handleCancelEdit} disabled={saving}>取消</button>
                  </div>
                </div>
              </div>
            )}

            {/* 3D Viewer */}
            <div className="model-detail-viewer-shell" style={{
              background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)',
              boxShadow: 'var(--shadow-xs)', overflow: 'hidden', position: 'relative',
              ...(isFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, borderRadius: 0 } : {}),
            }}>
              <div className="model-detail-viewer-stage" style={{ height: isFullscreen ? '100vh' : '60vh', minHeight: isFullscreen ? undefined : '560px', maxHeight: isFullscreen ? undefined : '680px', background: '#F8F9FA', position: 'relative' }}>
                {is3DModel ? (
                  <React.Suspense fallback={<ModelPreviewFallback />}>
                    <ModelPreview url={modelFileUrl} />
                  </React.Suspense>
                ) : model.thumbnail_path ? (
                  <img src={getThumbnailUrl(model.thumbnail_path)} alt={model.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '3rem', color: 'var(--text-tertiary)', fontWeight: 800, opacity: 0.3 }}>3D</div>
                )}
                {/* Toolbar overlay */}
                <div style={{ position: 'absolute', top: '12px', right: '12px', display: 'flex', gap: '6px', zIndex: 10 }}>
                  <button onClick={() => { /* reset handled by viewer */ showToast('视角已重置', 'info'); }} style={{
                    width: '34px', height: '34px', borderRadius: '8px', border: '1px solid var(--border-light)',
                    background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', transition: 'all 0.2s',
                  }} title="重置视角"><IconRefresh /></button>
                  <button onClick={() => setIsFullscreen(f => !f)} style={{
                    width: '34px', height: '34px', borderRadius: '8px', border: '1px solid var(--border-light)',
                    background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', transition: 'all 0.2s',
                  }} title={isFullscreen ? '退出全屏' : '全屏'}><IconMaximize /></button>
                </div>
                {/* Bottom hint */}
                {!isFullscreen && (
                  <div style={{ position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.45)', color: '#fff', padding: '4px 14px', borderRadius: '999px', fontSize: '0.7rem', pointerEvents: 'none' }}>
                    拖拽旋转 · 滚轮缩放 · 右键平移
                  </div>
                )}
                {isFullscreen && (
                  <button onClick={() => setIsFullscreen(false)} style={{ position: 'absolute', top: '16px', left: '16px', padding: '8px 20px', borderRadius: '8px', border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, cursor: 'pointer', zIndex: 10 }}>退出全屏</button>
                )}
              </div>
            </div>
          </div>

          {/* ═══════ Right Sidebar ═══════ */}
          <div className="model-detail-sidebar" style={{ display: 'flex', flexDirection: 'column', gap: '0', position: 'sticky', top: '90px', paddingBottom: '24px' }}>
            <div className="mobile-panel-head model-detail-mobile-info-head">
              <div>
                <strong>模型信息</strong>
                <span>作者、数据与次级操作</span>
              </div>
              <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
            </div>

            <div className="model-detail-mobile-secondary-actions">
              <button type="button" className={`btn ${liked ? 'btn-primary' : 'btn-secondary'}`} onClick={handleLike}>
                <IconHeart filled={liked} /> {liked ? '已点赞' : `点赞 ${model.likes}`}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleShare}><IconShare /> 分享</button>
              {isOwner && (
                <>
                  <button type="button" className="btn btn-secondary" onClick={handleStartEdit}><IconEdit /> 编辑</button>
                  <button type="button" className="btn btn-secondary" onClick={handleDelete}><IconTrash /> 删除</button>
                </>
              )}
            </div>

            {/* Author Card */}
            <div style={sideCardStyle}>
              <div style={{ ...sideCardBodyStyle, display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--primary-light) 0%, var(--primary) 100%)',
                  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '1.3rem',
                }}>
                  {(model.author?.[0] || 'U').toUpperCase()}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{model.author || '—'}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)' }}>创作者{followStatus ? ` · ${followStatus.followers_count} 关注者` : ''}</div>
                </div>
                {user && model.user_id !== user.id && (
                  <button className={followStatus?.is_followed ? 'btn btn-secondary' : 'btn btn-primary'} style={{ padding: '5px 16px', fontSize: '0.8rem', flexShrink: 0 }} onClick={handleToggleFollow}>
                    {followStatus?.is_followed ? '已关注' : '关注'}
                  </button>
                )}
              </div>
              {/* Ask author */}
              <div style={{ padding: '0 20px 16px' }}>
                <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.82rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }} onClick={() => { setActiveTab('comments'); setTimeout(() => document.getElementById('comment-input')?.focus(), 200); }}>
                  <IconMessageCircle /> 向作者提问
                </button>
              </div>
            </div>

            {/* Interaction Stats */}
            <div style={sideCardStyle}>
              <div style={sideCardHeaderStyle}>互动数据</div>
              <div style={{ ...sideCardBodyStyle, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', paddingTop: '12px' }}>
                {[
                  { n: model.downloads, l: '下载' },
                  { n: model.likes, l: '点赞' },
                  { n: favCount, l: '收藏' },
                ].map(s => (
                  <div key={s.l} style={{ textAlign: 'center', padding: '10px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--text-primary)' }}>{s.n}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>{s.l}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding: '0 20px 4px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {[
                  { n: comments.length, l: '评论' },
                  { n: 0, l: '打印反馈' },
                ].map(s => (
                  <div key={s.l} style={{ textAlign: 'center', padding: '10px 4px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontWeight: 800, fontSize: '1.15rem', color: 'var(--text-primary)' }}>{s.n}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>{s.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Model Info */}
            <div style={sideCardStyle}>
              <div style={sideCardHeaderStyle}>模型信息</div>
              <div style={sideCardBodyStyle}>
                {[
                  { k: '文件格式', v: fileFormat },
                  { k: '分类', v: categoryLabel },
                  { k: '模型 ID', v: `#${model.id}` },
                  { k: '版本', v: model.version_number ? `v${model.version_number}` : 'v1' },
                  { k: '更新时间', v: formatDateTime(model.created_at) },
                ].map((row, i, arr) => (
                  <div key={row.k} style={{ ...infoRowStyle, ...(i === arr.length - 1 ? { borderBottom: 'none' } : {}) }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>{row.k}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div style={sideCardStyle}>
              <div style={sideCardHeaderStyle}>标签</div>
              <div style={{ ...sideCardBodyStyle, display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {model.category ? (
                  <>
                    <span style={{ padding: '4px 14px', borderRadius: '999px', background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: '0.78rem', fontWeight: 600 }}>{categoryLabel}</span>
                    <span style={{ padding: '4px 14px', borderRadius: '999px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 600 }}>{fileFormat}</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>暂无标签</span>
                )}
              </div>
            </div>

            {/* Report */}
            <button onClick={handleReport} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', width: '100%', padding: '10px', border: 'none', background: 'transparent', color: 'var(--text-tertiary)', fontSize: '0.78rem', cursor: 'pointer' }}>
              <IconFlag /> 举报内容
            </button>
          </div>
        </div>

        {/* ═══════ 4. Community Tabs ═══════ */}
        <div className="model-detail-tabs" style={{ marginTop: '24px' }}>
          <div className="mobile-panel-head model-detail-mobile-community-head">
            <div>
              <strong>社区内容</strong>
              <span>详情、评论、反馈与版本记录</span>
            </div>
            <button type="button" onClick={() => setMobilePanel(null)}>关闭</button>
          </div>
          {/* Tab Bar */}
          <div className="model-detail-community-tabbar" style={{ display: 'flex', gap: '4px', borderBottom: '2px solid var(--border-light)', marginBottom: '20px' }}>
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => switchCommunityTab(tab.key)} style={{
                padding: '10px 20px', border: 'none', borderBottom: '2px solid transparent', marginBottom: '-2px',
                background: 'transparent', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 600, transition: 'all 0.2s',
                color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-tertiary)',
                borderBottomColor: activeTab === tab.key ? 'var(--primary)' : 'transparent',
              }}>
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span style={{ marginLeft: '6px', padding: '1px 7px', borderRadius: '999px', background: activeTab === tab.key ? 'var(--primary-soft)' : 'var(--bg-secondary)', fontSize: '0.72rem' }}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab: Details */}
          {activeTab === 'details' && (
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)', padding: '28px 32px' }}>
              {model.description ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  <div>
                    <h3 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>模型说明</h3>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap', fontSize: '0.92rem' }}>{model.description}</p>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '20px' }}>
                    <h3 style={{ margin: '0 0 10px', fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>使用与授权</h3>
                    <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: '0.85rem', lineHeight: 1.6 }}>
                      此模型可自由下载用于个人和非商业用途。如需商业使用，请联系作者获取授权。
                    </p>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px', gap: '12px' }}>
                  <div style={emptyIconStyle}><IconFileText /></div>
                  <p style={emptyTitleStyle}>作者暂未填写模型说明</p>
                  <p style={emptyDescStyle}>你可以在评论区向作者询问更多信息</p>
                  <button className="btn btn-secondary" onClick={() => { setActiveTab('comments'); setTimeout(() => document.getElementById('comment-input')?.focus(), 200); }} style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                    向作者提问
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tab: Comments */}
          {activeTab === 'comments' && (
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)', padding: '24px 28px' }}>
              {/* Comment input */}
              {isAuthenticated ? (
                <div style={{ marginBottom: '24px' }}>
                  <textarea
                    id="comment-input"
                    className="form-input form-textarea"
                    rows={3}
                    placeholder="向作者提问，或分享你的使用建议..."
                    value={commentContent}
                    onChange={e => setCommentContent(e.target.value)}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                    <button className="btn btn-primary" onClick={handleSubmitComment} disabled={commentSubmitting} style={{ fontSize: '0.85rem' }}>
                      {commentSubmitting ? '发布中...' : '发表评论'}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '14px 18px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', marginBottom: '24px', color: 'var(--text-tertiary)', fontSize: '0.88rem' }}>
                  <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 600 }}>登录</Link> 后可以发表评论
                </div>
              )}

              {/* Comment list */}
              {commentsLoading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}><div className="loading-spinner" /></div>
              ) : comments.length === 0 ? (
                <div style={emptyStateStyle}>
                  <div style={emptyIconStyle}><IconMessageCircle /></div>
                  <p style={emptyTitleStyle}>暂无评论，成为第一个向作者提问的人</p>
                  <p style={emptyDescStyle}>分享你的打印体验或提出改进建议</p>
                  {isAuthenticated && (
                    <button className="btn btn-primary" onClick={() => document.getElementById('comment-input')?.focus()} style={{ fontSize: '0.85rem' }}>发表评论</button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {comments.map(comment => {
                    const isAuthorComment = comment.user_id === model.user_id;
                    return (
                      <div key={comment.id} style={{
                        border: `1px solid ${isAuthorComment ? 'var(--primary-light)' : 'var(--border-light)'}`,
                        borderRadius: 'var(--radius-md)', padding: '16px 18px',
                        background: isAuthorComment ? 'var(--primary-soft)' : 'var(--bg-card)',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                          <div style={{ display: 'flex', gap: '12px', minWidth: 0 }}>
                            <div style={{
                              width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                              background: isAuthorComment ? 'var(--primary)' : 'linear-gradient(135deg, #7BC9A6 0%, #A3D9C2 100%)',
                              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                            }}>
                              {(comment.username?.[0] || 'U').toUpperCase()}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{comment.username}</span>
                                {isAuthorComment && (
                                  <span style={{ padding: '1px 8px', borderRadius: '999px', background: 'var(--primary)', color: '#fff', fontSize: '0.65rem', fontWeight: 700 }}>作者</span>
                                )}
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{timeAgo(comment.created_at)}</span>
                              </div>
                              <div style={{ color: 'var(--text-primary)', lineHeight: 1.6, marginTop: '6px', whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
                                {comment.content}
                              </div>
                            </div>
                          </div>
                          {user && user.id === comment.user_id && (
                            <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteComment(comment.id)} style={{ color: 'var(--error, #dc2626)', alignSelf: 'flex-start', padding: '4px 8px', fontSize: '0.78rem' }}>
                              删除
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab: Print Feedback */}
          {activeTab === 'feedback' && (
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)', padding: '24px 28px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>打印反馈</h3>
                  <p style={{ margin: '4px 0 0', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>来自真实打印记录的评分与经验</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowFeedbackModal(true)} style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconUpload /> 发布反馈
                </button>
              </div>
              {feedbackLoading ? (
                <div style={{ padding: '40px', textAlign: 'center' }}><div className="loading-spinner" /></div>
              ) : feedback.length === 0 ? (
                <div style={emptyStateStyle}>
                  <div style={emptyIconStyle}><IconPrinter /></div>
                  <p style={emptyTitleStyle}>还没有用户分享打印反馈</p>
                  <p style={emptyDescStyle}>分享你的 4D 打印成品、材料和参数，帮助其他用户判断可打印性</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {feedback.map(item => (
                    <div key={item.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '16px 18px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                        <strong>{item.username}</strong>
                        <span style={{ color: '#F59E0B', fontWeight: 700 }}>{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</span>
                      </div>
                      <p style={{ margin: 0, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{item.content}</p>
                      <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', color: 'var(--text-tertiary)', fontSize: '0.78rem' }}>
                        {item.printer_model && <span>设备: {item.printer_model}</span>}
                        {item.material && <span>材料: {item.material}</span>}
                        {item.gcode_filename && <span>G-code: {item.gcode_filename}</span>}
                        <span>{formatDateTime(item.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab: Remixes */}
          {activeTab === 'remixes' && (
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)', padding: '24px 28px' }}>
              <div style={emptyStateStyle}>
                <div style={emptyIconStyle}><IconGitBranch /></div>
                <p style={emptyTitleStyle}>暂无二创作品</p>
                <p style={emptyDescStyle}>基于此模型改造或创作你的版本，分享到社区</p>
                <button className="btn btn-primary" onClick={() => navigate(`/ai?importModel=${encodeURIComponent(modelFileUrl)}`)} style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconCopy /> 基于此模型二创
                </button>
              </div>
            </div>
          )}

          {/* Tab: Versions */}
          {activeTab === 'versions' && (
            <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-xs)', padding: '24px 28px' }}>
              {versions.length === 0 ? (
                <div style={emptyStateStyle}>
                  <div style={emptyIconStyle}><IconClock /></div>
                  <p style={emptyTitleStyle}>暂无版本记录</p>
                  <p style={emptyDescStyle}>模型更新历史将在此展示</p>
                  {isOwner && (
                    <button className="btn btn-primary" onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file'; input.accept = '.glb,.gltf,.obj,.stl,.3mf,.step';
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file || !model) return;
                        try { await uploadModelVersion(model.parent_model_id || model.id, file, model.name, model.description, model.category); window.location.reload(); }
                        catch { showToast('上传失败', 'error'); }
                      };
                      input.click();
                    }} style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <IconUpload /> 上传新版本
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {versions.map((v, i) => (
                    <div key={v.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '16px 0',
                      borderBottom: i < versions.length - 1 ? '1px solid var(--border-light)' : 'none',
                    }}>
                      {/* Timeline dot */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', paddingTop: '4px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: v.id === model.id ? 'var(--primary)' : 'var(--border-medium)', flexShrink: 0 }} />
                        {i < versions.length - 1 && <div style={{ width: '2px', flex: 1, minHeight: '24px', background: 'var(--border-light)' }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: v.id === model.id ? 'var(--primary)' : 'var(--text-primary)' }}>
                            v{v.version_number || i + 1}
                          </span>
                          {v.id === model.id && <span style={{ padding: '1px 8px', borderRadius: '999px', background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: '0.68rem', fontWeight: 700 }}>当前版本</span>}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                          {formatDate(v.created_at)}
                        </div>
                      </div>
                      {v.id !== model.id && (
                        <button className="btn btn-secondary" onClick={() => navigate(`/models/${v.id}`)} style={{ fontSize: '0.8rem', padding: '4px 14px', flexShrink: 0 }}>查看</button>
                      )}
                    </div>
                  ))}
                  {isOwner && (
                    <div style={{ paddingTop: '16px' }}>
                      <button className="btn btn-secondary" style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file'; input.accept = '.glb,.gltf,.obj,.stl,.3mf,.step';
                        input.onchange = async (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (!file || !model) return;
                          try { await uploadModelVersion(model.parent_model_id || model.id, file, model.name, model.description, model.category); window.location.reload(); }
                          catch { showToast('上传失败', 'error'); }
                        };
                        input.click();
                      }}>
                        <IconUpload /> 上传新版本
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══════ Delete Confirmation Modal ═══════ */}
        {showDeleteConfirm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowDeleteConfirm(false)}>
            <div style={{ maxWidth: '420px', width: '100%', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: '28px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
              <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700 }}>确认删除</h3>
              <p style={{ color: 'var(--text-tertiary)', marginBottom: '24px', fontSize: '0.9rem' }}>
                确定要删除模型「{model?.name}」吗？此操作不可撤销。
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                <button className="btn btn-secondary" onClick={() => setShowDeleteConfirm(false)}>取消</button>
                <button className="btn" style={{ background: 'var(--error, #DC3545)', color: 'white' }} onClick={confirmDelete}>确认删除</button>
              </div>
            </div>
          </div>
        )}
        <ReportModal
          isOpen={showReportModal}
          onClose={() => setShowReportModal(false)}
          onSubmit={submitReport}
        />
        <FeedbackModal
          isOpen={showFeedbackModal}
          onClose={() => setShowFeedbackModal(false)}
          onSubmit={submitFeedback}
        />
      </div>
    </div>
  );
};

export default ModelDetail;
