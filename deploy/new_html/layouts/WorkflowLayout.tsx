import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PortraitReferenceLegend } from '../components/SeedreamSourceBadge';
import { Outlet, useParams, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Clock, Brush, Library, Coins, Download, ScanLine, Trash2 } from 'lucide-react';
import { EpisodeProvider } from '../contexts/EpisodeContext';
import type { SourcePage } from '../types';
import { TaskBadge } from '../components/TaskBadge';
import { NotificationPanel } from '../components/NotificationPanel';
import { getCreditBalance } from '../services/creditService';
import { apiJson } from '../services/httpClient';
import AppSidebar, { type AppSidebarItem } from '../components/AppSidebar';
import { preloadWorkflowPage } from '../utils/workflowPageImports';

// The four-stage shell is the stable beginner-facing navigation contract.
// Feature pages may evolve independently, but their stage ownership must remain
// explicit so deep links, task notifications, and return navigation stay valid.
interface StageSub {
  path: string;
  label: string;
  sourcePage: SourcePage;
}
const STAGES: { key: string; label: string; hint: string; primary: string; subs: StageSub[] }[] = [
  { key: 'script', label: '写故事', hint: '第 1 步', primary: 'script', subs: [{ path: 'script', label: '故事内容', sourcePage: 'script' }] },
  {
    key: 'art', label: '定角色和场景', hint: '第 2 步', primary: 'design',
    subs: [
      { path: 'design', label: '角色场景', sourcePage: 'design' },
      { path: 'materials', label: '素材绑定', sourcePage: 'materials' },
    ],
  },
  {
    key: 'storyboard', label: '排声音和画面', hint: '第 3 步', primary: 'audio',
    subs: [
      { path: 'audio', label: '声音对白', sourcePage: 'audio' },
      { path: 'storyboard', label: '镜头画面', sourcePage: 'storyboard' },
    ],
  },
  {
    key: 'video', label: '生成短片', hint: '第 4 步', primary: 'video',
    subs: [
      { path: 'video', label: '生成视频', sourcePage: 'video' },
      { path: 'enhance', label: '优化合成', sourcePage: 'enhance' },
      { path: 'final', label: '导出成片', sourcePage: 'final' },
    ],
  },
];

const STANDALONE_UTILITY_PATHS = new Set(['image-upscale', 'history', 'recycle-bin']);

