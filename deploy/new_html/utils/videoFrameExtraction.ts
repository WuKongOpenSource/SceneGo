export type VideoFramePosition = 'first' | 'current' | 'last';

const LAST_FRAME_EPSILON_SECONDS = 0.05;

export function resolveVideoFrameTime(
  position: VideoFramePosition,
  currentTime: number,
  duration: number,
): number {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrent = Number.isFinite(currentTime) ? currentTime : 0;

  if (position === 'first') return 0;
  if (position === 'last') return Math.max(0, safeDuration - LAST_FRAME_EPSILON_SECONDS);
  return Math.min(Math.max(0, safeCurrent), safeDuration || Math.max(0, safeCurrent));
}

export function getVideoFrameLabel(position: VideoFramePosition): string {
  if (position === 'first') return '首帧';
  if (position === 'last') return '尾帧';
  return '当前帧';
}
