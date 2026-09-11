






import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Bell, X, CheckCircle, AlertCircle, Loader2, Clock,
    Image as ImageIcon, Video, Mic, Sparkles, FileText,
    LayoutGrid, Palette, Wand2, RotateCw,
} from 'lucide-react';
import { useTaskManager } from '../contexts/TaskContext';
import type { RegisteredTask, TaskKind } from '../types';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';
import { formatPublicTaskText } from '../utils/publicTaskTerminology';
import { getModelDisplayName } from '../services/videoModelService';
import { buildNotificationTargetUrl } from '../services/notificationNavigation';
import { getNotificationModelLabel } from '../services/notificationLabels';


const STATUS_THEME = {
    running:   { bg: 'bg-b50',    text: 'text-b400',    border: 'border-b75',    dot: 'bg-b400' },
    pending:   { bg: 'bg-b50',    text: 'text-b400', border: 'border-b75',    dot: 'bg-b400' },
    queued:    { bg: 'bg-warning/15',   text: 'text-warning',   border: 'border-warning/40',   dot: 'bg-warning' },
    completed: { bg: 'bg-success/15', text: 'text-success', border: 'border-success/40', dot: 'bg-success' },
    failed:    { bg: 'bg-r50',    text: 'text-danger',    border: 'border-danger/40',    dot: 'bg-danger' },
    cancelled: { bg: 'bg-n30',   text: 'text-n300',   border: 'border-n40',   dot: 'bg-n100' },
} as const;


const KIND_ICON: Record<string, React.FC<{ size?: number; className?: string }>> = {
    seedance: Video, 'seedance-fast': Video, 'seedance-mini': Video, 'seedance-1.5': Video,
    wan2: Video, 'wan2-fast': Video, kling: Video, vidu: Video, happyhorse: Video, sora2: Video, veo: Video,
    'video-i2v': Video, 'video-comfy': Video,
    'comfyui-image': ImageIcon, 'gemini-image': ImageIcon, 'doubao-image': ImageIcon,
    nanobanana: ImageIcon, doubao: ImageIcon, 'qwen-image': ImageIcon, 'qwen-lora': ImageIcon, kontext: ImageIcon,
    matting: Wand2, 'angle-adjust': RotateCw,
    'human-multi-angle': RotateCw, 'around-angle': RotateCw,
    'image-fusion': Sparkles, 'panorama-360': Sparkles, 'panorama-fusion': Sparkles,
    'image-upscale': ImageIcon,
    'auto-storyboard': LayoutGrid, 'multi-grid-storyboard': LayoutGrid,
    'minimax-tts': Mic, 'gemini-tts': Mic, 'audio-mix': Mic,
    'video-enhance': Sparkles, 'video-upscale': Sparkles,
    'video-voice': Mic, 'video-edit': Video, 'video-crop': Video,
    'prompt-rewrite': FileText, 'script-segment': FileText,
    other: Sparkles,
};

function getKindIcon(kind: TaskKind): React.FC<{ size?: number; className?: string }> {
    return KIND_ICON[kind] || KIND_ICON.other;
}


const KIND_LABEL: Record<string, string> = {
    seedance: getModelDisplayName('Seedance2'),
    'seedance-fast': getModelDisplayName('Seedance2Fast'),
    'seedance-mini': getModelDisplayName('Seedance2Mini'),
    'seedance-1.5': getModelDisplayName('Seedance15'),
    wan2: 'Wan 2.2 · 本地节点模型', 'wan2-fast': 'Wan 2.2 · 本地节点模型',
    kling: getModelDisplayName('Kling'),
    vidu: getModelDisplayName('Vidu'),
    happyhorse: getModelDisplayName('HappyHorse'),
    sora2: getModelDisplayName('Sora2'),
    veo: getModelDisplayName('Veo'),
    'video-i2v': '图生视频', 'video-comfy': '节点视频任务',
    'comfyui-image': '节点图片', 'gemini-image': 'Gemini 生图', 'doubao-image': 'Doubao Seedream 5.0 Lite · 参考图',
    nanobanana: 'Gemini 3.1 Flash · 快速', doubao: 'Doubao-Seedream-5.0-lite · 参考优先', 'qwen-image': 'Qwen Image Edit 2509 · 多参考', 'qwen-lora': 'Qwen 2509 + LoRA · 风格', kontext: 'Kontext v2 · 高质量',
    matting: '抠图', 'angle-adjust': '角度调整',
    'human-multi-angle': '多角度', 'around-angle': '环绕镜头',
    'image-fusion': '图像融合', 'panorama-360': '全景 360', 'panorama-fusion': '全景融合',
    'image-upscale': '图片高清放大',
    'auto-storyboard': '自动分镜', 'multi-grid-storyboard': '九宫格',
    'minimax-tts': '配音', 'gemini-tts': '配音', 'audio-mix': '混音',
    'video-enhance': '视频增强', 'video-upscale': '画质提升',
    'video-voice': '配音', 'video-edit': '视频编辑', 'video-crop': '视频裁剪',
    'prompt-rewrite': '提示词改写', 'script-segment': '剧本分镜',
    other: '任务',
};


