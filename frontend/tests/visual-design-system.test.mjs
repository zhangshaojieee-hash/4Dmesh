import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

describe('brand-aligned marketplace visual design system', () => {
  const css = read('src/index.css');
  const header = read('src/components/Header.tsx');
  const home = read('src/pages/Home.tsx');
  const models = read('src/pages/Models.tsx');
  const modelPublishModal = read('src/components/ModelPublishModal.tsx');
  const auth = read('src/pages/auth/Login.tsx');
  const aiCreate = read('src/pages/AICreate.tsx');
  const gcodeEditor = read('src/pages/GcodeEditor.tsx');
  const modelCard = read('src/components/ModelCard.tsx');
  const visualPrompts = read('public/assets/visuals/prompts.md');

  it('defines shared brand and marketplace tokens for the light creator shell', () => {
    assert.match(css, /--brand-primary:\s*#FF8C42;/, 'project orange should be the primary brand action color');
    assert.match(css, /--brand-secondary:\s*#5E9CAE;/, 'project blue should remain available as the secondary brand color');
    assert.match(css, /--brand-accent:\s*#7DD3C0;/, 'project mint accent should remain available for supporting surfaces');
    assert.match(css, /--makerworld-green:\s*var\(--brand-primary\);/, 'legacy MakerWorld action token should map to the project brand color');
    assert.match(css, /--makerworld-ink:\s*#111315;/, 'charcoal active-state token should be available as a shared token');
    assert.match(css, /--makerworld-sidebar-width:\s*clamp\(192px,\s*14vw,\s*236px\);/, 'desktop sidebar width should adapt through a shared token');
    assert.match(css, /--makerworld-card-radius:\s*22px;/, 'model and promo cards should use a shared marketplace radius');
  });

  it('turns the desktop header into a MakerWorld-style left discovery rail', () => {
    assert.match(header, /className="header-logo"/, 'header logo should remain the brand anchor');
    assert.match(header, /railCollapsed/, 'desktop rail should expose a collapsible state');
    assert.match(header, /header-rail-toggle/, 'desktop rail should include a visible collapse control');
    assert.match(header, /nav-item-icon/, 'collapsed rail should keep icon navigation instead of removing nav links');
    assert.match(css, /\.app-container:not\(\.auth-route\)\s+\.header\s*\{[\s\S]*width:\s*var\(--makerworld-sidebar-width\);/, 'non-auth desktop shell should reserve a fixed left header rail');
    assert.match(css, /\.app-container:not\(\.auth-route\)\s+\.main-wrapper\s*\{[\s\S]*padding-left:\s*var\(--makerworld-sidebar-width\);/, 'main content should offset beside the desktop rail');
    assert.match(css, /\.app-container\.rail-collapsed:not\(\.auth-route\)\s+\.main-wrapper\s*\{[\s\S]*padding-left:\s*var\(--makerworld-sidebar-collapsed-width\);/, 'collapsed rail should reclaim horizontal page space');
    assert.match(css, /\.app-container\.rail-collapsed:not\(\.auth-route\)\s+\.header-brand-row\s*\{[\s\S]*grid-template-columns:\s*1fr;[\s\S]*justify-items:\s*center;/, 'collapsed brand and toggle controls should stack without clipping');
    assert.match(css, /\.app-container\.rail-collapsed:not\(\.auth-route\)\s+\.nav-item\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/, 'collapsed rail should preserve icon-sized navigation targets');
    assert.match(css, /\.app-container\.rail-collapsed:not\(\.auth-route\)\s+\.nav-item-label\s*\{[\s\S]*display:\s*none;/, 'collapsed rail should hide labels only, not the nav links');
    assert.match(css, /\.nav-item\.active\s*\{[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--primary\),\s*var\(--primary-dark\)\);[\s\S]*color:\s*#fff;/, 'active desktop navigation should use the project brand pill treatment');
    assert.match(css, /@media \(max-width:\s*1024px\)\s*\{[\s\S]*\.app-container:not\(\.auth-route\)\s+\.header\s*\{[\s\S]*width:\s*100%;/, 'the left rail should collapse back to the mobile top header');
  });

  it('uses denser login and avatar controls in the rail without changing auth routes', () => {
    assert.match(header, /header-auth-panel/, 'logged-out rail should use a compact auth panel instead of loose links');
    assert.match(header, /user-identity-card/, 'logged-in rail should expose a richer avatar identity card');
    assert.match(css, /\.header-auth-panel\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*10px;/, 'auth panel should be a dense stacked control block');
    assert.match(css, /\.user-identity-card\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*44px minmax\(0,\s*1fr\) 20px;/, 'avatar block should include avatar, user metadata, and menu affordance columns');
  });

  it('uses search-first marketplace composition on home and model listing surfaces', () => {
    assert.match(home, /home-category-pill/, 'home should keep category chips as a discovery surface');
    assert.match(models, /market-hero-search/, 'models page should keep the search-first discovery hero');
    assert.match(css, /\.home-page\s*\{[\s\S]*--home-rail-width:\s*min\(calc\(100% - \(var\(--page-gutter\) \* 2\)\),\s*calc\(100vw - \(var\(--page-gutter\) \* 2\)\)\);/, 'home rail should fill the available fullscreen marketplace width');
    assert.match(css, /\.home-category-pill\.active\s*\{[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--primary\),\s*var\(--primary-dark\)\);/, 'home active category should use the project brand pill');
    assert.match(css, /\.market-hero-search\s*\{[\s\S]*border:\s*2px solid rgba\(17, 19, 21, 0\.08\);/, 'market search should be a prominent rounded discovery bar');
    assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*--voice-chat-bottom-offset:\s*76px;/, 'mobile floating assistant should not cover marketplace sort controls');
    assert.match(css, /button\[title="AI语音助手"\]\s*\{[\s\S]*bottom:\s*var\(--voice-chat-bottom-offset, 16px\) !important;/, 'voice assistant fixed position should be controlled by the shared responsive offset');
  });

  it('fills wide viewports with denser full-screen marketplace sections without sparse-result filler', () => {
    assert.doesNotMatch(models, /hasSparseResults|market-sparse-companion/, 'models page should not add a current-results-too-few companion panel');
    assert.match(css, /--content-workbench-max-width:\s*calc\(100vw - \(var\(--page-gutter\) \* 2\)\);/, 'workbench routes should use the available viewport instead of narrow centered columns');
    assert.match(css, /\.home-page\s*\{[\s\S]*--home-rail-width:\s*min\(calc\(100% - \(var\(--page-gutter\) \* 2\)\),\s*calc\(100vw - \(var\(--page-gutter\) \* 2\)\)\);/, 'home sections should expand across the available screen');
    assert.match(css, /\.home-hero\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*0\.92fr\) minmax\(520px,\s*1\.08fr\);/, 'home hero should use a denser fullscreen two-column ratio');
    assert.match(css, /\.market-page\s*\{[\s\S]*width:\s*min\(calc\(100% - \(var\(--page-gutter\) \* 2\)\),\s*var\(--content-workbench-max-width\)\);/, 'models marketplace should fill wide viewports while respecting gutters');
    assert.doesNotMatch(css, /market-results-layout-sparse|market-sparse-companion/, 'CSS should not preserve sparse-result companion layout styles');
  });

  it('strengthens responsive adaptability across marketplace breakpoints', () => {
    assert.match(css, /@media \(max-width:\s*1024px\)\s*\{[\s\S]*\.app-container:not\(\.auth-route\)\s+\.header-inner\s*\{[\s\S]*flex-direction:\s*row;/, 'tablet header should return to a compact top-bar layout');
    assert.match(css, /@media \(max-width:\s*980px\)\s*\{[\s\S]*\.market-page\s*\{[\s\S]*display:\s*block;[\s\S]*width:\s*100%;/, 'tablet model listing should collapse from sidebar grid to one-column flow');
    assert.match(css, /@media \(max-width:\s*720px\)\s*\{[\s\S]*\.market-sort-area\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) 44px 44px;/, 'mobile sort controls should reserve fixed touch targets without horizontal overflow');
    assert.match(css, /@media \(max-width:\s*560px\)\s*\{[\s\S]*\.market-model-grid,[\s\S]*\.market-model-grid\.compact,[\s\S]*\.market-main > \.model-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/, 'narrow mobile cards should become a single safe column');
  });

  it('keeps model cards compact, image-led, and metric-rich', () => {
    assert.match(css, /\.market-model-card\s*\{[\s\S]*border-radius:\s*var\(--radius-xl\);/, 'model cards should use the current compact marketplace card radius');
    assert.match(css, /\.market-model-thumb\s*\{[\s\S]*aspect-ratio:\s*1\.22;/, 'model thumbnails should stay image-led and compact');
    assert.match(css, /\.market-model-badge\s*\{[\s\S]*background:\s*rgba\(17, 19, 21, 0\.82\);/, 'badges should use the dark overlay style from marketplace cards');
    assert.match(css, /\.market-model-stats span\s*\{[\s\S]*min-height:\s*30px;/, 'metric chips should stay compact enough for dense grids');
  });

  it('shares the refreshed visual language with auth without changing auth behavior', () => {
    assert.match(css, /\.auth-page\s*\{[\s\S]*background:[\s\S]*var\(--makerworld-page\)/, 'auth page should inherit the same light marketplace page tone');
    assert.match(css, /\.auth-submit\s*\{[\s\S]*background:\s*linear-gradient\(135deg,\s*var\(--primary\),\s*var\(--primary-dark\)\);/, 'auth primary action should use the shared project brand accent');
  });

  it('moves auth entry points and avatar menus into the corrected rail geometry', () => {
    assert.match(header, /header-auth-actions/, 'logged-out auth links should be grouped as compact rail actions');
    assert.match(css, /\.header-auth-actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/, 'login and register buttons should sit as a balanced two-action group');
    assert.match(css, /\.user-dropdown\s*\{[\s\S]*bottom:\s*calc\(100% \+ 12px\);[\s\S]*top:\s*auto;/, 'desktop avatar menu should open upward from the avatar card');
    assert.match(css, /@media \(max-width:\s*1024px\)\s*\{[\s\S]*\.user-dropdown\s*\{[\s\S]*top:\s*calc\(100% \+ 10px\);[\s\S]*bottom:\s*auto;/, 'mobile header should keep dropdown below the top bar where upward opening would clip');
  });

  it('removes generated non-homepage PNG visuals while preserving existing non-generated assets', () => {
    for (const assetPath of [
      'public/assets/visuals/auth-workbench-panel.svg',
      'public/assets/visuals/model-marketplace-hero.svg',
      'public/assets/visuals/ai-creation-panel.svg',
      'public/assets/visuals/gcode-workspace-panel.svg',
    ]) {
      assert.equal(existsSync(join(root, assetPath)), true, `${assetPath} should exist as the reusable SVG visual asset`);
    }
    assert.doesNotMatch(auth + models + aiCreate + gcodeEditor, /\/assets\/visuals\/[^"']+\.png/, 'non-homepage surfaces should not reference generated PNG visual assets');
    for (const assetPath of [
      'public/assets/visuals/auth-hero.png',
      'public/assets/visuals/marketplace-model-hero.png',
      'public/assets/visuals/ai-creation-studio.png',
      'public/assets/visuals/gcode-toolpath-workspace.png',
    ]) {
      assert.equal(existsSync(join(root, assetPath)), false, `${assetPath} should be deleted`);
    }
    assert.doesNotMatch(models, /className="hero-orbit|className="hero-plate|className="hero-cube/, 'market hero should not render CSS-only geometric art pieces');
    assert.doesNotMatch(gcodeEditor, /<div className="empty-state-icon">3D<\/div>/, 'G-code empty preview should not be a plain text 3D marker');
  });

  it('documents reusable high-quality image generation prompts for app visuals', () => {
    assert.match(visualPrompts, /Marketplace model hero/i, 'prompt guide should include a marketplace model hero brief');
    assert.match(visualPrompts, /AI creation studio/i, 'prompt guide should include an AI creation studio brief');
    assert.match(visualPrompts, /G-code toolpath workspace/i, 'prompt guide should include a G-code workspace brief');
    assert.match(visualPrompts, /Authentication maker workflow/i, 'prompt guide should include an auth workflow brief');
    assert.match(visualPrompts, /Negative prompt/i, 'prompt guide should include a shared negative prompt');
    assert.match(visualPrompts, /no logo, no text/i, 'prompt guide should forbid baked text and logos');
    assert.match(visualPrompts, /MakerWorld logo|Bambu Lab branding/i, 'negative prompt should forbid copied reference-site branding');
  });

  it('adds MakerWorld-inspired frontend-only marketplace affordances without backend changes', () => {
    assert.doesNotMatch(models, /CREATOR_INSPIRATION|market-creator-inspiration/, 'models page should not render the removed creator inspiration entry point');
    assert.doesNotMatch(models, /使用真实数据进行筛选|使用左侧条件筛选真实模型数据|选择条件缩小模型范围/, 'models filter summary should not use rejected fallback copy');
    assert.match(models + modelPublishModal, /market-upload-requirements/, 'upload modal should explain MakerWorld-style publishing requirements');
    assert.match(models + modelPublishModal, /market-upload-checklist/, 'upload modal should include a visible quality checklist');
    assert.match(models, /真实打印封面|实物封面/, 'upload checklist should remind creators to use a real printed cover photo');
    assert.match(models, /打印配置|3MF/, 'upload checklist should mention print profile or 3MF readiness');
    assert.match(modelCard, /market-model-readiness/, 'model cards should expose a frontend-derived print readiness chip');
    assert.match(modelCard, /含配置包|可切片|预览友好/, 'readiness chip should derive safe labels from existing file formats');
    assert.doesNotMatch(models + modelCard, /license\s*[:=]|relatedModels|printProfileId/, 'frontend-only affordances should not invent missing backend fields');
    assert.doesNotMatch(css, /\.market-creator-inspiration\s*\{/, 'removed creator inspiration CSS should not remain');
    assert.match(css, /\.market-upload-requirements\s*\{/, 'upload requirements should have scoped CSS');
    assert.match(css, /\.market-model-readiness\s*\{/, 'model readiness chip should have scoped CSS');
  });

  it('adds print-aware AI prompt guidance and G-code readiness affordances', () => {
    assert.match(aiCreate, /ai-prompt-builder/, 'AI Create should include a named prompt builder guidance block');
    assert.match(aiCreate, /ai-prompt-quality-list/, 'AI Create should include prompt quality checks');
    assert.match(aiCreate, /参数化桌面收纳盒/, 'AI prompt examples should become print-aware instead of generic cute toys');
    assert.match(aiCreate, /避免.*Logo|品牌名|文字/, 'AI guidance should tell users to avoid text/logos/brand names');
    assert.doesNotMatch(gcodeEditor, /readinessItems|gcode-readiness-panel|gcode-readiness-grid|gcode-readiness-status/, 'G-code workbench should not render the removed readiness reminder panel');
    assert.match(css, /\.ai-prompt-builder\s*\{/, 'AI prompt guidance should have scoped CSS');
    assert.match(css, /\.gcode-readiness-panel\s*\{/, 'G-code readiness panel should have scoped CSS');
  });

  it('adapts auth, AI Create, and G-code workbench layouts to the softer full-screen shell', () => {
    assert.match(css, /\.auth-visual-image\s*\{/, 'login/register visual image styling should remain available for the current auth shell');
    assert.match(aiCreate, /ai-create-hero-panel/, 'AI Create should include a soft hero/brief panel above the tool controls');
    assert.match(aiCreate, /ai-upload-box/, 'AI Create upload placeholders should keep the current named upload block');
    assert.match(css, /\.gcode-workbench-hero\s*\{/, 'G-code hero styling should remain available for the current shell');
    assert.match(css, /\.gcode-empty-visual\s*\{/, 'G-code empty visual styling should remain available for the current shell');
    assert.match(css, /--makerworld-page:\s*#f8f4ef;/, 'global marketplace background should be softer and warmer');
    assert.match(css, /\.ai-create-workspace\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(320px,\s*380px\) minmax\(0,\s*1fr\);/, 'AI Create should use a stable full-screen workbench grid');
    assert.match(css, /\.gcode-workbench-hero\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(280px,\s*420px\);/, 'G-code hero should adapt header content and visual asset without narrowing the workspace');
  });
});
