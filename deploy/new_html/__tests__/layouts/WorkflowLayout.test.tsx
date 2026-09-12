import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../layouts/WorkflowLayout.tsx'), 'utf-8');
const sidebarSource = readFileSync(resolve(__dirname, '../../components/AppSidebar.tsx'), 'utf-8');
const tokenSource = readFileSync(resolve(__dirname, '../../styles/design-tokens.css'), 'utf-8');
const workspaceSource = readFileSync(resolve(__dirname, '../../WorkspaceApp.tsx'), 'utf-8');
const designSource = readFileSync(resolve(__dirname, '../../pages/DesignPage.tsx'), 'utf-8');
const materialSource = readFileSync(resolve(__dirname, '../../components/MaterialPage.tsx'), 'utf-8');
const audioSource = readFileSync(resolve(__dirname, '../../pages/AudioStagePage.tsx'), 'utf-8');
const voiceSidebarSource = readFileSync(resolve(__dirname, '../../components/audio/VoiceSidebar.tsx'), 'utf-8');
const dubbingPanelSource = readFileSync(resolve(__dirname, '../../components/audio/DubbingPanel.tsx'), 'utf-8');
const storyboardSource = readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf-8');
const videoSource = readFileSync(resolve(__dirname, '../../components/VideoPage.tsx'), 'utf-8');
const enhanceSource = readFileSync(resolve(__dirname, '../../pages/EnhancePage.tsx'), 'utf-8');
const mediaLibrarySource = readFileSync(resolve(__dirname, '../../pages/MediaLibraryPage.tsx'), 'utf-8');
const createSource = readFileSync(resolve(__dirname, '../../pages/CreatePage.tsx'), 'utf-8');
const imageUpscaleSource = readFileSync(resolve(__dirname, '../../pages/ImageUpscalePage.tsx'), 'utf-8').replace(/\r\n/g, '\n');

describe('WorkflowLayout account summary', () => {
  it('delegates account actions to the dark sidebar user row', () => {
    expect(source).not.toContain('AccountMenu');
    expect(sidebarSource).toContain("apiFetch('/api/logout'");
    expect(sidebarSource).toContain("window.location.href = '/profile'");
    expect(sidebarSource).toContain('getStoredUsername');
    expect(sidebarSource).toContain('clearAccountIdentity');
  });

  it('shows the available credit balance and links to the credits page', () => {
    expect(source).toContain('await getCreditBalance()');
    expect(source).toContain('balance.available_credits');
    expect(source).toContain("onClick={() => navigate('/credits')}");
    expect(source).toContain('<Coins');
    expect(source).toContain('availableCredits.toLocaleString()');
  });

  it('does not translate the logout button on hover', () => {
    expect(source).not.toContain('button-shift');
  });
});