function fmtRelative(ms: number): string {
    const dt = Date.now() - ms;
    if (dt < 0) return '刚刚';
    if (dt < 60_000) return '刚刚';
    if (dt < 3_600_000) return `${Math.floor(dt / 60_000)} 分钟前`;
    if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)} 小时前`;
    return `${Math.floor(dt / 86_400_000)} 天前`;
}


function statusLabel(t: RegisteredTask): string {
    if (t.status === 'pending') return '待执行';
    if (t.status === 'queued') return t.queuePosition ? `排队中 · 前面 ${t.queuePosition} 个` : '排队中';
    if (t.status === 'running') {
        if (t.progress != null) return `执行中 · ${Math.round(t.progress * 100)}%`;
        return '执行中';
    }
    if (t.status === 'completed') return '已完成';
    if (t.status === 'failed') return '失败';
    if (t.status === 'cancelled') return '已取消';
    return '';
}



export interface NotificationPanelProps {

    triggerClassName?: string;

    compact?: boolean;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({ triggerClassName, compact }) => {
    const {
        registeredTasks,
        unreadCount,
        markAllRead,
        refreshNotifications,
        removeTask,
        cancelTask,
    } = useTaskManager();
    const navigate = useNavigate();
    const location = useLocation();
    const [open, setOpen] = useState(false);
    const [cancelMessage, setCancelMessage] = useState('');
    const handleCancel = useCallback(async (taskId: string) => {
        setCancelMessage('');
        try {
            setCancelMessage(await cancelTask(taskId));
        } catch (error) {
            setCancelMessage(error instanceof Error ? error.message : '取消失败，请重试');
        }
    }, [cancelTask]);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

    const computeMenuPos = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setMenuPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    }, []);


    const { running, completed, failed, totalActive } = useMemo(() => {
        const running: RegisteredTask[] = [];
        const completed: RegisteredTask[] = [];
        const failed: RegisteredTask[] = [];
        for (const t of registeredTasks) {
            if (t.status === 'pending' || t.status === 'queued' || t.status === 'running') running.push(t);
            else if (t.status === 'completed' || t.status === 'cancelled') completed.push(t);
            else if (t.status === 'failed') failed.push(t);

        }
        return {
            running,
            completed: completed.slice(0, 10),
            failed: failed.slice(0, 5),
            totalActive: running.length,
        };
    }, [registeredTasks]);


    useEffect(() => {
        if (!open) return;
        function onDown(e: MouseEvent) {
            if (panelRef.current?.contains(e.target as Node)) return;
            if (triggerRef.current?.contains(e.target as Node)) return;
            setOpen(false);
        }
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);


    useEffect(() => {
        if (!open) return;
        function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);


    useEffect(() => {
        if (!open) return;
        const update = () => computeMenuPos();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open, computeMenuPos]);

    const handleToggle = useCallback(() => {
        setOpen(prev => {
            const next = !prev;
            if (next) {
                computeMenuPos();
                void refreshNotifications();
                if (unreadCount > 0) markAllRead();
            }
            return next;
        });
    }, [unreadCount, markAllRead, refreshNotifications, computeMenuPos]);

    const handleNavigate = useCallback((task: RegisteredTask) => {
        const url = buildNotificationTargetUrl(task);
        const currentUrl = `${location.pathname}${location.search}`;
        if (url && url !== currentUrl) navigate(url);
        setOpen(false);
    }, [navigate, location.pathname, location.search]);

    const triggerCls = triggerClassName
        || `relative inline-flex items-center justify-center ${compact ? 'p-1.5' : 'p-2'} rounded-md text-n300 hover:text-n800 hover:bg-n20 transition-all duration-200`;

    return (
        <div className="relative">
            <button
                ref={triggerRef}
                onClick={handleToggle}
                className={`group ${triggerCls}`}
                title={unreadCount > 0 ? `任务通知，${unreadCount} 条新消息` : (totalActive > 0 ? `${totalActive} 个任务运行中` : '任务通知')}
                aria-label={unreadCount > 0 ? `任务通知，${unreadCount} 条新消息` : (totalActive > 0 ? `${totalActive} 个任务运行中` : '任务通知')}
                aria-haspopup="dialog"
                aria-expanded={open}
            >

                <Bell
                    size={compact ? 14 : 16}
                    className="transition-transform duration-150 group-hover:-rotate-12"
                />

                {totalActive > 0 && (
                    <span className="absolute inset-0 rounded-md ring-1 ring-b400/30 animate-pulse motion-reduce:hidden pointer-events-none" />
                )}

                {unreadCount > 0 ? (
                    <span className={`absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 ${failed.length > 0 ? 'bg-danger' : 'bg-success'} rounded-full flex items-center justify-center text-[9px] font-bold text-white tabular-nums`}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                ) : null}
            </button>


            {open && menuPos && ReactDOM.createPortal(
                <div
                    ref={panelRef}
                    role="dialog"
                    aria-label="任务通知面板"
                    className="fixed w-[400px] max-h-[70vh] overflow-hidden bg-n0 border border-n40 rounded-md shadow-bottom z-[9000] flex flex-col"
                    style={{ top: menuPos.top, right: menuPos.right, animationName: 'panelFadeIn', animationDuration: '160ms', animationTimingFunction: 'cubic-bezier(0.2, 0.9, 0.3, 1)' }}
                >
                    {/* Header */}
                    <div className="flex items-center px-4 py-3 border-b border-n40">
                        <span className="text-sm font-semibold text-n800">任务通知</span>
                        <span className="ml-2 text-xs text-n100 tabular-nums">
                            {totalActive > 0 ? `${totalActive} 个运行中` : '空闲'}
                        </span>
                        <span className="flex-1" />
                        <button
                            onClick={() => setOpen(false)}
                            className="p-1 rounded hover:bg-n20 text-n300 hover:text-n800 transition-colors"
                            aria-label="关闭"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    {/* Body */}
                    {cancelMessage && <div role="status" className="mx-3 my-2 rounded-lg bg-n30 px-3 py-2 text-xs text-n800">{cancelMessage}</div>}
                    <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-n40">
                        {totalActive === 0 && completed.length === 0 && failed.length === 0 ? (
                            <EmptyState />
                        ) : (
                            <>
                                {running.length > 0 && (
                                    <Section
                                        title="正在运行"
                                        count={running.length}
                                        items={running}
                                        onNavigate={handleNavigate}
                                        onRemove={handleCancel}
                                        removeLabel="取消排队并退还积分"
                                        removeIconKind="cancel"
                                    />
                                )}
                                {completed.length > 0 && (
                                    <Section
                                        title="最近结束"
                                        count={completed.length}
                                        items={completed}
                                        onNavigate={handleNavigate}
                                        onRemove={removeTask}
                                        removeLabel="关闭"
                                        removeIconKind="dismiss"
                                    />
                                )}
                                {failed.length > 0 && (
                                    <Section
                                        title="失败"
                                        count={failed.length}
                                        items={failed}
                                        onNavigate={handleNavigate}
                                        onRemove={removeTask}
                                        removeLabel="关闭"
                                        removeIconKind="dismiss"
                                    />
                                )}
                            </>
                        )}
                    </div>

                    {/* Footer */}
                    {(running.length + completed.length + failed.length) > 0 && (
                        <div className="px-4 py-2 border-t border-n40 text-xs text-n100 tabular-nums">
                            共 {running.length + completed.length + failed.length} 项
                        </div>
                    )}
                </div>,
                document.body,
            )}
        </div>
    );
};



interface SectionProps {
    title: string;
    count: number;
    items: RegisteredTask[];
    onNavigate: (t: RegisteredTask) => void;
    onRemove: (id: string) => void;
    removeLabel: string;
    removeIconKind: 'dismiss' | 'cancel';
}

const Section: React.FC<SectionProps> = ({ title, count, items, onNavigate, onRemove, removeLabel, removeIconKind }) => (
    <div>
        <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-n100 bg-n30 border-b border-n40">
            {title} <span className="ml-1 text-n100 tabular-nums">· {count}</span>
        </div>
        <ul role="list" className="divide-y divide-n40">
            {items.map((t, i) => (
                <li
                    key={t.taskId}
                    className="group"
                    style={{
                        animation: 'taskItemEnter 240ms cubic-bezier(0.2, 0.9, 0.3, 1) backwards',
                        animationDelay: `${Math.min(i, 4) * 35}ms`,
                    }}
                >
                    <TaskItem
                        task={t}
                        onNavigate={() => onNavigate(t)}
                        onRemove={() => onRemove(t.taskId)}
                        removeLabel={removeLabel}
                        removeIconKind={removeIconKind}
                    />
                </li>
            ))}
        </ul>
    </div>
);

interface TaskItemProps {
    task: RegisteredTask;
    onNavigate: () => void;
    onRemove: () => void;
    removeLabel: string;
    removeIconKind: 'dismiss' | 'cancel';
}

const TaskItem: React.FC<TaskItemProps> = ({ task, onNavigate, onRemove, removeLabel, removeIconKind }) => {
    const canCancel = task.metadata?.canCancel ?? (task.status === 'pending' || task.status === 'queued');
    const cancelling = task.metadata?.cancelPending === true;
    const theme = STATUS_THEME[task.status] || STATUS_THEME.queued;
    const KindIcon = getKindIcon(task.kind);
    const kindLabel = getNotificationModelLabel(task) || KIND_LABEL[task.kind] || task.kind;
    const statusText = statusLabel(task);

    return (
        <div
            onClick={onNavigate}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') onNavigate(); }}
            className="flex items-start gap-3 px-4 py-3 hover:bg-n20 cursor-pointer transition-colors"
        >
            {/* Status icon */}
            <div className="mt-0.5 shrink-0">
                {task.status === 'running' && <Loader2 size={14} className="text-b400 animate-spin motion-reduce:animate-none" />}
                {(task.status === 'pending' || task.status === 'queued') && <Clock size={14} className="text-warning" />}
                {task.status === 'completed' && <CheckCircle size={14} className="text-success" />}
                {task.status === 'failed' && <AlertCircle size={14} className="text-danger" />}
                {task.status === 'cancelled' && <X size={14} className="text-n300" />}
            </div>

            <div className="flex-1 min-w-0">
                {/* Title row */}
                <div className="flex items-center gap-1.5">
                    <KindIcon size={11} className="text-n300 shrink-0" />
                    <span className="text-sm font-medium text-n800 truncate">{sanitizeProcessingTerminology(formatPublicTaskText(task.title, task.kind))}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] tabular-nums ${theme.bg} ${theme.text} ${theme.border} border`}>
                        {sanitizeProcessingTerminology(kindLabel)}
                    </span>
                </div>

                {/* Status + progress */}
                <div className="mt-1 flex items-center gap-2">
                    <span className={`text-xs ${theme.text}`}>{statusText}</span>
                    {task.error && (
                        <span className="text-xs text-danger truncate">· {sanitizeProcessingTerminology(formatPublicTaskText(task.error, task.kind))}</span>
                    )}
                </div>

                {/* Progress bar */}
                {task.status === 'running' && task.progress != null && (
                    <div className="mt-1.5 h-1 bg-n30 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-b400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(0, task.progress * 100))}%` }}
                        />
                    </div>
                )}


                {task.metadata && (() => {
                    const stage = task.metadata.stage as string | undefined;
                    const step = task.metadata.step as number | undefined;
                    const totalSteps = task.metadata.totalSteps as number | undefined;
                    const eta = task.metadata.etaSeconds as number | undefined;
                    const worker = task.metadata.workerNodeId as string | undefined;
                    if (!stage && step == null && eta == null && !worker) return null;
                    return (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-n300">
                            {stage && <span className="truncate max-w-[220px]">{stage}</span>}
                            {step != null && totalSteps != null && (
                                <span className="tabular-nums text-n100">{step}/{totalSteps} 步</span>
                            )}
                            {eta != null && eta > 0 && (
                                <span className="tabular-nums text-n100">
                                    剩 {eta < 60 ? `${eta}s` : `${Math.round(eta / 60)}m`}
                                </span>
                            )}
                            {worker && <span className="text-n100 truncate max-w-[80px]">@{worker}</span>}
                        </div>
                    );
                })()}

                {/* Time + actions */}
                <div className="mt-1 flex items-center text-[10px] text-n100">
                    <span className="tabular-nums">{fmtRelative(task.completedAt || task.startedAt || task.createdAt)}</span>

                    <button
                        onClick={e => { e.stopPropagation(); onRemove(); }}
                        disabled={cancelling || (removeIconKind === 'cancel' && !canCancel)}
                        title={removeIconKind === 'cancel' ? (canCancel ? '取消尚未提交的任务，退还本次预扣积分' : '任务已提交执行，无法取消') : removeLabel}
                        className="ml-auto px-2 py-1 text-n500 hover:text-n800 hover:bg-n20 rounded transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        aria-label={removeLabel}
                    >
                        {removeIconKind === 'cancel' ? (cancelling ? '取消中…' : '取消排队') : '关闭'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const EmptyState: React.FC = () => (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="w-10 h-10 rounded-full bg-n30 flex items-center justify-center mb-3">
            <Bell size={16} className="text-n300" />
        </div>
        <div className="text-sm text-n700 mb-1">还没有任务</div>
        <div className="text-xs text-n100">提交生成任务后这里会显示进度</div>
    </div>
);



if (typeof document !== 'undefined' && !document.getElementById('notification-panel-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-panel-styles';
    style.textContent = `
@keyframes panelFadeIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes taskItemEnter {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
    [style*="taskItemEnter"], [style*="panelFadeIn"] { animation: none !important; }
}
`;
    document.head.appendChild(style);
}
