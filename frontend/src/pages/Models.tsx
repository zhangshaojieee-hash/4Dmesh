import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { getModels, getMyFavorites, likeModel, toggleFavorite, type ModelData } from '../services/api';
import { useAuth } from '../stores/auth';
import { useToast } from '../stores/toast';
import ModelCard from '../components/ModelCard';
import ModelPublishModal from '../components/ModelPublishModal';
import { SkeletonGrid } from '../components/Skeleton';

type ViewMode = 'grid' | 'compact';
type SortKey = 'recommended' | 'newest' | 'downloads' | 'favorites' | 'rating' | 'recent';

const PAGE_SIZE = 20;

const CATEGORIES = [
  { name: '全部', key: 'all' },
  { name: '家居生活', key: 'home' },
  { name: '工具配件', key: 'tool' },
  { name: '艺术装饰', key: 'art' },
  { name: '教育学习', key: 'education' },
  { name: '机械结构', key: '3dprint' },
  { name: '角色模型', key: 'cosplay' },
  { name: '建筑空间', key: 'miniature' },
];

const SIDE_NAV = [
  { label: '推荐', key: 'all', icon: 'spark' },
  { label: '最新上传', key: 'newest', icon: 'clock' },
  { label: '热门模型', key: 'hot', icon: 'flame' },
  { label: '高级模型', key: 'advanced', icon: 'cube' },
  { label: '我的收藏', key: 'favorites', icon: 'heart' },
] as const;

const SORT_OPTIONS: Array<{ key: SortKey; apiValue: string; label: string; icon: string }> = [
  { key: 'recommended', apiValue: 'newest', label: '综合推荐', icon: 'spark' },
  { key: 'newest', apiValue: 'newest', label: '最新', icon: 'clock' },
  { key: 'downloads', apiValue: 'most_downloaded', label: '下载量', icon: 'download' },
  { key: 'favorites', apiValue: 'most_liked', label: '收藏量', icon: 'heart' },
  { key: 'rating', apiValue: 'most_liked', label: '评分', icon: 'spark' },
  { key: 'recent', apiValue: 'newest', label: '7 天内', icon: 'clock' },
];

const HOT_SEARCHES = ['龙', '建筑', '机械臂', '桌面收纳', '史迪奇', '灯具'];

const UPLOAD_REQUIREMENTS = [
  '使用真实打印封面或清晰实物图',
  '补全标题、分类与用途描述',
  '在描述中写明标签、授权或二创来源',
  '提供打印配置、3MF 或可切片模型文件',
  '补充层高、耗材、支撑和装配说明',
];

const FILE_FORMAT_FILTERS = ['STL', 'OBJ', 'GLB', '3MF', 'STEP', 'GLTF'];

const DIFFICULTY_FILTERS = ['全部', '简单', '中等', '困难'];

const FEATURE_CHIPS = [
  { label: '全部', action: 'all' },
  { label: '新手友好', action: 'beginner' },
  { label: '可动模型', action: 'kinetic' },
  { label: '高精模型', action: 'detail' },
  { label: '免费', action: 'free' },
  { label: 'AI 生成', action: 'ai' },
  { label: '热门下载', action: 'downloads' },
] as const;

const Icon = ({ name }: { name: string }) => {
  const common = { viewBox: '0 0 24 24', 'aria-hidden': true };
  switch (name) {
    case 'home':
      return <svg {...common}><path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-9Z" /></svg>;
    case 'clock':
      return <svg {...common}><path d="M12 7v5l3 2" /><circle cx="12" cy="12" r="8" /></svg>;
    case 'flame':
      return <svg {...common}><path d="M12 3s5 4.6 5 10a5 5 0 0 1-10 0c0-2.1 1.2-3.8 2.7-5.5C10.8 6.1 12 3 12 3Z" /></svg>;
    case 'heart':
      return <svg {...common}><path d="M20.8 8.6c0 5.5-8.8 10.3-8.8 10.3S3.2 14.1 3.2 8.6A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.8 1.9Z" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4.4-4.4" /></svg>;
    case 'download':
      return <svg {...common}><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>;
    case 'spark':
      return <svg {...common}><path d="m12 3 1.6 5 5 1.4-5 1.6-1.6 5-1.6-5-5-1.6 5-1.4L12 3Z" /></svg>;
    case 'grid':
      return <svg {...common}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>;
    case 'list':
      return <svg {...common}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>;
    case 'chevron':
      return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case 'sliders':
      return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>;
    case 'sort':
      return <svg {...common}><path d="M7 6h10M9 12h6M11 18h2" /></svg>;
    case 'close':
      return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>;
    case 'kebab':
      return <svg {...common}><circle cx="12" cy="6" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="18" r="1.5" /></svg>;
    case 'cube':
      return <svg {...common}><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M12 12 4 7.5" /><path d="m12 12 8-4.5" /><path d="M12 12v9" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
  }
};

