




import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import type { WorkspaceSession } from '../../services/videoWorkspaceService';

export type SyncMode = 'add_new' | 'overwrite_unmodified' | 'full_reset';

export interface StoryboardSyncModalProps {
    open: boolean;
    onClose: () => void;
    storyboardItems: any[];
    session: WorkspaceSession;
    onApply: (mode: SyncMode) => void | Promise<void>;
}

export const StoryboardSyncModal: React.FC<StoryboardSyncModalProps> = (p) => {
    const stats = useMemo(() => {
        const sbIds = new Set(
            p.storyboardItems.map(s => (s as any).item_id ?? (s as any).itemId).filter(Boolean)
        );
        const wsIds = new Set(
            (p.session.uploaded_images || []).map(i => i.storyboardItemId).filter(Boolean)
        );
        const newOnSb = [...sbIds].filter(id => !wsIds.has(id as string));
        const cardModified = (p.session.task_groups || []).filter(g =>
            g.durationUserOverride
            || (p.session.seedance_params?.[g.uuid]?.media_inputs?.length || 0) > 1
        );
        const modifiedSinceSync = p.storyboardItems.filter(s => {
            const itemId = (s as any).item_id ?? (s as any).itemId;
            const m = itemId ? p.session.storyboard_meta?.[itemId] : undefined;
            if (!m?.lastSyncedAt) return false;
            const updatedAt = (s as any).updated_at ?? (s as any).updatedAt;
            if (!updatedAt) return false;
            const t = new Date(updatedAt).getTime();
            return Number.isFinite(t) && t > m.lastSyncedAt;
        });
        return {
            new: newOnSb.length,
            modifiedSinceSync: modifiedSinceSync.length,
            cardModified: cardModified.length,
        };
    }, [p.storyboardItems, p.session]);

    if (!p.open) return null;

    return (
        <div
            className="app-modal-backdrop fixed inset-0 z-50 bg-n900/50 flex items-center justify-center"
            onClick={p.onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="同步分镜"
                className="app-modal-surface w-[480px] bg-n0 border border-n40 rounded-md shadow-bottom overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-3 py-2 border-b border-n40">
                    <div className="text-sm text-n800">同步分镜</div>
                    <button
                        type="button"
                        onClick={p.onClose}
                        className="p-1 text-n300 hover:text-n700"
                        aria-label="关闭"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className="p-3 space-y-2 text-xs text-n700">
                    <div>新分镜：<span className="text-success">{stats.new}</span></div>
                    <div>分镜端有修改：<span className="text-warning">{stats.modifiedSinceSync}</span></div>
                    <div>卡片端已编辑：<span className="text-danger">{stats.cardModified}</span></div>
                </div>
                <div className="px-3 pb-3 space-y-1 text-xs">
                    <button
                        type="button"
                        onClick={() => p.onApply('add_new')}
                        className="w-full text-left px-2 py-1.5 bg-n0 hover:bg-n20 rounded text-n800"
                    >
                        仅添加 {stats.new} 个新分镜
                    </button>
                    <button
                        type="button"
                        onClick={() => p.onApply('overwrite_unmodified')}
                        className="w-full text-left px-2 py-1.5 bg-n0 hover:bg-n20 rounded text-n800"
                    >
                        覆盖未修改的（保留卡片端 {stats.cardModified} 处编辑）
                    </button>
                    <button
                        type="button"
                        onClick={() => p.onApply('full_reset')}
                        className="w-full text-left px-2 py-1.5 bg-danger hover:bg-danger rounded text-white"
                    >
                        ⚠ 全量重置（丢弃所有卡片端编辑）
                    </button>
                </div>
            </div>
        </div>
    );
};
