export interface TimelineVideoPlaybackState {
  playing: boolean;
  targetTime: number;
}

/** Own one mounted video. A retired element must never stop a newer timeline clip. */
export function createTimelineVideoPlayback(video: HTMLVideoElement, onFailure: (message: string) => void) {
  let state: TimelineVideoPlaybackState = { playing: false, targetTime: 0 };
  let disposed = false;
  let generation = 0;
  let pending: symbol | null = null;
  let aligned = false;
  let failureReported = false;

  const fail = (message: string) => {
    if (disposed || !state.playing || failureReported) return;
    failureReported = true;
    onFailure(message);
  };
  const apply = () => {
    if (disposed) return;
    // Wait for metadata before seeking/playing: a late metadata seek can abort play().
    if (video.readyState < 1) return;
    const target = Math.max(0, Number.isFinite(state.targetTime) ? state.targetTime : 0);
    const clamped = Number.isFinite(video.duration)
      ? Math.min(target, Math.max(0, video.duration - 0.05)) : target;
    if (!aligned || !state.playing || (!pending && Math.abs(video.currentTime - clamped) > 0.75)) {
      try { video.currentTime = clamped; aligned = true; } catch { return; }
    }
    if (!state.playing || !video.paused || pending) return;
    const request = Symbol('play');
    const requestGeneration = generation;
    pending = request;
    const rejected = (error: unknown) => {
      if (disposed || requestGeneration !== generation || !state.playing) return;
      // Source changes, seeks and pause() normally reject an outstanding play with AbortError.
      if ((error as { name?: string } | null)?.name === 'AbortError') return;
      fail((error as { name?: string } | null)?.name === 'NotAllowedError'
        ? '浏览器暂未允许播放，请再次点击播放。'
        : '当前片段暂时无法播放，请检查视频是否可用后重试。');
    };
    try {
      void Promise.resolve(video.play()).then(() => {
        if (!disposed && !state.playing) video.pause();
      }, rejected).finally(() => { if (pending === request) pending = null; });
    } catch (error) {
      rejected(error);
      if (pending === request) pending = null;
    }
  };
  const onMediaError = () => fail('当前片段加载失败，请检查网络或视频是否可用后重试。');
  video.addEventListener('loadedmetadata', apply);
  video.addEventListener('canplay', apply);
  video.addEventListener('error', onMediaError);
  return {
    sync(next: TimelineVideoPlaybackState) {
      if (disposed) return;
      const wasPlaying = state.playing;
      state = next;
      if (!state.playing) {
        if (wasPlaying) { generation += 1; pending = null; }
        video.pause();
        failureReported = false;
      }
      apply();
    },
    dispose() {
      disposed = true;
      generation += 1;
      pending = null;
      video.removeEventListener('loadedmetadata', apply);
      video.removeEventListener('canplay', apply);
      video.removeEventListener('error', onMediaError);
      video.pause();
    },
  };
}