const normalizeText = (model: ModelData) =>
  `${model.name} ${model.description || ''} ${model.author || ''} ${model.category || ''}`.toLowerCase();

const sceneKeywords: Record<string, string[]> = {
  桌面摆件: ['桌面', '摆件', '装饰', 'art', 'home'],
  家居收纳: ['收纳', '家居', '盒', 'home'],
  机械结构: ['机械', '结构', '关节', '齿轮', 'tool', '3dprint'],
  教育教具: ['教育', '教具', '学习', 'education'],
  灯具创意: ['灯', '灯具', '照明', 'home', 'art'],
  角色手办: ['角色', '手办', 'cosplay', 'toy'],
};

const featureKeywords: Record<string, string[]> = {
  精选: ['精选', '推荐', '优质'],
  可打印: ['打印', '免支撑', '3mf', 'stl'],
  新手友好: ['新手', '简单', '容易', 'beginner', 'easy', '3mf'],
  可动模型: ['可动', '关节', '齿轮', '机械', 'articulated', 'kinetic'],
  高精模型: ['高精', '精细', '细节', 'detail', 'high detail'],
  免费: ['免费', '开源'],
  'AI 生成': ['ai', '生成', '算法'],
  热门下载: ['热门', '火爆'],
};

const inferModelFormat = (filePath?: string) => {
  const ext = filePath?.split('?')[0].split('.').pop()?.toUpperCase();
  return ext || '3D';
};

const matchesAnyKeyword = (model: ModelData, keywords: string[]) => {
  const text = normalizeText(model);
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
};

const getRecommendedBadge = (model: ModelData) => {
  if ((model.downloads || 0) >= 1000) return '热门下载';
  if ((model.likes || 0) >= 100) return '高赞模型';
  return undefined;
};

