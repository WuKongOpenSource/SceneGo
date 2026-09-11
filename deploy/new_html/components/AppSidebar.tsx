






import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Brush,
  ChevronDown,
  Clock3,
  Coins,
  FolderOpen,
  LayoutGrid,
  Library,
  Loader2,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ScanLine,
  Share2,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { apiFetch, apiJson } from '../services/httpClient';
import { getCreditBalance } from '../services/creditService';
import { clearAccountIdentity, getStoredUsername } from '../services/accountStorage';
import BrandLogo from './BrandLogo';
import { PlatformFooter } from './PlatformFooter';
import { BRAND_NAME, BRAND_PRODUCT_NAME } from '../config/brand';
import { getCurrentAdminSession, type CurrentAdminSession } from '../services/adminAccessService';
import { adminPath } from '../admin/adminRoute';

export interface AppSidebarItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  to?: string;
  end?: boolean;
  onClick?: () => void;
  badge?: React.ReactNode;
}

interface RecentProject {
  project_id: string;
  project_name?: string;
  name?: string;
}

interface RecentEpisode {
  episode_id?: string;
  episodeId?: string;
  id?: string;
}

interface AppSidebarProps {

  exportTo?: string;

  tools?: AppSidebarItem[];
  credits?: number | null;
  className?: string;
}

const RECENT_DOTS = ['#8B6BFF', '#FF9A6B', '#3FCB8F', '#66A0F5'];
export const APP_SIDEBAR_COLLAPSED_STORAGE_KEY = 'ostory:app-sidebar-collapsed';

const itemClass = (active: boolean, collapsed: boolean) =>
  `flex w-full min-w-0 items-center rounded-[10px] py-2.5 text-left text-[13.5px] font-medium transition-colors ${
    collapsed ? 'justify-center px-2' : 'gap-2.5 px-3'
  } ${
    active ? 'bg-primary text-n0' : 'text-n90 hover:bg-n700 hover:text-n0'
  }`;

const sectionLabelClass = 'px-2.5 pb-2 pt-0 font-mono text-[10px] font-bold tracking-[0.14em] text-n400';