describe('WorkflowLayout template pipeline shell', () => {
  it('explains the large-format print use case on the image upscale page', () => {
    expect(imageUpscaleSource).toContain('适用于宣传图、海报等大尺寸打印场景。');
  });

  it('separates image upscale controls and history into accessible tabs', () => {
    expect(imageUpscaleSource).toContain("useState<'upscale' | 'history'>('upscale')");
    expect(imageUpscaleSource).toContain('role="tablist" aria-label="图片高清放大功能"');
    expect(imageUpscaleSource).toContain('className="ui-tabs mb-5"');
    expect(imageUpscaleSource.match(/className="ui-tab"/g)).toHaveLength(2);
    expect(imageUpscaleSource).toContain('>\n            开始放大\n          </button>');
    expect(imageUpscaleSource).toContain('>\n            放大历史\n          </button>');
    expect(imageUpscaleSource).toContain("activeTab === 'upscale' &&");
    expect(imageUpscaleSource).toContain("activeTab === 'history' &&");
    expect(imageUpscaleSource).toContain('role="tabpanel"');
  });

  it('hides episode identity and workflow steps on standalone utility pages', () => {
    expect(source).toContain("const STANDALONE_UTILITY_PATHS = new Set(['image-upscale', 'history', 'recycle-bin'])");
    expect(source).toContain('const isStandaloneUtilityPage = STANDALONE_UTILITY_PATHS.has(segment)');
    expect(source.match(/!isStandaloneUtilityPage &&/g)).toHaveLength(2);
    expect(source).toContain('workflow-shell-account ml-auto');
  });

  it('keeps the four-stage pipeline stepper in one fixed header beside the dark sidebar', () => {
    expect(source).toContain("from '../components/AppSidebar'");
    expect(source).toContain('<AppSidebar');
    expect(source).toContain('className="workflow-shell-header');
    expect(source).toContain('aria-label="流程化制作导航"');
    expect(source).toContain('<NotificationPanel compact />');
    expect(source).toContain('className="workflow-shell-workspace');
  });

  it('maps the production sub-pages into four plain-language stages', () => {
    for (const stage of ['写故事', '定角色和场景', '排声音和画面', '生成短片']) expect(source).toContain(stage);
    for (const hint of ["hint: '第 1 步'", "hint: '第 2 步'", "hint: '第 3 步'", "hint: '第 4 步'"]) expect(source).toContain(hint);
    for (const sub of ["label: '故事内容'", "label: '角色场景'", "label: '素材绑定'", "label: '镜头画面'", "label: '声音对白'", "label: '生成视频'", "label: '优化合成'", "label: '导出成片'"]) {
      expect(source).toContain(sub);
    }
    expect(source).not.toContain("label: '可用素材'");
    expect(source).toContain('{STAGES.map');
    expect(source).toContain("'✓'");
    expect(source).toContain('ring-primary/15');
    expect(source).toContain('activeStage.subs.length > 1');
  });

  it('renders every multi-page stage as a numbered progressive sub-stepper', () => {
    expect(source).toContain('const activeSubStageIdx =');
    expect(source).toContain('aria-label={`${activeStage.label}阶段步骤`}');
    expect(source).toContain('const done = activeSubStageIdx >= 0 && index < activeSubStageIdx');
    expect(source).toContain('const subStepNumber = `${activeStageIdx + 1}-${index + 1}`');
    expect(source).toContain('aria-label={`${sub.label}，第 ${subStepNumber} 步`}');
    expect(source).toContain("done || active ? 'bg-success/60' : 'bg-n50'");
    expect(source).toContain("aria-current={active ? 'step' : undefined}");
    expect(source).toContain('{subStepNumber}');
    expect(source).toContain("{active ? '当前步骤' : done ? '已完成' : '下一步'}");
    expect(source).toContain('rounded-xl border border-n40 bg-n20/70 p-1');
    expect(source).toContain('min-w-[40px]');
    expect(source).not.toContain('第 {index + 1} 步');
    expect(source).not.toContain('阶段内子页签（模板 art-tabs 样式');
  });

  it('keeps the dark sidebar with plain-language navigation and all-user advanced tools', () => {
    expect(sidebarSource).toContain('bg-n900');
    expect(sidebarSource).toContain('<BrandLogo');
    expect(sidebarSource).toContain('开始新作品');
    expect(sidebarSource).toContain('我的作品');
    expect(sidebarSource).toContain('成片与分享');
    expect(sidebarSource).toContain('最近作品');
    expect(sidebarSource).toContain('更多功能');
    expect(sidebarSource).toContain('创作点数');
    expect(sidebarSource).toContain('ui-dark-panel');
    expect(source).toContain('exportTo="final"');
    expect(source).toContain("label: '我的素材'");
    expect(source).toContain("label: '生成历史'");
    expect(source).toContain("label: '回收站'");
    expect(source).toContain("label: '专业画布'");
    expect(sidebarSource).toContain('const visibleTools = tools ?? defaultTools');
    expect(sidebarSource).toContain("label: '图片高清放大'");
    expect(sidebarSource).toContain("label: '专业画布'");
    expect(sidebarSource).toContain('/episodes`');
  });

  it('keeps the sidebar first, the stepper centered, and credits/notification/export rightmost', () => {
    expect(source.indexOf('<AppSidebar')).toBeLessThan(source.indexOf('<header className="workflow-shell-header'));

    const headerStart = source.indexOf('<header className="workflow-shell-header');
    const headerEnd = source.indexOf('</header>', headerStart);
    const headerSource = source.slice(headerStart, headerEnd);

    expect(headerSource).toContain('{STAGES.map');
    expect(headerSource.indexOf('{STAGES.map')).toBeLessThan(headerSource.indexOf('<Coins'));
    expect(headerSource.indexOf('<Coins')).toBeLessThan(headerSource.indexOf('<NotificationPanel compact />'));
    expect(headerSource.indexOf('<NotificationPanel compact />')).toBeLessThan(headerSource.indexOf('<Download'));

    const accountClass = source.match(/className="workflow-shell-account\s+([^"]+)"/)?.[1] ?? '';
    expect(accountClass).not.toMatch(/\bborder-l\b/);
  });

  it('offers the one-sentence create home wired to project + episode creation', () => {
    expect(createSource).toContain('一句话，');
    expect(createSource).toContain('从创意到成片。');
    expect(createSource).toContain("apiJson<any>('/api/projects'");
    expect(createSource).toContain('/episodes`');
    expect(createSource).toContain('saveCreateIdeaSeed(sessionStorage');
    expect(createSource).toContain('episodeId: newEpisodeId');
    expect(createSource).toContain("navigate(`/projects/${newProjectId}/ep/${newEpisodeId}/workflow/script`)");
    expect(createSource).toContain('开始创作');
    expect(createSource).toContain('<details');
    expect(createSource).toContain('可选：调整故事类型、成片时长和画面方向');
    expect(createSource).toContain("'校园'");
    expect(createSource).toContain('自定义故事类型');
    expect(createSource).toContain('projectCreationSettings');
    expect(createSource).toContain('只需说清楚“谁、发生了什么”');
    expect(createSource).toContain('<AppSidebar');
  });

  it('defines isolated white sidebar and gray canvas scroll regions', () => {
    expect(tokenSource).toMatch(/\.workflow-stage-layout\s*\{[\s\S]*?overflow:\s*hidden;/);
    expect(tokenSource).toMatch(/\.workflow-stage-sidebar\s*\{[\s\S]*?background:\s*var\(--n0\);/);
    expect(tokenSource).toMatch(/\.workflow-stage-canvas\s*\{[\s\S]*?background:\s*var\(--n20\);/);
    expect(tokenSource).toMatch(/\.workflow-stage-scroll\s*\{[\s\S]*?overflow:\s*auto;/);
    expect(tokenSource).toContain('overscroll-behavior: contain');
  });

  it.each([
    ['script', workspaceSource],
    ['design', designSource],
    ['materials', materialSource],
    ['audio', `${audioSource}\n${voiceSidebarSource}\n${dubbingPanelSource}`],
    ['storyboard', storyboardSource],
    ['video', videoSource],
    ['enhance', enhanceSource],
    ['media library', mediaLibrarySource],
  ])('uses the shared sidebar and canvas contract on %s', (_name, pageSource) => {
    expect(pageSource).toContain('workflow-stage-sidebar');
    expect(pageSource).toContain('workflow-stage-canvas');
  });

  it('lets embedded script workspace fill the workflow canvas instead of shrinking to the file sidebar', () => {
    expect(workspaceSource).toContain("layout-safe flex w-full min-w-0 flex-col");
    expect(workspaceSource).toContain("hideHeader ? 'h-full flex-1' : 'h-screen'");
    expect(workspaceSource).toContain('workspace-main relative flex-1 min-w-0 overflow-hidden');
    expect(workspaceSource).toContain('workspace-view-frame flex h-full w-full min-w-0 flex-1 overflow-hidden');
  });
});