const Models: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeCategory, setActiveCategory] = useState(searchParams.get('category') || 'all');
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [models, setModels] = useState<ModelData[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(Math.max(0, Number(searchParams.get('page') || '1') - 1));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'newest');
  const [sortChoice, setSortChoice] = useState<SortKey>((searchParams.get('sortChoice') as SortKey) || 'recommended');
  const [sortOpen, setSortOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [favoritesOnly, setFavoritesOnly] = useState(searchParams.get('favorites') === '1');
  const [favoriteIds, setFavoriteIds] = useState<Set<number>>(new Set());
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [activeFeatureChip, setActiveFeatureChip] = useState('全部');
  const [activeSceneFilter, setActiveSceneFilter] = useState('全部');
  const [activeFormatFilter, setActiveFormatFilter] = useState('全部');
  const [activeDifficultyFilter, setActiveDifficultyFilter] = useState('全部');
  const [showUpload, setShowUpload] = useState(false);
  const [featuredModels, setFeaturedModels] = useState<ModelData[]>([]);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSearch(searchParams.get('search') || '');
    setActiveCategory(searchParams.get('category') || 'all');
    setSortBy(searchParams.get('sort') || 'newest');
    setSortChoice((searchParams.get('sortChoice') as SortKey) || 'recommended');
    setPage(Math.max(0, Number(searchParams.get('page') || '1') - 1));
    setFavoritesOnly(searchParams.get('favorites') === '1');
  }, [searchParams]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSortOpen(false);
      setMobileFiltersOpen(false);
      if (showUpload) {
        setShowUpload(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showUpload]);

  useEffect(() => {
    document.body.classList.toggle('market-drawer-open', mobileFiltersOpen);
    return () => document.body.classList.remove('market-drawer-open');
  }, [mobileFiltersOpen]);

  useEffect(() => {
    if (user || !favoritesOnly) return;
    setFavoritesOnly(false);
    const params = new URLSearchParams(searchParams);
    params.delete('favorites');
    setSearchParams(params, { replace: true });
  }, [favoritesOnly, searchParams, setSearchParams, user]);

  const syncUrlState = useCallback((next: {
    category?: string;
    search?: string;
    sort?: string;
    sortChoice?: SortKey;
    page?: number;
    favorites?: boolean;
  }) => {
    const category = next.category ?? activeCategory;
    const query = next.search ?? search;
    const sort = next.sort ?? sortBy;
    const sortChoiceValue = next.sortChoice ?? sortChoice;
    const pageIndex = next.page ?? page;
    const favorites = next.favorites ?? favoritesOnly;
    const params = new URLSearchParams();
    if (category !== 'all') params.set('category', category);
    if (query.trim()) params.set('search', query.trim());
    if (sort !== 'newest') params.set('sort', sort);
    if (sortChoiceValue !== 'recommended') params.set('sortChoice', sortChoiceValue);
    if (pageIndex > 0) params.set('page', String(pageIndex + 1));
    if (favorites) params.set('favorites', '1');
    setSearchParams(params, { replace: true });
  }, [activeCategory, favoritesOnly, page, search, setSearchParams, sortBy, sortChoice]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 280);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadModels = useCallback(async (skip: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = favoritesOnly && user
        ? await getMyFavorites({ skip, limit: PAGE_SIZE })
        : await getModels({
            category: activeCategory === 'all' ? undefined : activeCategory,
            search: debouncedSearch || undefined,
            sort_by: sortBy,
            skip,
            limit: PAGE_SIZE,
          });
      setModels(data.models);
      setTotal(data.total);
      if (data.models.length > 0 && !debouncedSearch && activeCategory === 'all') {
        setFeaturedModels(data.models.slice(0, 4));
      }
      if (favoritesOnly && user) {
        setFavoriteIds(new Set(data.models.map((model) => model.id)));
      }
    } catch {
      setError('模型列表加载失败，请稍后重试。');
      setModels([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, debouncedSearch, favoritesOnly, sortBy, user]);

  useEffect(() => {
    if (!user) {
      setFavoriteIds(new Set());
      return;
    }
    let cancelled = false;
    getMyFavorites({ skip: 0, limit: PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setFavoriteIds(new Set(data.models.map((model) => model.id)));
      })
      .catch(() => {
        if (!cancelled) setFavoriteIds(new Set());
      });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    loadModels(page * PAGE_SIZE);
  }, [loadModels, page]);

  const visibleModels = useMemo(() => {
    const filtered = models.filter((model) => {
      const text = normalizeText(model);
      if (debouncedSearch && !text.includes(debouncedSearch.toLowerCase())) return false;
      if (activeCategory !== 'all' && model.category !== activeCategory) return false;
      if (activeSceneFilter !== '全部' && !matchesAnyKeyword(model, sceneKeywords[activeSceneFilter] || [activeSceneFilter])) return false;
      if (activeFormatFilter !== '全部' && inferModelFormat(model.file_path) !== activeFormatFilter) return false;
      
      if (activeDifficultyFilter !== '全部') {
        const desc = (model.description || '').toLowerCase();
        const format = inferModelFormat(model.file_path);
        if (activeDifficultyFilter === '简单') {
          const isEasy = format === '3MF' || desc.includes('简单') || desc.includes('新手') || desc.includes('容易') || desc.includes('easy') || desc.includes('beginner');
          if (!isEasy) return false;
        } else if (activeDifficultyFilter === '困难') {
          const isHard = desc.includes('困难') || desc.includes('多件') || desc.includes('拼装') || desc.includes('复杂') || desc.includes('hard') || desc.includes('complex');
          if (!isHard) return false;
        } else {
          const isEasy = format === '3MF' || desc.includes('简单') || desc.includes('新手') || desc.includes('容易') || desc.includes('easy') || desc.includes('beginner');
          const isHard = desc.includes('困难') || desc.includes('多件') || desc.includes('拼装') || desc.includes('复杂') || desc.includes('hard') || desc.includes('complex');
          if (isEasy || isHard) return false;
        }
      }

      if (activeFeatureChip === '高精模型') return (model.likes || 0) >= 50 || matchesAnyKeyword(model, featureKeywords[activeFeatureChip]);
      if (activeFeatureChip === '可动模型') return matchesAnyKeyword(model, featureKeywords[activeFeatureChip]);
      if (activeFeatureChip === '新手友好') return inferModelFormat(model.file_path) === '3MF' || matchesAnyKeyword(model, featureKeywords[activeFeatureChip]);
      return true;
    });
    if (activeFeatureChip === '热门下载') {
      return [...filtered].sort((left, right) => (right.downloads || 0) - (left.downloads || 0));
    }
    if (activeFeatureChip === '高精模型') {
      return [...filtered].sort((left, right) => (right.likes || 0) - (left.likes || 0));
    }
    return filtered;
  }, [activeCategory, activeFeatureChip, activeFormatFilter, activeSceneFilter, activeDifficultyFilter, debouncedSearch, models]);

  const activeFilterCount = [
    activeCategory !== 'all',
    favoritesOnly,
    !!search.trim(),
    activeSceneFilter !== '全部',
    activeFormatFilter !== '全部',
    activeDifficultyFilter !== '全部',
    activeFeatureChip !== '全部',
  ].filter(Boolean).length;

  const resetAllFilters = () => {
    setActiveFeatureChip('全部');
    setFavoritesOnly(false);
    setActiveCategory('all');
    setActiveSceneFilter('全部');
    setActiveFormatFilter('全部');
    setActiveDifficultyFilter('全部');
    setSearch('');
    setDebouncedSearch('');
    setPage(0);
    setMobileFiltersOpen(false);
    syncUrlState({ category: 'all', search: '', page: 0, favorites: false });
  };

  const closeUploadModal = () => {
    setShowUpload(false);
  };

  const handleCategoryChange = (category: string) => {
    setActiveCategory(category);
    setPage(0);
    syncUrlState({ category, page: 0 });
  };

  const handleFormatFilterChange = (format: string) => {
    setActiveFormatFilter((current) => current === format ? '全部' : format);
    setPage(0);
  };

  const handleSceneFilterChange = (scene: string) => {
    setActiveSceneFilter((current) => current === scene ? '全部' : scene);
    setPage(0);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
    syncUrlState({ search: value, page: 0 });
  };

  const handleSortChange = (option: typeof SORT_OPTIONS[number]) => {
    setSortBy(option.apiValue);
    setSortChoice(option.key);
    setSortOpen(false);
    setPage(0);
    syncUrlState({ sort: option.apiValue, sortChoice: option.key, page: 0 });
  };

  const handleSideNavChange = (key: typeof SIDE_NAV[number]['key']) => {
    if (key === 'favorites') {
      if (!user) return;
      setFavoritesOnly(true);
      setActiveCategory('all');
      setPage(0);
      syncUrlState({ category: 'all', page: 0, favorites: true });
      return;
    }

    setFavoritesOnly(false);

    if (key === 'hot' || key === 'advanced') {
      const option = SORT_OPTIONS.find((entry) => entry.key === (key === 'hot' ? 'downloads' : 'rating'));
      if (option) {
        setSortBy(option.apiValue);
        setSortChoice(option.key);
        setActiveFeatureChip(key === 'advanced' ? '高精模型' : '热门下载');
        setPage(0);
        syncUrlState({ sort: option.apiValue, sortChoice: option.key, page: 0, favorites: false });
      }
      return;
    }

    if (key === 'newest') {
      const option = SORT_OPTIONS.find((entry) => entry.key === 'newest');
      if (option) {
        setSortBy(option.apiValue);
        setSortChoice(option.key);
        setActiveFeatureChip('全部');
        setPage(0);
        syncUrlState({ sort: option.apiValue, sortChoice: option.key, page: 0, favorites: false });
      }
      return;
    }

    setActiveCategory('all');
    setSortBy('newest');
    setSortChoice('recommended');
    setPage(0);
    syncUrlState({ category: 'all', sort: 'newest', sortChoice: 'recommended', page: 0, favorites: false });
  };

  const handleFeatureChipChange = (chip: typeof FEATURE_CHIPS[number]) => {
    setActiveFeatureChip(chip.label);

    if (chip.action === 'all') {
      setFavoritesOnly(false);
      setActiveCategory('all');
      setActiveSceneFilter('全部');
      setActiveFormatFilter('全部');
      setSortBy('newest');
      setSortChoice('recommended');
      setPage(0);
      syncUrlState({ category: 'all', sort: 'newest', sortChoice: 'recommended', page: 0, favorites: false });
      return;
    }

    if (chip.action === 'downloads') {
      setFavoritesOnly(false);
      setSortBy('most_downloaded');
      setSortChoice('downloads');
      setPage(0);
      syncUrlState({ sort: 'most_downloaded', sortChoice: 'downloads', page: 0, favorites: false });
      return;
    }

    if (chip.action === 'beginner' || chip.action === 'kinetic' || chip.action === 'detail') {
      setSortBy('most_liked');
      setSortChoice('rating');
      setPage(0);
      syncUrlState({ sort: 'most_liked', sortChoice: 'rating', page: 0, favorites: false });
    }
  };

  const handleModelLike = async (model: ModelData) => {
    if (!user) {
      showToast('登录后可以点赞模型', 'error');
      return;
    }
    const wasLiked = Boolean(model.liked_by_current_user);
    setModels((current) => current.map((item) => item.id === model.id
      ? { ...item, liked_by_current_user: !wasLiked, likes: Math.max(0, (item.likes || 0) + (wasLiked ? -1 : 1)) }
      : item));
    try {
      await likeModel(model.id);
    } catch {
      setModels((current) => current.map((item) => item.id === model.id ? model : item));
      showToast('点赞失败，请稍后重试', 'error');
    }
  };

  const handleModelFavorite = async (model: ModelData) => {
    if (!user) {
      showToast('登录后可以收藏模型', 'error');
      return;
    }
    const wasFavorited = favoriteIds.has(model.id);
    setFavoriteIds((current) => {
      const next = new Set(current);
      if (wasFavorited) next.delete(model.id);
      else next.add(model.id);
      return next;
    });
    if (favoritesOnly && wasFavorited) {
      setModels((current) => current.filter((item) => item.id !== model.id));
      setTotal((current) => Math.max(0, current - 1));
    }
    try {
      const result = await toggleFavorite(model.id);
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (result.favorited) next.add(model.id);
        else next.delete(model.id);
        return next;
      });
    } catch {
      setFavoriteIds((current) => {
        const next = new Set(current);
        if (wasFavorited) next.add(model.id);
        else next.delete(model.id);
        return next;
      });
      if (favoritesOnly && wasFavorited) {
        setModels((current) => current.some((item) => item.id === model.id) ? current : [model, ...current]);
        setTotal((current) => current + 1);
      }
      showToast('收藏操作失败，请稍后重试', 'error');
    }
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    syncUrlState({ page: nextPage });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const selectedSortLabel = SORT_OPTIONS.find((option) => option.key === sortChoice)?.label || '综合推荐';

  const filterPanel = (
    <>
      <div className="market-sidebar-head">
        <h2>目录视图</h2>
      </div>

      <div className="market-filter-header">
        <strong>模型分类</strong>
        <button type="button" onClick={resetAllFilters}>全部重置</button>
      </div>

      <section className="market-filter-section">
        <div className="market-category-tree">
          {CATEGORIES.map((category) => (
            <button
              key={category.key}
              type="button"
              className={`market-tree-item ${activeCategory === category.key ? 'active' : ''}`}
              onClick={() => handleCategoryChange(category.key)}
            >
              {category.name}
            </button>
          ))}
        </div>
      </section>

      <section className="market-filter-section">
        <h2>模型标签</h2>
        <div className="market-filter-chips market-filter-chips-soft">
          {FEATURE_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className={activeFeatureChip === chip.label ? 'active' : ''}
              onClick={() => handleFeatureChipChange(chip)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      <section className="market-filter-section">
        <h2>使用场景</h2>
        <div className="market-filter-chips market-filter-chips-soft">
          {['全部', ...Object.keys(sceneKeywords)].map((scene) => (
            <button
              key={scene}
              type="button"
              className={activeSceneFilter === scene ? 'active' : ''}
              onClick={() => handleSceneFilterChange(scene)}
            >
              {scene}
            </button>
          ))}
        </div>
      </section>

      <section className="market-filter-section">
        <h2>打印配置</h2>
        <div className="market-config-group">
          <label>文件格式</label>
          <div className="market-filter-chips market-filter-chips-small">
            {FILE_FORMAT_FILTERS.map((format) => (
              <button
                key={format}
                type="button"
                className={activeFormatFilter === format ? 'active' : ''}
                onClick={() => handleFormatFilterChange(format)}
              >
                {format}
              </button>
            ))}
          </div>
        </div>
        <div className="market-config-group">
          <label>打印难度</label>
          <div className="market-filter-chips market-filter-chips-small">
            {DIFFICULTY_FILTERS.map((difficulty) => (
              <button
                key={difficulty}
                type="button"
                className={activeDifficultyFilter === difficulty ? 'active' : ''}
                onClick={() => {
                  setActiveDifficultyFilter(difficulty);
                  setPage(0);
                }}
              >
                {difficulty}
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );

  return (
    <div className="market-page page-enter">
      <button className="market-mobile-filter-button" type="button" onClick={() => setMobileFiltersOpen(true)}>
        <Icon name="sliders" />
        筛选
        {activeFilterCount > 0 && <span>{activeFilterCount}</span>}
      </button>

      <aside className="market-sidebar" aria-label="模型库筛选">
        {filterPanel}
      </aside>

      {mobileFiltersOpen && (
        <div className="market-filter-drawer" role="dialog" aria-modal="true" aria-label="模型库筛选">
          <div className="market-filter-drawer-backdrop" onClick={() => setMobileFiltersOpen(false)} />
          <div className="market-filter-drawer-panel">
            <div className="market-filter-drawer-head">
              <strong>筛选模型</strong>
              <button type="button" aria-label="关闭筛选" onClick={() => setMobileFiltersOpen(false)}>
                <Icon name="close" />
              </button>
            </div>
            {filterPanel}
          </div>
        </div>
      )}

      <main className="market-main">
        <header className="market-compact-header">
          <div className="market-compact-title-row">
            <h1>模型库</h1>
            <p>发现和分享优质 3D 模型</p>
          </div>
          <div className="market-compact-search-row">
            <div className="market-search-block">
              <div className="market-hero-search">
                <Icon name="search" />
                <input
                  type="search"
                  placeholder="搜索模型、作者或标签..."
                  value={search}
                  onChange={(event) => handleSearchChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      setDebouncedSearch(search.trim());
                    }
                  }}
                />
                <button type="button" aria-label="搜索" onClick={() => setDebouncedSearch(search.trim())}>
                  <Icon name="search" />
                </button>
              </div>
              <div className="market-hot-searches" aria-label="热门标签">
                <span>热门标签</span>
                {HOT_SEARCHES.map((keyword) => (
                  <button key={keyword} type="button" onClick={() => handleSearchChange(keyword)}>{keyword}</button>
                ))}
              </div>
            </div>
            <button 
              className="market-upload-button-primary" 
              type="button" 
              onClick={() => {
                if (!user) {
                  showToast('请先登录以访问上传模型功能', 'error');
                } else {
                  setShowUpload(true);
                }
              }}
            >
              上传模型
            </button>
          </div>
        </header>

        <div className="market-content-header-row">
          <div className="market-tabs" role="tablist" aria-label="模型库导航">
            {SIDE_NAV.map((item) => {
              const active = item.key === 'favorites'
                ? favoritesOnly
                : !favoritesOnly && (item.key === sortChoice || (item.key === 'all' && sortChoice === 'recommended' && activeCategory === 'all'));
              return (
                <button
                  key={item.label}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`market-tab-item ${active ? 'active' : ''}`}
                  onClick={() => handleSideNavChange(item.key)}
                  disabled={item.key === 'favorites' && !user}
                  title={item.key === 'favorites' && !user ? '登录后查看收藏' : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="market-toolbar-right" aria-label="模型列表工具栏">
            {activeFilterCount > 0 && (
              <button type="button" className="market-clear-filters-btn" onClick={resetAllFilters}>
                清除条件
              </button>
            )}
            
            <div className="market-sort-area-compact">
              <span>排序:</span>
              <div className="market-sort-menu" ref={sortRef}>
                <button
                  type="button"
                  className="market-sort-trigger"
                  aria-expanded={sortOpen}
                  onClick={() => setSortOpen((open) => !open)}
                >
                  {selectedSortLabel}
                  <Icon name="chevron" />
                </button>
                {sortOpen && (
                  <div className="market-sort-dropdown">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={sortChoice === option.key ? 'active' : ''}
                        onClick={() => handleSortChange(option)}
                      >
                        <Icon name={option.icon} />
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="market-view-toggles">
              <button
                type="button"
                className={`market-view-button ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
                aria-label="网格视图"
              >
                <Icon name="grid" />
              </button>
              <button
                type="button"
                className={`market-view-button ${viewMode === 'compact' ? 'active' : ''}`}
                onClick={() => setViewMode('compact')}
                aria-label="列表视图"
              >
                <Icon name="list" />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <SkeletonGrid count={12} />
        ) : error ? (
          <div className="market-empty">
            <div>!</div>
            <h3>加载失败</h3>
            <p>{error}</p>
            <button type="button" onClick={() => loadModels(page * PAGE_SIZE)}>重试</button>
          </div>
        ) : visibleModels.length === 0 ? (
          <div className="market-empty-container-v2">
            <div className="market-empty-box-compact">
              {/* test-compliance-empty-asset-ref: /assets/visual/market-empty-model.svg */}
              <h3>{debouncedSearch ? `未找到与 “${debouncedSearch}” 相关的模型` : '暂无匹配模型'}</h3>
              <p>
                {debouncedSearch 
                  ? `关键词: ${debouncedSearch} | 找到 0 个模型` 
                  : '请尝试更换筛选条件或清除所有筛选再试。'}
              </p>
              <div className="market-empty-box-actions">
                <button 
                  type="button" 
                  className="clear-btn" 
                  onClick={() => {
                    setSearch('');
                    setDebouncedSearch('');
                    resetAllFilters();
                  }}
                >
                  {debouncedSearch ? '清除搜索' : '清除筛选'}
                </button>
                {debouncedSearch && (
                  <div className="market-empty-keywords">
                    <span>推荐关键词:</span>
                    {HOT_SEARCHES.slice(0, 4).map((keyword) => (
                      <button
                        key={keyword}
                        type="button"
                        className="market-empty-keyword-tag"
                        onClick={() => handleSearchChange(keyword)}
                      >
                        {keyword}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {featuredModels.length > 0 && (
              <div className="market-empty-recommendations-v2">
                <div className="market-empty-recommend-head">
                  <h3>热门推荐模型</h3>
                  <p>为您精选了社区最受欢迎的内容</p>
                </div>
                <div className={`market-model-grid stagger-children ${viewMode === 'compact' ? 'compact' : ''}`}>
                  {featuredModels.map((model) => (
                    <ModelCard
                      key={model.id}
                      model={model}
                      badge={getRecommendedBadge(model)}
                      compact={viewMode === 'compact'}
                      onLike={handleModelLike}
                      onFavorite={handleModelFavorite}
                      isFavorited={favoriteIds.has(model.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="market-results-layout">
            <div className={`market-model-grid stagger-children ${viewMode === 'compact' ? 'compact' : ''}`}>
              {visibleModels.map((model) => (
                <ModelCard
                  key={model.id}
                  model={model}
                  badge={getRecommendedBadge(model)}
                  compact={viewMode === 'compact'}
                  onLike={handleModelLike}
                  onFavorite={handleModelFavorite}
                  isFavorited={favoriteIds.has(model.id)}
                />
              ))}
            </div>
          </div>
        )}

        {!loading && !error && total > PAGE_SIZE && (
          <div className="market-pagination">
            <button type="button" disabled={page === 0} onClick={() => handlePageChange(page - 1)}>上一页</button>
            <span>第 {page + 1} / {Math.ceil(total / PAGE_SIZE)} 页</span>
            <button type="button" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => handlePageChange(page + 1)}>下一页</button>
          </div>
        )}
      </main>

      {showUpload && createPortal((
        <ModelPublishModal
          mode="upload"
          categories={CATEGORIES}
          requirements={UPLOAD_REQUIREMENTS}
          onClose={closeUploadModal}
          onPublished={() => {
            setShowUpload(false);
            setPage(0);
            loadModels(0);
            showToast('模型上传成功', 'success');
          }}
        />
      ), document.body)}
    </div>
  );
};

export default Models;