export const WorkflowLayout: React.FC = () => {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState<string>('');

  const refreshCredits = useCallback(async () => {
    try {
      const balance = await getCreditBalance();
      setAvailableCredits(balance.available_credits);
    } catch (error) {
      console.warn('获取用户创作点数失败:', error);
      setAvailableCredits(null);
    }
  }, []);

  useEffect(() => {
    void refreshCredits();
    const intervalId = window.setInterval(() => void refreshCredits(), 60_000);
    const handleCreditsUpdated = (event: Event) => {
      const rawBalance = (event as CustomEvent<{ balance?: number | null }>).detail?.balance;
      if (typeof rawBalance === 'number' && Number.isFinite(rawBalance)) setAvailableCredits(rawBalance);
      else void refreshCredits();
    };
    window.addEventListener('focus', refreshCredits);
    window.addEventListener('credits:updated', handleCreditsUpdated);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshCredits);
      window.removeEventListener('credits:updated', handleCreditsUpdated);
    };
  }, [refreshCredits]);


  useEffect(() => {
    if (!projectId || !episodeId) return;
    let alive = true;
    (async () => {
      try {
        const data = await apiJson<{ success?: boolean; episodes?: any[] }>(`/api/projects/${projectId}/episodes`, {}, '分集信息');
        const row = data?.episodes?.find(e => (e.episode_id ?? e.episodeId) === episodeId);
        if (alive && row) setEpisodeTitle(row.episode_name ?? row.title ?? row.name ?? '');
      } catch {

      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId, episodeId]);

  const segment = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const activeStageIdx = useMemo(() => STAGES.findIndex(stage => stage.subs.some(sub => sub.path === segment)), [segment]);
  const activeStage = activeStageIdx >= 0 ? STAGES[activeStageIdx] : null;
  const activeSubStageIdx = activeStage?.subs.findIndex(sub => sub.path === segment) ?? -1;
  const isStandaloneUtilityPage = STANDALONE_UTILITY_PATHS.has(segment);

  const sidebarTools: AppSidebarItem[] = [
    { key: 'canvas', label: '专业画布', icon: Brush, to: `/projects/${projectId}/ep/${episodeId}/canvas` },
    { key: 'media-library', label: '我的素材', icon: Library, to: '/tools/media-library', badge: <TaskBadge page="media-library" /> },
    { key: 'image-upscale', label: '图片高清放大', icon: ScanLine, to: '/tools/image-upscale', badge: <TaskBadge page="image-upscale" /> },
    { key: 'history', label: '生成历史', icon: Clock, to: '/tools/history', badge: <TaskBadge page="history" /> },
    { key: 'recycle-bin', label: '回收站', icon: Trash2, to: '/tools/recycle-bin' },
  ];

  return (
    <EpisodeProvider key={`${projectId}:${episodeId}`}>
      <div className="workflow-shell layout-safe flex h-screen min-w-0 overflow-hidden bg-n20 text-n800">
        <AppSidebar exportTo="final" tools={sidebarTools} credits={availableCredits} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="workflow-shell-header flex shrink-0 items-center gap-4 border-b border-n40 bg-n20/90 px-5">

            {!isStandaloneUtilityPage && (
              <div className="min-w-[130px] max-w-[210px] shrink-0 leading-tight">
                <div className="truncate font-display text-[15px] font-bold tracking-tight">{episodeTitle || '创作作品'}</div>
                <div className="mt-0.5 truncate text-[11px] text-n200">跟着 4 步完成作品</div>
              </div>
            )}


            {!isStandaloneUtilityPage && (
              <nav
                className="workflow-shell-nav flex min-w-0 flex-1 items-center justify-center overflow-x-auto scrollbar-atlas"
                aria-label="流程化制作导航"
              >
                {STAGES.map((stage, index) => {
                  const done = activeStageIdx >= 0 && index < activeStageIdx;
                  const active = index === activeStageIdx;
                  return (
                    <React.Fragment key={stage.key}>
                      {index > 0 && (
                        <span aria-hidden className={`mx-1 h-0.5 w-8 shrink-0 ${done || active ? 'bg-success' : 'bg-n40'}`} />
                      )}
                      <button
                        type="button"
                        onPointerEnter={() => preloadWorkflowPage(stage.primary)}
                        onFocus={() => preloadWorkflowPage(stage.primary)}
                        onClick={() => navigate(stage.primary)}
                        className="flex shrink-0 items-center gap-2 rounded px-1.5 py-1 transition-opacity hover:opacity-85"
                      >
                        <span
                          className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold transition-all ${
                            active
                              ? 'bg-primary text-n0 ring-4 ring-primary/15'
                              : done
                                ? 'bg-success text-n0'
                                : 'bg-n40 text-n200'
                          }`}
                        >
                          {done ? '✓' : index + 1}
                        </span>
                        <span className="flex flex-col items-start leading-[1.15]">
                          <span
                            className={`whitespace-nowrap font-display text-[12.5px] ${
                              active ? 'font-bold text-n800' : done ? 'font-medium text-n600' : 'font-medium text-n80'
                            }`}
                          >
                            {stage.label}
                          </span>
                          <span className="whitespace-nowrap text-[10px] tracking-[0.03em] text-n80">{stage.hint}</span>
                        </span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </nav>
            )}


            <div className="workflow-shell-account ml-auto flex shrink-0 items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => navigate('/credits')}
                className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-n500 hover:bg-y50 hover:text-warning"
                title="查看我的创作点数"
                aria-label={`可用创作点数：${availableCredits ?? '加载中'}`}
              >
                <Coins className="h-4 w-4 shrink-0 text-warning" />
                <span className="font-mono font-bold tabular-nums">{availableCredits === null ? '--' : availableCredits.toLocaleString()}</span>
              </button>
              <NotificationPanel compact />
              <button
                type="button"
                onClick={() => navigate('final')}
                onPointerEnter={() => preloadWorkflowPage('final')}
                onFocus={() => preloadWorkflowPage('final')}
                className="inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-primary px-3.5 text-xs font-semibold text-n0 shadow-glow transition-colors hover:bg-primary-hover"
              >
                <Download size={13} />
                查看成片
              </button>
            </div>
          </header>


          {activeStage && activeStage.subs.length > 1 && (
            <nav
              className="flex h-14 shrink-0 items-center overflow-x-auto border-b border-n40 bg-n0 px-5 scrollbar-atlas"
              aria-label={`${activeStage.label}阶段步骤`}
            >
              <div className="inline-flex items-center rounded-xl border border-n40 bg-n20/70 p-1 shadow-[0_1px_3px_rgba(20,20,25,0.05)]">
                {activeStage.subs.map((sub, index) => {
                  const done = activeSubStageIdx >= 0 && index < activeSubStageIdx;
                  const active = index === activeSubStageIdx;
                  const subStepNumber = `${activeStageIdx + 1}-${index + 1}`;
                  return (
                    <React.Fragment key={sub.path}>
                      {index > 0 && (
                        <span aria-hidden className={`mx-1 h-px w-5 shrink-0 ${done || active ? 'bg-success/60' : 'bg-n50'}`} />
                      )}
                      <NavLink
                        to={sub.path}
                        onPointerEnter={() => preloadWorkflowPage(sub.path)}
                        onFocus={() => preloadWorkflowPage(sub.path)}
                        aria-current={active ? 'step' : undefined}
                        aria-label={`${sub.label}，第 ${subStepNumber} 步`}
                        className={`group flex h-10 min-w-[132px] shrink-0 items-center gap-2.5 rounded-lg border px-2.5 transition-all ${
                          active
                            ? 'border-primary/25 bg-n0 shadow-[0_2px_8px_rgba(91,73,240,0.12)]'
                            : done
                              ? 'border-transparent bg-transparent hover:border-n40 hover:bg-n0'
                              : 'border-transparent bg-transparent hover:border-n40 hover:bg-n0/80'
                        }`}
                      >
                        <span
                          className={`flex min-w-[40px] shrink-0 items-center justify-center rounded-md px-2 py-1 font-mono text-[11px] font-bold tabular-nums transition-colors ${
                            active
                              ? 'bg-primary text-n0 shadow-glow'
                              : done
                                ? 'bg-success-light text-success'
                                : 'bg-n40 text-n300 group-hover:bg-primary-light group-hover:text-primary'
                          }`}
                        >
                          {subStepNumber}
                        </span>
                        <span className="flex min-w-0 flex-col items-start leading-[1.15]">
                          <span
                            className={`flex items-center whitespace-nowrap font-display text-[12.5px] ${
                              active ? 'font-bold text-n800' : done ? 'font-semibold text-n600' : 'font-medium text-n300'
                            }`}
                          >
                            {sub.label}
                            <TaskBadge page={sub.sourcePage} />
                          </span>
                          <span className={`mt-0.5 whitespace-nowrap text-[9px] tracking-[0.04em] ${active ? 'text-primary' : done ? 'text-success' : 'text-n100'}`}>
                            {active ? '当前步骤' : done ? '已完成' : '下一步'}
                          </span>
                        </span>
                      </NavLink>
                    </React.Fragment>
                  );
                })}
              </div>
              <div className="ml-auto pl-4"><PortraitReferenceLegend /></div>
            </nav>
          )}

          <main className="workflow-shell-workspace layout-safe min-h-0 min-w-0 flex-1 overflow-hidden bg-n20">
            <Outlet />
          </main>
        </div>
      </div>
    </EpisodeProvider>
  );
};
