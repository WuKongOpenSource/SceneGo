import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTimelineVideoPlayback } from '../../utils/enhanceVideoPlayback';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const video = document.createElement('video');
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 1 },
    duration: { configurable: true, value: 12 },
    paused: { configurable: true, value: true },
  });
  const pause = vi.spyOn(video, 'pause').mockImplementation(() => {});
  const play = vi.spyOn(video, 'play').mockResolvedValue();
  const failed = vi.fn();
  return { video, pause, play, failed, controller: createTimelineVideoPlayback(video, failed) };
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('clip-scoped video playback', () => {
  it('ignores a retired clip rejection while its replacement continues', async () => {
    const old = setup(); const pending = deferred(); old.play.mockReturnValue(pending.promise);
    old.controller.sync({ playing: true, targetTime: 11.9 });
    old.controller.dispose();
    const next = setup(); next.controller.sync({ playing: true, targetTime: 0.1 });
    pending.reject(new DOMException('old source removed', 'NotSupportedError')); await flush();
    expect(old.failed).not.toHaveBeenCalled(); expect(next.failed).not.toHaveBeenCalled();
    expect(next.play).toHaveBeenCalledOnce(); expect(old.pause).toHaveBeenCalled();
  });

  it('retries a normal AbortError without turning off the timeline', async () => {
    const { controller, play, failed } = setup();
    play.mockRejectedValueOnce(new DOMException('interrupted by seek', 'AbortError'));
    controller.sync({ playing: true, targetTime: 0 }); await flush();
    controller.sync({ playing: true, targetTime: 0.1 }); await flush();
    expect(play).toHaveBeenCalledTimes(2); expect(failed).not.toHaveBeenCalled();
  });

  it('waits for metadata, aligns once, and deduplicates pending play calls', async () => {
    const { controller, video, play } = setup(); const pending = deferred(); play.mockReturnValue(pending.promise);
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    controller.sync({ playing: true, targetTime: 2 }); expect(play).not.toHaveBeenCalled();
    Object.defineProperty(video, 'readyState', { value: 1 });
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(2);
    controller.sync({ playing: true, targetTime: 3 });
    video.dispatchEvent(new Event('canplay'));
    expect(video.currentTime).toBe(2); expect(play).toHaveBeenCalledOnce();
    pending.resolve(); await flush();
  });

  it('keeps an explicit pause effective even when an earlier play resolves late', async () => {
    const { controller, play, pause, failed, video } = setup(); const pending = deferred(); play.mockReturnValue(pending.promise);
    controller.sync({ playing: true, targetTime: 3 });
    controller.sync({ playing: false, targetTime: 3.1 }); const count = pause.mock.calls.length;
    pending.resolve(); await flush();
    video.dispatchEvent(new Event('canplay'));
    expect(pause.mock.calls.length).toBeGreaterThan(count); expect(play).toHaveBeenCalledOnce();
    expect(failed).not.toHaveBeenCalled();
  });

  it('does not let a previous play attempt stop a quick pause/resume', async () => {
    const { controller, play, failed } = setup(); const pending = deferred(); play.mockReturnValueOnce(pending.promise);
    controller.sync({ playing: true, targetTime: 0 });
    controller.sync({ playing: false, targetTime: 0.1 });
    controller.sync({ playing: true, targetTime: 0.1 });
    pending.reject(new DOMException('stale', 'NotAllowedError')); await flush();
    expect(play).toHaveBeenCalledTimes(2); expect(failed).not.toHaveBeenCalled();
  });

  it('does not pause a reused element when a retired controller resolves late', async () => {
    const { controller, video, play, pause } = setup(); const pending = deferred();
    play.mockReturnValueOnce(pending.promise);
    controller.sync({ playing: true, targetTime: 0 });
    controller.dispose();
    const replacement = createTimelineVideoPlayback(video, vi.fn());
    replacement.sync({ playing: true, targetTime: 1 });
    const count = pause.mock.calls.length;
    pending.resolve(); await flush();
    expect(pause).toHaveBeenCalledTimes(count);
    replacement.dispose();
  });

  it('reports genuine current failures with no raw server path', async () => {
    const { controller, play, failed } = setup();
    play.mockRejectedValue(new DOMException('/private/media/source.mp4', 'NotSupportedError'));
    controller.sync({ playing: true, targetTime: 0 }); await flush();
    expect(failed).toHaveBeenCalledWith('当前片段暂时无法播放，请检查视频是否可用后重试。');
    controller.dispose();
  });

  it('removes event listeners and prevents playback after leaving a clip', async () => {
    const { controller, video, play, failed } = setup();
    controller.dispose();
    video.dispatchEvent(new Event('loadedmetadata')); video.dispatchEvent(new Event('error'));
    controller.sync({ playing: true, targetTime: 0 }); await flush();
    expect(play).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
});
