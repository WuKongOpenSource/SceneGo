import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

const readProjectFile = (relativePath: string): string =>
  fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

describe('创剧 design-system contract', () => {
  it('keeps the source-of-truth palette aligned across CSS and Tailwind', () => {
    const css = readProjectFile('styles/design-tokens.css');
    const tailwind = readProjectFile('tailwind.config.cjs');

    for (const color of [
      '#17171C',
      '#5B49F0',
      '#8B6BFF',
      '#4C3BD6',
      '#4536C9',
      '#7A5BFF',
      '#FF6A3D',
      '#12B76A',
      '#3B7BE5',
      '#D9822B',
      '#E5533C',
      '#E5E5E0',
      '#9A9AA2',
      '#6A6A74',
      '#F4F4F1',
      '#141419',
    ]) {
      expect(css.toUpperCase()).toContain(color);
      expect(tailwind.toUpperCase()).toContain(color);
    }
  });

  it('uses the 创剧 radius scale and soft floating shadow', () => {
    const css = readProjectFile('styles/design-tokens.css');

    expect(css).toContain('--radius-base: 9px');
    expect(css).toContain('--radius-lg: 14px');
    expect(css).toMatch(/\.rounded-lg,\s*\n\.rounded-xl,\s*\n\.rounded-2xl,\s*\n\.rounded-3xl\s*\{\s*border-radius: var\(--radius-lg\)/);
    expect(css).toContain('rgba(20, 20, 25, 0.18)');
    expect(css).toContain('rgba(91, 73, 240, 0.35)');
  });

  it('uses a standard document font for scripts instead of the monospace UI font', () => {
    const css = readProjectFile('styles/design-tokens.css');
    const conversation = readProjectFile('components/ScriptConversationPane.tsx');
    const quickColumn = readProjectFile('components/QuickScriptVersionColumn.tsx');

    expect(css).toContain('--font-document: "Times New Roman", "Microsoft YaHei"');
    expect(css).toContain('.font-document');
    expect(css).toContain('font-variant-numeric: lining-nums proportional-nums');
    expect(conversation).toContain('className="font-document min-h-0 flex-1 resize-none');
    expect(quickColumn).toContain('className="font-document h-full w-full resize-none');
  });

  it('provides one responsive overlay and dialog surface contract', () => {
    const css = readProjectFile('styles/design-tokens.css');

    expect(css).toContain('.app-modal-backdrop');
    expect(css).toContain('.app-modal-surface');
    expect(css).toContain('.app-modal-header');
    expect(css).toContain('.app-modal-body');
    expect(css).toContain('.app-modal-footer');
    expect(css).toContain('.app-drawer-backdrop');
    expect(css).toContain('.app-drawer-surface');
    expect(css).toContain('@media (max-width: 479px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('migrates dedicated modal components onto the shared surface', () => {
    const modalFiles = [
      'components/AIRewritePromptModal.tsx',
      'components/ConfirmDialog.tsx',
      'components/CreditEstimateModal.tsx',
      'components/ImageFusionModal.tsx',
      'components/MattingModal.tsx',
      'components/ProjectHub.tsx',
      'components/SeedanceAssetPickerModal.tsx',
      'components/ShareResourceDialog.tsx',
      'components/StoryboardToolModal.tsx',
      'components/audio/MusicModal.tsx',
      'components/audio/SfxModal.tsx',
      'components/video/SeedanceDetailModal.tsx',
      'components/video/StoryboardSyncModal.tsx',
    ];

    for (const modalFile of modalFiles) {
      const source = readProjectFile(modalFile);
      expect(source, modalFile).toContain('app-modal-backdrop');
      expect(source, modalFile).toContain('app-modal-surface');
      if (modalFile === 'components/audio/MusicModal.tsx') {
        expect(source, modalFile).toContain("aria-modal={presentation === 'modal' ? true : undefined}");
      } else {
        expect(source, modalFile).toContain('aria-modal="true"');
      }
    }

    const voiceDrawer = readProjectFile('components/audio/VoiceSidebar.tsx');
    expect(voiceDrawer).toContain('app-drawer-backdrop');
    expect(voiceDrawer).toContain('app-drawer-surface');
    expect(voiceDrawer).toContain('aria-modal="true"');
  });

  it('loads the theme globally without an inline legacy page color', () => {
    const html = readProjectFile('public-entry/index.html');

    expect(html).toContain('class="theme-webflow');
    expect(html).not.toContain('style="background-color:');
  });

  it('keeps the standalone unauthenticated login page on the same 创剧 system', () => {
    const login = readProjectFile('../login.html');

    expect(login).toContain('--primary: #5B49F0');
    expect(login).toContain('--n800: #17171C');
    expect(login).toContain('--n40: #E5E5E0');
    expect(login).toContain('"Noto Sans SC"');
    expect(login).toContain('var(--shadow-glow)');
    expect(login).not.toContain('transform: translateX(6px)');
    expect(login).toContain('transition: background-color 150ms ease, box-shadow 150ms ease, filter 150ms ease');
    expect(login).toContain('background: transparent');
    expect(login).toContain('input:-webkit-autofill + label');
    expect(login).toContain('box-shadow: 0 0 0 1000px var(--n0) inset');
    expect(login).toContain('width: 44%');
    expect(login).toContain('width: min(156px, 40vw)');
    expect(login).toContain('width: 136px');
    expect(login).toContain('linear-gradient(145deg, #0C1628 0%, #09111F 54%, #070D18 100%)');
    expect(login.match(/class="workflow-card"/g)).toHaveLength(3);
    expect(login).toContain('写剧本');
    expect(login).toContain('做分镜');
    expect(login).toContain('出成片');
    expect(login).toContain('@media (max-width: 479px)');
    expect(login).not.toMatch(/#0052CC|#0065FF|#0747A6|#172B4D|#146EF5/i);
  });

  it('uses one 创剧 identity and favicon set across public shells', () => {
    const appHtml = readProjectFile('public-entry/index.html');
    const loginHtml = readProjectFile('../login.html');
    const legacyAdminHtml = readProjectFile('../admin/index.html');
    const studioHtml = readProjectFile('../../studio/index.html');
    const header = readProjectFile('components/Header.tsx');
    const brandLogo = readProjectFile('components/BrandLogo.tsx');
    const accountMenu = readProjectFile('components/AccountMenu.tsx');
    const app = readProjectFile('App.tsx');
    const studioApp = readProjectFile('../../studio/App.tsx');

    for (const assetPath of [
      '../static/branding/chuangju-logo-on-light.svg',
      '../static/branding/chuangju-logo-on-dark.svg',
      '../static/branding/chuangju-mark.svg',
      '../static/favicon.ico',
      '../static/favicon-32x32.png',
      '../static/apple-touch-icon.png',
    ]) {
      expect(fs.statSync(path.join(projectRoot, assetPath)).size, assetPath).toBeGreaterThan(0);
    }

    expect(brandLogo).toContain('/static/branding/chuangju-logo-on-light.svg');
    expect(brandLogo).toContain('/static/branding/chuangju-logo-on-dark.svg');
    expect(brandLogo).toContain('/static/branding/chuangju-mark.svg');
    expect(brandLogo).toContain("tone = 'light'");
    expect(header).toContain('<BrandLogo');
    expect(header).not.toContain('<text x="14"');
    expect(accountMenu).toContain('个人中心');
    expect(accountMenu).toContain("window.location.href = '/profile'");
    expect(app).toContain("const ProfilePage");
    expect(app).toContain('path="/profile"');
    expect(appHtml).toContain('<title>创剧 · AI 视频创作平台</title>');
    expect(appHtml).toContain('<link rel="canonical" href="https://example.invalid/" />');
    expect(appHtml).toContain('把一个好想法，变成一部好漫剧');
    expect(appHtml).not.toContain('把一个想法，变成一部好故事');
    expect(appHtml).toContain('/favicon.svg?v=20260824-chuangju-v1');
    expect(appHtml).toContain('/favicon.ico?v=20260824-chuangju-v1');
    expect(loginHtml).toContain('/favicon.svg?v=20260824-chuangju-v1');
    expect(loginHtml).toContain('/favicon.ico?v=20260824-chuangju-v1');
    expect(loginHtml).toContain('/static/branding/chuangju-logo-on-dark.svg');
    expect(loginHtml).toContain('/static/branding/chuangju-logo-on-light.svg');
    expect(loginHtml).not.toContain('drop-shadow(2px 0 0 rgba(255,255,255,0.98))');
    expect(legacyAdminHtml).toContain('/favicon.ico?v=20260824-chuangju-v1');
    expect(legacyAdminHtml).toContain('/static/branding/chuangju-logo-on-dark.svg');
    expect(studioHtml).toContain('/favicon.ico?v=20260824-chuangju-v1');
    expect(studioHtml).toContain('/apple-touch-icon.png?v=20260824-chuangju-v1');
    expect(loginHtml).toContain('创剧是面向普通创作者的 AI 视频工作台。');
    expect(loginHtml).toContain('无需专业制作经验');
    expect(studioApp).toContain("isDarkCanvas");
    expect(studioApp).toContain('/static/branding/chuangju-logo-on-dark.svg');
    expect(studioApp).toContain('/static/branding/chuangju-logo-on-light.svg');

    for (const publicSource of [appHtml, loginHtml, legacyAdminHtml, studioHtml, brandLogo, studioApp]) {
      expect(publicSource).not.toMatch(/(?:example|placeholder)\s+brand/i);
      const copyWithoutDeploymentOrigin = publicSource
        .replaceAll('x-ostory-session-upgraded', '')
        .replaceAll('OstorySliderCaptcha', '');
      expect(copyWithoutDeploymentOrigin).not.toMatch(/Ostory(?:\s+TV|\s+Studio)?/i);
    }
  });

  it('keeps the admin shell visually distinct while reusing creator login', () => {
    const adminSidebar = readProjectFile('admin/AdminSidebar.tsx');
    const adminLayout = readProjectFile('admin/AdminLayout.tsx');
    const loginHtml = readProjectFile('../login.html');

    expect(adminSidebar).toContain('系统管理后台');
    expect(adminSidebar).toContain('Admin Console');
    expect(adminLayout).toContain('正在校验后台访问权限');
    expect(adminLayout).toContain('无后台访问权限');
    expect(loginHtml).toContain('<h1><span>把一个好想法，</span><span>变成一部好漫剧</span></h1>');
  });

  it('keeps project and episode hubs on the shared always-wide media-library shell', () => {
    const projectHub = readProjectFile('components/ProjectHub.tsx');
    const episodeHub = readProjectFile('pages/EpisodeHubPage.tsx');

    for (const source of [projectHub, episodeHub]) {
      expect(source).toContain('max-w-none');
      expect(source).toContain('2xl:grid-cols-5');
      expect(source).not.toContain("max-w-[1320px]");
      expect(source).not.toMatch(/切到宽屏|切回窄屏|project_hub_layout|episode_hub_layout/);
      expect(source).toContain('min-h-screen bg-n20');
      expect(source).toContain('<BrandLogo');
      expect(source).toContain('border-y border-n40');
      expect(source).toContain('shadow-atlas');
    }

    expect(projectHub).toContain('全部项目');
    expect(projectHub).toContain('已归档');
    expect(projectHub).toContain('title="创剧 · AI 视频创作平台"');
    expect(projectHub).toContain('<BrandLogo className="h-8 w-auto max-w-[170px]" alt="创剧 · AI 视频创作平台" />');
    expect(projectHub).not.toContain('OSTORY <span className="text-primary">·</span> 漫剧创作平台');
    expect(projectHub).toContain('include_archived: \'true\'');
    expect(projectHub).toContain('<AccountMenu');
    expect(projectHub).toContain('编辑项目');
    expect(projectHub).toContain('上传封面');
    expect(projectHub).toContain('object-cover object-center');
    expect(projectHub).not.toContain('含已归档');
    expect(episodeHub).toContain('全部分集');
    expect(episodeHub).toContain('草稿');
    expect(episodeHub).toContain('制作中');
    expect(episodeHub).toContain('已完成');
    expect(episodeHub).toContain('已发布');
    expect(episodeHub).toContain('title="创剧 · AI 视频创作平台"');
    expect(episodeHub).toContain('<BrandLogo className="h-8 w-auto max-w-[170px]" alt="创剧 · AI 视频创作平台" />');
    expect(episodeHub).not.toContain('OSTORY <span className="text-primary">·</span> 漫剧创作平台');
    expect(episodeHub).toContain('app-modal-backdrop');
    expect(episodeHub).toContain('aria-modal="true"');
    expect(episodeHub).toContain('流程化制作');
    expect(episodeHub).toContain('自由创作');
  });

  it('does not reintroduce dark neutral utilities into product source', () => {
    const sourceRoots = [
      'admin',
      'components',
      'contexts',
      'hooks',
      'layouts',
      'pages',
      'services',
      'utils',
    ];
    const sourceFiles: string[] = [];

    const collectFiles = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) collectFiles(absolutePath);
        if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(absolutePath);
      }
    };

    for (const sourceRoot of sourceRoots) {
      const absoluteRoot = path.join(projectRoot, sourceRoot);
      expect(
        fs.existsSync(absoluteRoot),
        `design-system source root does not exist: ${sourceRoot}`,
      ).toBe(true);
      collectFiles(absoluteRoot);
    }

    const forbiddenNeutral = /\b(?:bg|text|border|ring|from|via|to)-(?:gray|slate|zinc|neutral|stone|indigo)-\d+(?:\/\d+)?\b/;
    const forbiddenDarkStatus = /\b(?:bg|border|text)-(?:red|amber|yellow|orange|green|emerald|teal|cyan|sky|blue|purple|pink)-(?:800|900|950)(?:\/\d+)?\b/;

    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(sourceFile, 'utf8');
      expect(source, path.relative(projectRoot, sourceFile)).not.toMatch(forbiddenNeutral);
      expect(source, path.relative(projectRoot, sourceFile)).not.toMatch(forbiddenDarkStatus);
    }
  });
});
