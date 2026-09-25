import React, { useCallback, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getModels, type ModelData } from '../services/api';
import ModelCard from '../components/ModelCard';
import { SkeletonGrid } from '../components/Skeleton';

const CATEGORIES = [
  { name: '全部', key: 'all', color: '#FF8C42' },
  { name: '家用', key: 'home', color: '#FF8C42' },
  { name: '玩具游戏', key: 'toy', color: '#7BC9A6' },
  { name: '工具配件', key: 'tool', color: '#85C1E9' },
  { name: '艺术装饰', key: 'art', color: '#FFE066' },
  { name: '3D打印', key: '3dprint', color: '#FF8B8B' },
  { name: '微缩模型', key: 'miniature', color: '#A569BD' },
  { name: '角色道具', key: 'cosplay', color: '#5DADE2' },
  { name: '教育套件', key: 'education', color: '#58D68D' },
];

type HomeIconName = 'sparkle' | 'cube' | 'code' | 'arrow' | 'search';
type HomeFeatureIconName = Exclude<HomeIconName, 'arrow' | 'search'>;

const FEATURE_CARDS: Array<{
  path: string;
  icon: HomeFeatureIconName;
  title: string;
  desc: string;
  color: string;
}> = [
  {
    path: '/ai',
    icon: 'sparkle',
    title: 'AI 创作',
    desc: '图生 3D / 文生 3D，AI 驱动的模型生成',
    color: '#5FC99D',
  },
  {
    path: '/models',
    icon: 'cube',
    title: '模型库',
    desc: '浏览、上传和管理你的 3D 模型',
    color: '#5BA8D9',
  },
  {
    path: '/editor',
    icon: 'code',
    title: 'G-code 编辑',
    desc: '切片、编辑和优化你的打印文件',
    color: '#FF8C42',
  },
];

const HomeIcon = ({ name }: { name: HomeIconName }) => {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'sparkle':
      return <svg {...common}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" /></svg>;
    case 'cube':
      return <svg {...common}><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" /><path d="M4 7.5 12 12l8-4.5" /><path d="M12 12v9" /></svg>;
    case 'code':
      return <svg {...common}><path d="m8 9-4 3 4 3" /><path d="m16 9 4 3-4 3" /><path d="m14 5-4 14" /></svg>;
    case 'arrow':
      return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>;
    default:
      return null;
  }
};

const getModelGridClass = (models: ModelData[]) => [
  'model-grid',
  'home-model-grid',
  'stagger-children',
  models.length > 0 && models.length < 3 ? 'home-model-grid-sparse' : '',
].filter(Boolean).join(' ');

const Home: React.FC = () => {
  const [activeCategory, setActiveCategory] = useState('all');
  const [models, setModels] = useState<ModelData[]>([]);
  const [latestModels, setLatestModels] = useState<ModelData[]>([]);
  const [loading, setLoading] = useState(true);

  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getModels({
        category: activeCategory === 'all' ? undefined : activeCategory,
        sort_by: 'most_downloaded',
        limit: 8,
      });
      setModels(data.models);
    } catch (error) {
      void error;
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  const loadLatestModels = useCallback(async () => {
    try {
      const data = await getModels({ sort_by: 'newest', limit: 4 });
      setLatestModels(data.models);
    } catch (error) {
      void error;
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    loadLatestModels();
  }, [loadLatestModels]);

  const activeCategoryName = activeCategory === 'all'
    ? '热门模型'
    : CATEGORIES.find((category) => category.key === activeCategory)?.name;

  return (
    <div className="page-enter home-page">
      <section className="home-hero" aria-labelledby="home-hero-title">
        <div className="home-hero-copy">
          <Link to="/models" className="home-mobile-search" aria-label="搜索模型、用户、收藏夹和动态">
            <HomeIcon name="search" />
            <span>搜索模型、用户、收藏夹和动态</span>
          </Link>

          <h1 id="home-hero-title" className="home-hero-title">
            <span>从灵感到打印，</span>
            <span>一站式 <span className="home-hero-highlight">4D</span> 创作平台</span>
          </h1>
          <p className="home-hero-text">
            AI 生成 3D 模型，模型库分享灵感，在线 G-code 编辑，设备联动打印，让创意快速变为现实。
          </p>
          <div className="home-hero-actions" aria-label="首页主要入口">
            <Link to="/ai" className="btn btn-primary btn-lg home-primary-cta">
              <HomeIcon name="sparkle" />
              开始 AI 创作
            </Link>
            <Link to="/models" className="btn btn-secondary btn-lg home-secondary-cta">
              <HomeIcon name="cube" />
              浏览模型库
            </Link>
          </div>
        </div>

        <div className="home-visual-slot" aria-hidden="true">
          <span className="home-visual-glow home-visual-glow-primary" />
          <span className="home-visual-glow home-visual-glow-secondary" />
          <div className="home-visual-bay">
            <span className="home-visual-frame" />
            <span className="home-visual-plane home-visual-plane-back" />
            <span className="home-visual-plane home-visual-plane-front" />
            <span className="home-visual-ring home-visual-ring-main" />
            <span className="home-visual-ring home-visual-ring-offset" />
            <span className="home-visual-path home-visual-path-one" />
            <span className="home-visual-path home-visual-path-two" />
            <span className="home-visual-node home-visual-node-one" />
            <span className="home-visual-node home-visual-node-two" />
            <span className="home-visual-node home-visual-node-three" />
          </div>
        </div>
      </section>

      <section className="home-feature-section" aria-label="平台核心功能">
        <div className="home-feature-grid">
          {FEATURE_CARDS.map((feature) => (
            <Link
              key={feature.path}
              to={feature.path}
              className="home-feature-card"
              style={{ '--feature-color': feature.color } as React.CSSProperties}
            >
              <span className="home-feature-icon">
                <HomeIcon name={feature.icon} />
              </span>
              <span className="home-feature-copy">
                <strong>{feature.title}</strong>
                <span>{feature.desc}</span>
              </span>
              <span className="home-feature-arrow">
                <HomeIcon name="arrow" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="home-model-section" aria-labelledby="popular-models-title">
        <div className="home-model-header">
          <h2 id="popular-models-title" className="home-section-title">{activeCategoryName}</h2>
          <Link to="/models" className="home-section-link">查看更多 →</Link>
        </div>

        <div className="home-category-row" aria-label="模型分类筛选">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCategory(cat.key)}
              className={`home-category-pill ${activeCategory === cat.key ? 'active' : ''}`}
              style={{ '--category-color': cat.color } as React.CSSProperties}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="home-model-grid">
            <SkeletonGrid count={8} />
          </div>
        ) : models.length === 0 ? (
          <div className="empty-state home-empty-state">
            <HomeIcon name="cube" />
            <p>暂无模型，快去上传第一个吧</p>
            <Link to="/models" className="btn btn-primary mt-1">
              上传模型
            </Link>
          </div>
        ) : (
          <div className={getModelGridClass(models)}>
            {models.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
          </div>
        )}
      </section>

      {latestModels.length > 0 && (
        <section className="home-latest-section" aria-labelledby="latest-models-title">
          <div className="home-model-header">
            <h2 id="latest-models-title" className="home-section-title">最新上传</h2>
            <Link to="/models" className="home-section-link">查看更多 →</Link>
          </div>
          <div className={getModelGridClass(latestModels)}>
            {latestModels.map((model) => (
              <ModelCard key={model.id} model={model} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default Home;
