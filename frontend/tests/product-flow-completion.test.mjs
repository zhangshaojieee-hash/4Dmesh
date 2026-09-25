import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

describe('frontend product flow completion', () => {
  const aiCreate = read('src/pages/AICreate.tsx');
  const models = read('src/pages/Models.tsx');
  const modelCard = read('src/components/ModelCard.tsx');
  const projects = read('src/pages/Projects.tsx');
  const profile = read('src/pages/Profile.tsx');
  const header = read('src/components/Header.tsx');
  const gcodeEditor = read('src/pages/GcodeEditor.tsx');
  const projectStore = read('src/stores/project.tsx');
  const css = read('src/index.css');

  it('scopes AI-created model storage to the current authenticated user/session', () => {
    assert.match(aiCreate, /useAuth\(/, 'AI Create should use auth context before restoring drafts');
    assert.match(aiCreate, /AI_DRAFT_STORAGE_PREFIX/, 'AI storage should use a scoped draft prefix');
    assert.match(aiCreate, /getScopedAiStorageKey/, 'AI storage should build scoped storage keys');
    assert.match(aiCreate, /user\.id/, 'AI storage key should include the current user id');
    assert.match(aiCreate, /ai-draft:\$\{user\.id\}:result|`ai-draft:\$\{user\.id\}:result`/, 'result key should be user scoped');
    assert.match(aiCreate, /ai-draft:\$\{user\.id\}:annotations|`ai-draft:\$\{user\.id\}:annotations`/, 'annotation key should be user scoped');
    assert.match(aiCreate, /ai-draft:\$\{user\.id\}:pending-task|`ai-draft:\$\{user\.id\}:pending-task`/, 'pending task key should be user scoped');
    assert.doesNotMatch(aiCreate, /localStorage\.getItem\(RESULT_STORAGE_KEY\)/, 'AI result restore should not read the old global result key');
    assert.doesNotMatch(aiCreate, /localStorage\.getItem\(ANNOTATION_STORAGE_KEY\)/, 'AI annotation restore should not read the old global annotation key');
    assert.match(projectStore, /PROJECT_DRAFT_STORAGE_PREFIX/, 'project workspace persistence should be explicitly scoped and documented');
    assert.doesNotMatch(projectStore, /gcodeContent:\s*state\.gcodeContent/, 'project persistence should not serialize heavy G-code content');
    assert.doesNotMatch(projectStore, /surfacePaintGrid:\s*state\.surfacePaintGrid/, 'project persistence should not serialize base64 surface paint grids');
  });

  it('publishes AI-created models through the shared publish modal and retains draft records', () => {
    const publishModal = read('src/components/ModelPublishModal.tsx');
    const api = read('src/services/api.ts');
    assert.match(aiCreate, /ModelPublishModal/, 'AI Create should use the shared model publish modal');
    assert.match(aiCreate, /handlePublishModel/, 'AI Create should expose a publish handler for generated models');
    assert.match(aiCreate, /mode="retain"/, 'AI Create should retain the current draft model instead of reuploading it');
    assert.match(aiCreate, /modelId: result\.modelId/, 'publish modal should be preselected with the current draft model id');
    assert.match(aiCreate, /modelUrl: result\.model_url/, 'publish modal should receive the current draft model URL for thumbnail generation');
    assert.match(aiCreate, /getModelFileUrl\(model\.file_path\)/, 'publish completion should use the shared model file URL helper');
    assert.match(aiCreate, /publishedModelId|published_model_id/, 'publish completion should be tracked locally after retain success');
    assert.match(aiCreate, /model_id: result\.modelId \?\? null/, 'project save should include the current model id');
    assert.match(aiCreate, /modelId: result\.modelId \?\? null/, 'entering G-code should keep the current model id in project state');
    assert.match(publishModal, /retainModel/, 'shared publish modal should call retainModel for draft publishing');
    assert.match(publishModal, /fetch\(preset\.modelUrl!\)/, 'retain publish mode should fetch the existing model file for preview generation');
    assert.match(publishModal, /generateModelThumbnail/, 'retain publish mode should reuse automatic model thumbnail generation');
    assert.match(aiCreate, /本模型没有发布/, 'reset/delete of an unpublished AI-created model should warn the user');
    assert.match(api, /getDraftModels/, 'frontend API should expose current-user draft records');
    assert.match(aiCreate, /getDraftModels\(\{\s*skip:\s*0,\s*limit:\s*8\s*\}\)/, 'AI Create should load recent draft records from the backend');
    assert.match(aiCreate, /草稿记录/, 'AI Create should show draft records even when no result is currently loaded');
    assert.match(aiCreate, /searchParams\.get\('modelId'\)/, 'AI Create should restore imported draft model ids');
    assert.match(aiCreate, /searchParams\.get\('retentionExpiresAt'\)/, 'AI Create should restore imported draft expiry metadata');
    assert.match(aiCreate, /formatDraftExpiry/, 'AI Create should display draft expiry information');
    assert.match(aiCreate, /restoreDraftModel/, 'AI Create should allow restoring a visible draft record');
    assert.doesNotMatch(aiCreate, /is_published|publish_status|published_at/, 'AI publish state should not invent backend fields');
  });

  it('makes model library cards support listing-level like and favorite actions', () => {
    assert.match(models, /likeModel/, 'Models listing should import likeModel');
    assert.match(models, /toggleFavorite/, 'Models listing should import toggleFavorite');
    assert.match(models, /handleModelLike/, 'Models listing should expose a like handler');
    assert.match(models, /handleModelFavorite/, 'Models listing should expose a favorite handler');
    assert.match(modelCard, /onLike\?:/, 'ModelCard should accept a like action prop');
    assert.match(modelCard, /onFavorite\?:/, 'ModelCard should accept a favorite action prop');
    assert.match(modelCard, /market-model-actions/, 'ModelCard should render a named action area');
    assert.match(modelCard, /aria-pressed=\{Boolean\(model\.liked_by_current_user\)\}/, 'like button should expose pressed state from existing model field');
    assert.match(modelCard, /aria-pressed=\{isFavorited\}/, 'favorite button should expose pressed state from local favorite state');
    assert.match(models, /favoriteIds/, 'Models listing should keep local favorite state without backend field changes');
    assert.match(models, /getMyFavorites\(\{\s*skip:\s*0,\s*limit:\s*PAGE_SIZE\s*\}\)/, 'favorite bootstrap should include pagination params expected by the API');
    assert.doesNotMatch(models, /getMyFavorites\(\)\s*\n\s*\.then/, 'favorite bootstrap should not call my-favorites without params');
    assert.doesNotMatch(modelCard, /<Link[\s\S]*?<button/, 'ModelCard should not nest interactive buttons inside a Link');
  });

  it('makes model library left filters and chips functional without fake backend fields', () => {
    assert.match(models, /activeSceneFilter/, 'scene filter state should exist');
    assert.match(models, /activeFormatFilter/, 'file format filter state should exist');
    assert.match(models, /handleSceneFilterChange/, 'scene chips should have a real handler');
    assert.match(models, /handleFormatFilterChange/, 'format chips should have a real handler');
    assert.match(models, /inferModelFormat/, 'format filtering should derive from existing file_path');
    assert.match(models, /activeFeatureChip/, 'feature chips should remain stateful');
    assert.doesNotMatch(models, /NOZZLE_FILTERS|MATERIAL_FILTERS|activeNozzleFilter|activeMaterialFilter/, 'left filters should not expose stale nozzle or material choices');
    assert.match(models, /新手友好|可动模型|高精模型/, 'feature chips should map to real search/filter behavior');
    assert.doesNotMatch(models, /COLLAPSED_FILTER_ROWS/, 'unsupported inert collapsed rows should be removed or replaced');
    assert.doesNotMatch(models, /license\s*[:=]|printProfileId|rating\s*[:=]/, 'filters should not invent missing backend fields');
    assert.match(css, /\.market-filter-summary\s*\{/, 'usable filters should have a visible summary style');
  });

  it('routes My Models into Project Center and adds model/account-oriented project/profile surfaces', () => {
    assert.match(header, /to="\/projects\?tab=models"/, 'desktop My Models link should go to Project Center models tab');
    assert.match(header, /我的模型/, 'Header should retain a My Models entry');
    assert.match(projects, /useSearchParams/, 'Projects should sync tab state with query params');
    assert.match(projects, /ProjectsTab = 'projects' \| 'models' \| 'tasks'/, 'Projects should include a models tab');
    assert.match(projects, /getUserModels/, 'Projects models tab should use existing user-model API');
    assert.match(projects, /getDraftModels/, 'Projects models tab should load current-user temporary model records');
    assert.match(projects, /ModelCollectionView = 'saved' \| 'draft'/, 'Projects models tab should expose saved/draft switching');
    assert.match(projects, /临时模型/, 'Projects models tab should label temporary models');
    assert.match(projects, /handleContinueDraft/, 'Projects temporary model cards should continue back into AI Create');
    assert.match(projects, /handleOpenDraftInEditor/, 'Projects temporary model cards should enter G-code from drafts');
    assert.match(projects, /proj\.thumbnail_path \? getThumbnailUrl\(proj\.thumbnail_path\)/, 'Projects list should render saved project covers from model thumbnails');
    assert.match(projects, /model\.thumbnail_path \? getThumbnailUrl\(model\.thumbnail_path\)/, 'Projects temporary model cards should render draft thumbnail covers');
    assert.match(projects, /projects-models-grid/, 'Projects models tab should render a named model grid');
    assert.match(projects, /projects-project-cover/, 'Project cards should include a stable cover area');
    assert.match(css, /\.projects-models-switch\s*\{/, 'Projects model switch should have scoped CSS');
    assert.match(css, /\.projects-project-cover\s*\{[\s\S]*aspect-ratio:/, 'Project covers should reserve stable image space');
    assert.match(css, /\.projects-draft-model-card\s*\{/, 'Projects draft model cards should have scoped CSS');
    assert.match(css, /\.projects-draft-model-thumb\s*\{[\s\S]*aspect-ratio:/, 'Draft model covers should reserve stable image space');
    assert.match(projects, /projects-summary-strip/, 'Project Center should expose a compact summary strip');
    assert.match(profile, /profile-creator-summary/, 'Profile should include a creator/account summary area');
    assert.match(profile, /profile-action-grid/, 'Profile should provide account action shortcuts');
    assert.match(profile, /to="\/projects\?tab=models"/, 'Profile should point user model management to Project Center');
    assert.match(css, /\.projects-summary-strip\s*\{/, 'Project Center summary should have scoped CSS');
    assert.match(css, /\.profile-action-grid\s*\{/, 'Profile action grid should have scoped CSS');
  });

  it('removes redundant G-code post-slice popups/jumps and keeps page transitions scoped', () => {
    assert.doesNotMatch(gcodeEditor, /showToast\('切片完成'\)/, 'post-slice success toast should be removed from the top flow');
    assert.doesNotMatch(gcodeEditor, /showToast\('4D 处理完成'\)/, 'post-process success toast should be removed from the top flow');
    assert.doesNotMatch(gcodeEditor, /window\.location\.reload|window\.alert/, 'G-code cleanup should not use alert/reload jumps');
    assert.match(gcodeEditor, /handleCancelProcessing/, 'G-code cancellation should be scoped to workbench state');
    assert.match(css, /@keyframes pageRouteIn/, 'page transitions should have a named route animation');
    assert.match(css, /\.page-enter\s*\{[\s\S]*animation:\s*pageRouteIn/, 'page enter should use the route animation');
    assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/, 'page transition should respect reduced motion');
  });

  it('persists slicing results back to the existing project record', () => {
    assert.match(gcodeEditor, /buildProjectPayload/, 'G-code project saving should use a shared payload builder');
    assert.match(gcodeEditor, /persistExistingProject/, 'G-code generated results should sync to existing project records');
    assert.match(gcodeEditor, /persistExistingProject\(\{\s*step:\s*'ready'[\s\S]*sliceResult[\s\S]*gcodeResult[\s\S]*gcodeInfo/, 'plain slicing should persist slice and G-code results');
    assert.match(gcodeEditor, /persistExistingProject\(\{\s*step:\s*'ready'[\s\S]*splitResult[\s\S]*modelResult[\s\S]*sliceResult[\s\S]*gcodeResult/, '4D processing should persist pipeline results');
    assert.match(gcodeEditor, /modelId:\s*res\.model_id \?\? null/, 'uploaded editor models should keep the draft model id');
  });
});
