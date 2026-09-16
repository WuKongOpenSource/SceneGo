import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins } from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import AppSidebar from '../components/AppSidebar';
import { NotificationPanel } from '../components/NotificationPanel';
import { getCreditBalance } from '../services/creditService';
import { PortraitReferenceLegend } from '../components/SeedreamSourceBadge';

const TOOL_TITLES: Record<string, string> = {
  'media-library': '我的素材',
  'image-upscale': '图片高清放大',
  history: '生成历史',
  'recycle-bin': '回收站',
  help: '帮助文档中心',
};


export const GlobalToolsLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [availableCredits, setAvailableCredits] = useState<number | null>(null);

  const refreshCredits = useCallback(async () => {
    try {
      const balance = await getCreditBalance();
      setAvailableCredits(balance.available_credits);
    } catch {
      setAvailableCredits(null);
    }
  }, []);

  useEffect(() => {
    void refreshCredits();
    const handleCreditsUpdated = (event: Event) => {
      const balance = (event as CustomEvent<{ balance?: number | null }>).detail?.balance;
      if (typeof balance === 'number' && Number.isFinite(balance)) setAvailableCredits(balance);
      else void refreshCredits();
    };
    window.addEventListener('credits:updated', handleCreditsUpdated);
    return () => window.removeEventListener('credits:updated', handleCreditsUpdated);
  }, [refreshCredits]);

  const title = useMemo(() => {
    const segment = location.pathname.split('/').filter(Boolean)[1] || '';
    return TOOL_TITLES[segment] || '更多功能';
  }, [location.pathname]);

  return (
    <div className="layout-safe flex h-screen min-w-0 overflow-hidden bg-n20 text-n800">
      <AppSidebar credits={availableCredits} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-n40 bg-n0 px-5">
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="text-xs font-medium text-n300 hover:text-n800"
          >
            ← 返回项目
          </button>
          <span className="h-5 w-px bg-n50" />
          <h1 className="font-display text-sm font-bold text-n800">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            <PortraitReferenceLegend />
            <button
              type="button"
              onClick={() => navigate('/credits')}
              className="inline-flex h-8 items-center gap-1.5 rounded px-2 text-xs font-medium text-n500 hover:bg-y50 hover:text-warning"
              aria-label={`可用创作点数：${availableCredits ?? '加载中'}`}
            >
              <Coins className="h-4 w-4 text-warning" />
              <span className="font-mono font-bold tabular-nums">
                {availableCredits === null ? '--' : availableCredits.toLocaleString()}
              </span>
            </button>
            <NotificationPanel compact />
          </div>
        </header>
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-n20">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default GlobalToolsLayout;