export const AppSidebar: React.FC<AppSidebarProps> = ({ exportTo, tools, credits, className = '' }) => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const managed = credits === undefined;
  const [selfCredits, setSelfCredits] = useState<number | null>(null);
  const [projects, setProjects] = useState<RecentProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsLoadError, setProjectsLoadError] = useState(false);
  const [canvasPickerOpen, setCanvasPickerOpen] = useState(false);
  const [openingCanvasProjectId, setOpeningCanvasProjectId] = useState('');
  const [username, setUsername] = useState(() => getStoredUsername('未登录'));
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminSession, setAdminSession] = useState<CurrentAdminSession | null>(null);
  const userRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {

    }
  }, [collapsed]);

  useEffect(() => {
    if (!managed) return;
    let alive = true;
    const refresh = async () => {
      try {
        const balance = await getCreditBalance();
        if (alive) setSelfCredits(balance.available_credits);
      } catch {
        if (alive) setSelfCredits(null);
      }
    };
    void refresh();
    const handleCreditsUpdated = (event: Event) => {
      const raw = (event as CustomEvent<{ balance?: number | null }>).detail?.balance;
      if (typeof raw === 'number' && Number.isFinite(raw)) setSelfCredits(raw);
      else void refresh();
    };
    window.addEventListener('credits:updated', handleCreditsUpdated);
    return () => {
      alive = false;
      window.removeEventListener('credits:updated', handleCreditsUpdated);
    };
  }, [managed]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiJson<{ success?: boolean; projects?: RecentProject[] }>('/api/projects', {}, '最近项目');
        if (alive && Array.isArray(data?.projects)) setProjects(data.projects);
      } catch {
        if (alive) setProjectsLoadError(true);
      } finally {
        if (alive) setProjectsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const syncUsername = () => setUsername(getStoredUsername('未登录'));
    const handlePointerDown = (event: MouseEvent) => {
      if (!userRowRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('account:updated', syncUsername);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('account:updated', syncUsername);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  const handleLogout = useCallback(async () => {
    setMenuOpen(false);
    try {
      await apiFetch('/api/logout', { method: 'POST' }, { apiName: 'logout' });
    } catch (error) {
      console.warn('退出登录请求失败:', error);
    }
    clearAccountIdentity();
    window.location.href = '/login';
  }, []);

  useEffect(() => {
    let alive = true;
    void getCurrentAdminSession().then(session => {
      if (alive) setAdminSession(session);
    });
    return () => { alive = false; };
  }, []);

  const openCanvasForProject = useCallback(async (projectId: string) => {
    if (!projectId || openingCanvasProjectId) return;
    setOpeningCanvasProjectId(projectId);
    try {
      const data = await apiJson<{ episodes?: RecentEpisode[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/episodes`,
        {},
        '最近分集',
      );
      const episode = Array.isArray(data?.episodes) ? data.episodes[0] : undefined;
      const episodeId = episode?.episode_id || episode?.episodeId || episode?.id;
      if (!episodeId) {
        setCanvasPickerOpen(false);
        navigate(`/projects/${projectId}/episodes`);
        return;
      }
      setCanvasPickerOpen(false);
      navigate(`/projects/${projectId}/ep/${episodeId}/canvas`);
    } catch {
      setCanvasPickerOpen(false);
      navigate(`/projects/${projectId}/episodes`);
    } finally {
      setOpeningCanvasProjectId('');
    }
  }, [navigate, openingCanvasProjectId]);

  const defaultTools: AppSidebarItem[] = [
    { key: 'canvas', label: '专业画布', icon: Brush, onClick: () => setCanvasPickerOpen(true) },
    { key: 'media-library', label: '我的素材', icon: Library, to: '/tools/media-library' },
    { key: 'image-upscale', label: '图片高清放大', icon: ScanLine, to: '/tools/image-upscale' },
    { key: 'history', label: '生成历史', icon: Clock3, to: '/tools/history' },
    { key: 'recycle-bin', label: '回收站', icon: Trash2, to: '/tools/recycle-bin' },
  ];
  const visibleTools = tools ?? defaultTools;
  const recent = projects.slice(0, 3);

  const shownCredits = managed ? selfCredits : credits;
  const initial = (username.trim().charAt(0) || 'U').toUpperCase();

  return (
    <>
    <aside
      data-testid="app-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={`relative z-50 min-h-0 shrink-0 flex-col overflow-visible bg-n900 py-4 text-n90 transition-[width,padding] duration-200 flex ${
        collapsed ? 'w-[72px] px-2' : 'w-[230px] px-3'
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => setCollapsed(value => !value)}
        aria-label={collapsed ? '展开左侧导航' : '收起左侧导航'}
        aria-expanded={!collapsed}
        title={collapsed ? '展开左侧导航' : '收起左侧导航'}
        className="absolute -right-3 top-5 z-[60] flex h-7 w-7 items-center justify-center rounded-full border border-n500 bg-n800 text-n100 shadow-atlas transition-colors hover:border-n300 hover:bg-n700 hover:text-n0"
      >
        {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
      </button>


      <button
        type="button"
        onClick={() => navigate('/projects')}
        aria-label={BRAND_PRODUCT_NAME}
        className={`mb-4 flex w-full items-center rounded-[10px] py-1.5 text-left transition-colors hover:bg-n700 ${
          collapsed ? 'justify-center px-1' : 'gap-2.5 px-2'
        }`}
        title={BRAND_PRODUCT_NAME}
      >
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-n0/95 p-1 shadow-glow">
          <BrandLogo variant="mark" className="h-6 w-6" />
        </span>
        {!collapsed && (
          <span className="min-w-0 leading-tight">
            <span className="block truncate font-display text-[15px] font-bold tracking-tight text-n0">{BRAND_NAME}</span>
            <span className="block truncate font-mono text-[10px] uppercase tracking-[0.12em] text-n200">AI 视频创作平台</span>
          </span>
        )}
      </button>


      <NavLink to="/create" aria-label="开始新作品" title="开始新作品" className={({ isActive }) => itemClass(isActive, collapsed)}>
        <Plus size={17} className="shrink-0" />
        {!collapsed && <span className="truncate">开始新作品</span>}
      </NavLink>
      <NavLink to="/projects" end aria-label="我的作品" title="我的作品" className={({ isActive }) => itemClass(isActive, collapsed)}>
        <LayoutGrid size={17} className="shrink-0" />
        {!collapsed && <span className="truncate">我的作品</span>}
      </NavLink>
      {exportTo && (
        <NavLink to={exportTo} aria-label="成片与分享" title="成片与分享" className={({ isActive }) => itemClass(isActive, collapsed)}>
          <Share2 size={17} className="shrink-0" />
          {!collapsed && <span className="truncate">成片与分享</span>}
        </NavLink>
      )}

      <div className="mx-1.5 my-3 h-px bg-n600" />

      <div data-testid="app-sidebar-scroll" className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-thin">

        {recent.length > 0 && (
          <>
            {!collapsed && <div className={sectionLabelClass}>最近作品</div>}
            {recent.map((project, index) => (
              <button
                key={project.project_id}
                type="button"
                onClick={() => navigate(`/projects/${project.project_id}/episodes`)}
                aria-label={project.project_name || project.name || project.project_id}
                title={project.project_name || project.name || project.project_id}
                className={`flex w-full min-w-0 items-center rounded-[9px] py-2 text-left text-[12.5px] text-n70 transition-colors hover:bg-n700 hover:text-n0 ${
                  collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: RECENT_DOTS[index % RECENT_DOTS.length] }}
                />
                {!collapsed && <span className="min-w-0 flex-1 truncate">{project.project_name || project.name || project.project_id}</span>}
              </button>
            ))}
          </>
        )}


        {visibleTools.length > 0 && (
          <>
            {!collapsed && <div className={`${sectionLabelClass} pt-3`}>更多功能</div>}
            {visibleTools.map(item => {
              const Icon = item.icon;
              const isCanvasEntry = item.key === 'canvas';
              const inner = (
                <>
                  <Icon size={16} className="shrink-0" />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                  {!collapsed && item.badge}
                </>
              );
              return item.to && !isCanvasEntry ? (
                <NavLink
                  key={item.key}
                  to={item.to}
                  end={item.end}
                  aria-label={item.label}
                  title={item.label}
                  className={({ isActive }) =>
                    `flex w-full min-w-0 items-center rounded-[9px] py-2 text-left text-[12.5px] transition-colors ${
                      collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'
                    } ${
                      isActive ? 'bg-primary text-n0' : 'text-n70 hover:bg-n700 hover:text-n0'
                    }`
                  }
                >
                  {inner}
                </NavLink>
              ) : (
                <button
                  key={item.key}
                  type="button"
                  onClick={isCanvasEntry ? () => setCanvasPickerOpen(true) : item.onClick}
                  aria-label={item.label}
                  title={item.label}
                  className={`flex w-full min-w-0 items-center rounded-[9px] py-2 text-left text-[12.5px] text-n70 transition-colors hover:bg-n700 hover:text-n0 ${
                    collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'
                  }`}
                >
                  {inner}
                </button>
              );
            })}
          </>
        )}
      </div>


      <PlatformFooter placement="sidebar" collapsed={collapsed} />

      <button
        type="button"
        onClick={() => navigate('/credits')}
        aria-label="查看创作点数明细"
        className={collapsed
          ? 'mb-3 mt-3 flex h-10 w-full shrink-0 items-center justify-center rounded-[10px] border border-n600 bg-n800 text-b200 transition-colors hover:border-n400 hover:bg-n700'
          : 'ui-dark-panel mb-3 mt-3 w-full shrink-0 px-3.5 py-3 text-left transition-colors hover:border-n400'}
        title="查看创作点数明细"
      >
        {collapsed ? <Coins size={18} /> : (
          <>
            <span className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-[0.05em] text-b200">创作点数</span>
              <span className="text-[11px] text-n200">查看明细 →</span>
            </span>
            <span className="mt-1 block font-display text-[22px] font-bold text-n0">
              {typeof shownCredits === 'number' ? shownCredits.toLocaleString() : '—'}
              <span className="ml-1 font-sans text-[13px] font-normal text-n200">可用</span>
            </span>
            <span className="mt-2 block h-1.5 overflow-hidden rounded bg-n600">
              <span
                className="block h-full rounded"
                style={{ width: '80%', background: 'linear-gradient(90deg,#5B49F0,#8B6BFF)' }}
              />
            </span>
          </>
        )}
      </button>


      <div ref={userRowRef} className="relative shrink-0">
        {menuOpen && (
          <div
            role="menu"
            aria-label="账号菜单"
            className={`absolute z-50 overflow-hidden rounded-[10px] border border-n40 bg-n0 py-1 shadow-atlas ${
              collapsed ? 'bottom-0 left-full ml-2 w-48' : 'bottom-full left-0 mb-2 w-full'
            }`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                window.location.href = '/profile';
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-n500 transition-colors hover:bg-n20 hover:text-n800"
            >
              <UserRound size={15} /> 个人中心
            </button>
            {adminSession && (
              <a
                href={adminPath()}
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-n500 transition-colors hover:bg-n20 hover:text-primary"
              >
                <ShieldCheck size={15} /> 管理后台
              </a>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-n500 transition-colors hover:bg-r50 hover:text-danger"
            >
              <LogOut size={15} /> 退出登录
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setMenuOpen(open => !open)}
          className={`flex w-full items-center rounded-[10px] py-1.5 text-left transition-colors hover:bg-n700 ${
            collapsed ? 'justify-center px-1' : 'gap-2.5 px-2'
          }`}
          aria-label={`账户：${username}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={username}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold text-n0"
            style={{ background: 'linear-gradient(135deg,#FF6A3D,#FF9A6B)' }}
          >
            {initial}
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[13px] font-medium text-n0">{username}</span>
                <span className="block truncate text-[11px] text-n200">
                  {adminSession?.role === 'super_admin' ? '超级管理员' : adminSession ? '管理员' : '创作者'}
                </span>
              </span>
              <ChevronDown size={15} className={`shrink-0 text-n200 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </>
          )}
        </button>
      </div>
    </aside>

    {canvasPickerOpen && (
      <div className="app-modal-backdrop fixed inset-0 z-[140] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="关闭项目选择"
          className="absolute inset-0 bg-n900/55"
          onClick={() => !openingCanvasProjectId && setCanvasPickerOpen(false)}
        />
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="canvas-project-picker-title"
          className="app-modal-surface relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-xl"
        >
          <div className="flex items-start gap-3 border-b border-n40 px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
              <Brush size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="canvas-project-picker-title" className="text-base font-bold text-n800">选择专业画布所属项目</h2>
              <p className="mt-1 text-xs leading-5 text-n200">专业画布保存项目内容，请先选择要进入的项目。</p>
            </div>
            <button
              type="button"
              onClick={() => setCanvasPickerOpen(false)}
              disabled={Boolean(openingCanvasProjectId)}
              className="rounded-lg p-1.5 text-n200 hover:bg-n20 hover:text-n700 disabled:opacity-50"
              aria-label="关闭"
            >
              <X size={17} />
            </button>
          </div>

          {projectsLoading ? (
            <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-n200">
              <Loader2 size={17} className="animate-spin" /> 正在加载项目
            </div>
          ) : projectsLoadError ? (
            <div className="px-6 py-10 text-center">
              <div className="text-sm font-semibold text-danger">项目列表暂时无法加载</div>
              <p className="mt-1 text-xs text-n200">请关闭窗口，检查网络后重试。</p>
            </div>
          ) : projects.length > 0 ? (
            <div className="max-h-[420px] space-y-2 overflow-y-auto p-4 scrollbar-atlas">
              {projects.map((project, index) => {
                const projectName = project.project_name || project.name || project.project_id;
                const loading = openingCanvasProjectId === project.project_id;
                return (
                  <button
                    key={project.project_id}
                    type="button"
                    aria-label={`选择项目：${projectName}`}
                    onClick={() => { void openCanvasForProject(project.project_id); }}
                    disabled={Boolean(openingCanvasProjectId)}
                    className="group flex w-full items-center gap-3 rounded-xl border border-n50 bg-n0 px-4 py-3 text-left transition-colors hover:border-b300 hover:bg-primary-light disabled:cursor-wait disabled:opacity-60"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-n20 text-primary group-hover:bg-n0">
                      {loading ? <Loader2 size={17} className="animate-spin" /> : <FolderOpen size={17} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-n700">{projectName}</span>
                      <span className="mt-0.5 block text-[11px] text-n200">{index === 0 ? '最近访问' : '进入该项目的专业画布'}</span>
                    </span>
                    <span className="text-xs font-medium text-primary">选择</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-6 py-10 text-center">
              <FolderOpen size={32} className="mx-auto text-n100" />
              <div className="mt-3 text-sm font-semibold text-n700">请先创建项目</div>
              <p className="mt-1 text-xs text-n200">专业画布需要保存到项目中，其他工具仍可直接使用。</p>
              <button
                type="button"
                onClick={() => {
                  setCanvasPickerOpen(false);
                  navigate('/projects');
                }}
                className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-n0 hover:bg-primary-hover"
              >
                前往创建项目
              </button>
            </div>
          )}
        </section>
      </div>
    )}
    </>
  );
};

export default AppSidebar;
