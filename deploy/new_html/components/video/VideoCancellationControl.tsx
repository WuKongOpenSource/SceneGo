import React, { useState } from 'react';
import { useCancellationSeconds } from '../../hooks/useCancellationSeconds';
import { cancelTask } from '../../services/taskControlService';
import { taskRegistry } from '../../services/taskRegistry';

export function VideoGenerationPhase({ deadline, fallback = '排队中' }: { deadline?: number; fallback?: string }) {
  const seconds = useCancellationSeconds(deadline);
  return <>{deadline ? (seconds > 0 ? `可撤销 · ${seconds} 秒` : '生成中') : fallback}</>;
}

export function VideoCancellationControl({ taskId, deadline, canCancel, onCancelled, onError }: {
  taskId: string; deadline: number; canCancel?: boolean; onCancelled: () => void; onError: (error: string) => void;
}) {
  const seconds = useCancellationSeconds(deadline);
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    if (busy || !seconds || !canCancel) return;
    setBusy(true);
    try { await cancelTask(taskId); taskRegistry.cancel(taskId); onCancelled(); }
    catch (error) { onError(error instanceof Error ? error.message : '取消失败，请刷新任务状态'); }
    finally { setBusy(false); }
  };
  return <div className="shrink-0 flex items-center gap-2 py-1 text-[10px] text-warning">
    {seconds ? `防误点：${seconds} 秒后提交 API` : '生成中，已结束撤销窗口'}
    {seconds > 0 && <button type="button" className="rounded border border-warning/40 px-2 py-1 disabled:opacity-40"
      disabled={busy || !canCancel} onClick={() => void cancel()}>{busy ? '正在取消' : '取消生成'}</button>}
  </div>;
}
