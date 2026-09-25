import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { getThumbnailUrl, type ModelData } from '../services/api';
import { formatNumber } from '../utils/format';

interface ModelCardProps {
  model: ModelData;
  badge?: string;
  compact?: boolean;
  onLike?: (model: ModelData) => void;
  onFavorite?: (model: ModelData) => void;
  isFavorited?: boolean;
}

const inferFormat = (filePath?: string) => {
  const ext = filePath?.split('?')[0].split('.').pop()?.toUpperCase();
  return ext || '3D';
};

const getReadinessLabel = (format: string) => {
  if (format === '3MF') return '含配置包';
  if (['STL', 'OBJ', 'STEP'].includes(format)) return '可切片';
  if (['GLB', 'GLTF'].includes(format)) return '预览友好';
  return '模型文件';
};

const categoryLabels: Record<string, string> = {
  home: '家居生活',
  toy: '玩具游戏',
  tool: '工具配件',
  art: '艺术装饰',
  '3dprint': '打印模型',
  miniature: '微缩模型',
  cosplay: '角色道具',
  education: '教育学习',
  other: '精选模型',
};

const formatDateLabel = (value?: string) => {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${date.getMonth() + 1}.${date.getDate()}`;
};

const Icon = ({ name }: { name: 'heat' | 'heart' | 'download' | 'cube' | 'kebab' | 'eye' | 'bookmark' | 'thumbs-up' }) => {
  const common = { viewBox: '0 0 24 24', 'aria-hidden': true };
  switch (name) {
    case 'heat':
      return <svg {...common}><path d="M12 3s5 4.6 5 10a5 5 0 0 1-10 0c0-2.2 1.3-4 2.6-5.5C10.9 6 12 3 12 3Z" /></svg>;
    case 'heart':
      return <svg {...common}><path d="M20.8 8.6c0 5.5-8.8 10.3-8.8 10.3S3.2 14.1 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z" /></svg>;
    case 'download':
      return <svg {...common}><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>;
    case 'eye':
      return <svg {...common}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'bookmark':
      return <svg {...common}><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" /></svg>;
    case 'thumbs-up':
      return <svg {...common}><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>;
    default:
      return null;
  }
};

const renderStars = (ratingStr: string) => {
  const scoreVal = parseFloat(ratingStr);
  const stars = [];
  const fullStars = Math.floor(scoreVal);
  const hasHalf = scoreVal % 1 >= 0.5;
  for (let i = 1; i <= 5; i++) {
    if (i <= fullStars) {
      stars.push(<span key={i} className="star-icon full">★</span>);
    } else if (i === fullStars + 1 && hasHalf) {
      stars.push(<span key={i} className="star-icon half">★</span>);
    } else {
      stars.push(<span key={i} className="star-icon empty">★</span>);
    }
  }
  return stars;
};

const ModelCard: React.FC<ModelCardProps> = ({ model, badge, compact = false, onLike, onFavorite, isFavorited = false }) => {
  const format = inferFormat(model.file_path);
  const displayBadge = badge || categoryLabels[model.category] || format;
  const versionLabel = model.version_number ? `V${model.version_number}` : format;
  const createdLabel = formatDateLabel(model.created_at);
  const readinessLabel = getReadinessLabel(format);
  const ratingStr = typeof model.rating === 'number' ? model.rating.toFixed(1) : null;

  return (
    <article className={`market-model-card ${compact ? 'compact' : ''}`}>
      <RouterLink to={`/models/${model.id}`} className="market-model-thumb" aria-label={`预览模型 ${model.name}`}>
        {model.thumbnail_path ? (
          <img src={getThumbnailUrl(model.thumbnail_path)} alt={model.name} loading="lazy" />
        ) : (
          <div className="market-model-thumb-fallback">
            <span>{format}</span>
          </div>
        )}
        <span className="market-model-badge">{displayBadge}</span>
        <span className="market-model-format-tag">{versionLabel}</span>
        <span className="market-model-readiness">{readinessLabel}</span>
      </RouterLink>

      <div className="market-model-body">
        <div className="market-model-headline">
          <RouterLink to={`/models/${model.id}`} className="market-model-name" title={model.name}>{model.name}</RouterLink>
          {model.description && (
            <p className="market-model-desc" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '4px 0 8px', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {model.description}
            </p>
          )}
        </div>
        
        <div className="market-model-meta">
          <div className="market-model-author">
            <span className="market-model-avatar">{model.author?.[0]?.toUpperCase() || 'U'}</span>
            <span title={model.author || '未知作者'}>{model.author || '未知作者'}</span>
          </div>

          <div className="market-model-stats">
            {model.favorites ? (
              <span aria-label="收藏量" title={`收藏量: ${model.favorites || 0}`}>
                <Icon name="bookmark" />
                {formatNumber(model.favorites || 0)}
              </span>
            ) : null}
            <span aria-label="下载量" title={`下载量: ${model.downloads || 0}`}>
              <Icon name="download" />
              {formatNumber(model.downloads || 0)}
            </span>
            <span aria-label="点赞数" title={`点赞数: ${model.likes || 0}`}>
              <Icon name="thumbs-up" />
              {formatNumber(model.likes || 0)}
            </span>
          </div>
        </div>

        <div className="market-model-rating-row" aria-label={ratingStr ? `评分 ${ratingStr}` : '暂无评分'}>
          {ratingStr ? (
            <>
              <span className="market-model-stars">{renderStars(ratingStr)}</span>
              <span className="market-model-rating-val">{ratingStr}</span>
            </>
          ) : (
            <span className="market-model-rating-val">暂无评分</span>
          )}
          <span className="market-model-format-badge-inline">{createdLabel}</span>
        </div>

        <div className="market-model-actions">
          <RouterLink to={`/models/${model.id}`} className="market-model-primary-btn">
            查看详情
          </RouterLink>
          <div className="market-model-sec-btns">
            <button
              type="button"
              className={`market-model-icon-btn ${model.liked_by_current_user ? 'active' : ''}`}
              aria-label={model.liked_by_current_user ? '取消点赞' : '点赞模型'}
              aria-pressed={Boolean(model.liked_by_current_user)}
              onClick={() => onLike?.(model)}
            >
              <Icon name="thumbs-up" />
            </button>
            <button
              type="button"
              className={`market-model-icon-btn ${isFavorited ? 'active' : ''}`}
              aria-label={isFavorited ? '取消收藏' : '收藏模型'}
              aria-pressed={isFavorited}
              onClick={() => onFavorite?.(model)}
            >
              <Icon name="bookmark" />
            </button>
          </div>
        </div>

      </div>
    </article>
  );
};

export default React.memo(ModelCard);
