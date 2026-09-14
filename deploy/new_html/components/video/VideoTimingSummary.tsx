import React from 'react';
import { formatTimingSeconds, type VideoGroupTiming } from '../../utils/videoGroupTiming';

export function VideoTimingSummary({ timing, selectedSeconds }: { timing: VideoGroupTiming; selectedSeconds: number }) {
  const short = timing.targetMs != null && selectedSeconds * 1000 < timing.targetMs;
  return <details className="shrink-0 rounded border border-n40 bg-n20 px-2 py-1 text-[10px] text-n300" data-testid="video-timing-summary">
    <summary className="cursor-pointer">
      脚本 {formatTimingSeconds(timing.plannedMs)} · 配音 {timing.audioMs == null ? '未生成' : formatTimingSeconds(timing.audioMs)} · 校准 {formatTimingSeconds(timing.targetMs)} · 选用 {selectedSeconds}秒
      {short && <span className="ml-1 text-warning">时长不足</span>}
    </summary>
    <div className="mt-1 space-y-1">
      {timing.shots.map(shot => <div key={shot.itemId}>{shot.label}：脚本 {formatTimingSeconds(shot.plannedMs)} / 配音 {shot.audioMs == null ? '未生成' : formatTimingSeconds(shot.audioMs)} / 校准 {formatTimingSeconds(shot.targetMs)}</div>)}
      <p>配音未超脚本时长时保留动作时间；超出时加 0.5 秒动作留白。合并后逐镜头相加；选用时长以当前模型设置为准，受模型支持的范围和档位限制。</p>
      {timing.targetMs == null && <p>部分镜头未提供时长，暂不能计算完整校准时间。</p>}
    </div>
  </details>;
}
