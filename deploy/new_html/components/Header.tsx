
import React, { useState, useCallback, useEffect } from 'react';
import { Sparkles, BookOpen, ScrollText, LayoutDashboard, FileText, Settings, Play, StopCircle, Layers, Image as ImageIcon, Video, ShieldCheck, History, FolderOpen, Coins } from 'lucide-react';
import { AppView, AiModel, TaskNotification } from '../types';
import { NotificationPanel } from './NotificationPanel';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { getCreditBalance } from '../services/creditService';
import {
  DEFAULT_SCRIPT_MODEL_OPTIONS,
  formatScriptModelDisplay,
  getScriptModelOption,
  type ScriptModelOption,
} from '../services/scriptModelCatalogService';
import { BrandLogo } from './BrandLogo';
import AccountMenu from './AccountMenu';
import { getStoredUsername } from '../services/accountStorage';

interface HeaderProps {
  visibleColumns: boolean[];
  onToggleColumn: (index: number) => void;
  onGlobalBatchProcess: () => void;
  onStopProcessing?: () => void;
  isProcessing: boolean;
  fileCount: number;
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  aiModel: AiModel;
  modelOptions?: readonly ScriptModelOption[];
  onChangeModel: (model: AiModel) => void;

  notifications?: TaskNotification[];
  onDismissNotification?: (id: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  visibleColumns,
  onToggleColumn,
  onGlobalBatchProcess,
  onStopProcessing,
  isProcessing,
  fileCount,
  currentView,
  onChangeView,
  aiModel,
  modelOptions = DEFAULT_SCRIPT_MODEL_OPTIONS,
  onChangeModel,
  notifications = [],
  onDismissNotification
}) => {
  const aiModelDisplay = formatScriptModelDisplay(getScriptModelOption(aiModel, modelOptions));

  const username = getStoredUsername('User');
  const isAdmin = username === 'admin' || username === 'lllsdhr';


  const [availableCredits, setAvailableCredits] = useState<number | null>(null);
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

  const navItems = [
    { icon: FileText, label: "文件", index: 0 },
    { icon: BookOpen, label: "阅读", index: 1 },
    { icon: ScrollText, label: "剧本", index: 2 },
    { icon: LayoutDashboard, label: "分镜", index: 3 },
  ];


  const handleNavigateToVideo = () => {
    onChangeView(AppView.Video);
  };

  return (
    <header className="h-14 bg-n0 border-b border-n40 flex items-center px-6 justify-between flex-shrink-0 z-50">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-3">
          <a href="/projects" className="flex items-center gap-1.5 text-n300 hover:text-primary transition-colors" title="返回项目列表">
            <FolderOpen className="w-4 h-4" />
          </a>
          <BrandLogo className="h-7 w-auto max-w-[132px]" />
        </div>


        <div className="flex bg-n20 p-1 rounded-lg border border-n40">
          <button
            onClick={() => onChangeView(AppView.Editor)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all
               ${currentView === AppView.Editor ? 'bg-n0 text-n800 shadow-sm' : 'text-n100 hover:text-n700'}
            `}
          >
            剧本分镜
          </button>
          <button
            onClick={() => onChangeView(AppView.Materials)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all
               ${currentView === AppView.Materials ? 'bg-n0 text-n800 shadow-sm' : 'text-n100 hover:text-n700'}
            `}
          >
            素材绑定
          </button>
          <button
            onClick={() => onChangeView(AppView.Generation)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all
               ${currentView === AppView.Generation ? 'bg-n0 text-n800 shadow-sm' : 'text-n100 hover:text-n700'}
            `}
          >
            画面分镜
          </button>

          <button
            onClick={handleNavigateToVideo}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all
               ${currentView === AppView.Video ? 'bg-n0 text-n800 shadow-sm' : 'text-n100 hover:text-n700'}
            `}
            title="进入视频生成阶段"
          >
            视频生成
          </button>

           <button
             onClick={() => onChangeView(AppView.History)}
             className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2
                ${currentView === AppView.History ? 'bg-n0 text-n800 shadow-sm' : 'text-n100 hover:text-n700'}
             `}
             title="查看视频生成历史记录"
           >
             <History className="w-3.5 h-3.5" />
             历史记录
           </button>
        </div>


        {isAdmin && (
          <button
            onClick={() => onChangeView(AppView.Admin)}
            className={`ml-2 px-3 py-1.5 rounded-md text-xs font-bold transition-all flex items-center gap-2 border
               ${currentView === AppView.Admin
                 ? 'bg-r50 text-danger border-r75'
                 : 'text-n100 hover:text-danger border-n40 hover:border-red-500/30'}
            `}
            title="管理员控制台"
          >
            <ShieldCheck className="w-4 h-4" />
            管理
          </button>
        )}

        {/* Layout Toggles - Only show in Editor view */}
        {currentView === AppView.Editor && (
            <div className="flex items-center gap-2">
            <div className="flex items-center bg-n30 rounded-lg p-1 gap-1 border border-n40">
            <span className="text-xs text-n100 px-2 font-medium">视图:</span>
            {navItems.map((item) => (
                <button
                    key={item.index}
                    onClick={() => onToggleColumn(item.index)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-all ${
                    visibleColumns[item.index]
                        ? 'bg-n0 text-n800 shadow-sm'
                        : 'text-n100 hover:text-n700 hover:bg-n20'
                    }`}
                    title={visibleColumns[item.index] ? `隐藏${item.label}` : `显示${item.label}`}
                >
                    <item.icon className={`w-3.5 h-3.5 ${visibleColumns[item.index] ? 'text-primary' : ''}`} />
                    <span className="hidden lg:inline">{item.label}</span>
                </button>
            ))}
              </div>


              {!visibleColumns.every(v => v) && (
                <button
                  onClick={() => {
                    [0, 1, 2, 3].forEach(i => {
                      if (!visibleColumns[i]) onToggleColumn(i);
                    });
                  }}
                  className="px-2 py-1.5 text-xs text-primary hover:text-primary-hover hover:bg-n30 rounded transition-all"
                  title="显示全部栏目"
                >
                  全部显示
                </button>
              )}
            </div>
        )}

      </div>

      <div className="flex items-center gap-4">
        {currentView === AppView.Editor && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {

                if (window.confirm('确定要开始批量执行吗？\n\n这将会对所有文件执行：\n1. AI改写剧本\n2. 提取分镜\n3. 生成详细分镜\n\n支持多文件批量处理，处理时间可能较长，请确认。')) {
                  onGlobalBatchProcess();
                }
              }}
              disabled={isProcessing || fileCount === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all
                  ${isProcessing || fileCount === 0
                  ? 'bg-n0 text-n100 cursor-not-allowed border border-n40'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-lg shadow-emerald-900/40 border border-emerald-500/50'
                  }`}
            >
              {isProcessing ? (
                  <span className="animate-pulse">批量处理中...</span>
              ) : (
                  <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  批量执行
                  </>
              )}
            </button>


            {isProcessing && onStopProcessing && (
              <button
                onClick={onStopProcessing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all bg-danger hover:bg-red-500 text-white shadow-lg shadow-red-900/40 border border-red-500/50"
              >
                <StopCircle className="w-3.5 h-3.5" />
                停止
              </button>
            )}
          </div>
        )}

        <div className="h-6 w-px bg-n40 mx-2"></div>

        <div className="flex items-center gap-4 text-sm text-n300">

          <WorkspaceSwitcher />

          <button className="p-2 hover:bg-n20 rounded-full transition-colors" title="设置">
              <Settings className="w-4 h-4" />
          </button>


          <NotificationPanel />

          <span className="flex items-center gap-1" title={`当前剧本模型：${aiModelDisplay}`}>
            <Sparkles className="w-3.5 h-3.5 text-warning" />
            <span className="hidden sm:inline text-xs font-medium">
              {aiModelDisplay}
            </span>
          </span>


          <button
            type="button"
            onClick={() => { window.location.href = '/credits'; }}
            className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-n20 transition-colors"
            title="当前可用创作点数，点击查看创作点数明细"
            data-testid="header-credit-balance"
          >
            <Coins className="w-3.5 h-3.5 text-warning" />
            <span className="text-xs font-semibold text-n700">
              {availableCredits === null ? '--' : availableCredits.toLocaleString()}
            </span>
            <span className="hidden sm:inline text-[10px] text-n100">创作点数</span>
          </button>


          <div className="h-6 w-px bg-n40 mx-1"></div>
          <AccountMenu compact />
        </div>
      </div>
    </header>
  );
};
