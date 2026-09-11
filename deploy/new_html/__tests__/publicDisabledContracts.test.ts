import { afterEach, expect, it, vi } from 'vitest';
import { submitLocalMiniMaxMusic3, waitForLocalMiniMaxMusic3, cancelLocalMiniMaxMusic3 } from '../public-source/audioGenerationService';
import { submitVoiceTask, submitUpscaleTask, submitInterpolateTask, submitVoiceTaskQueued, submitUpscaleTaskQueued, submitInterpolateTaskQueued } from '../public-source/videoTaskService';

afterEach(() => vi.restoreAllMocks());

it.each([
  ['music submit', () => submitLocalMiniMaxMusic3({ caption: 'test', episodeId: 'ep_test' })],
  ['music wait', () => waitForLocalMiniMaxMusic3('task_test', () => {}, 1000)],
  ['music cancel', () => cancelLocalMiniMaxMusic3('task_test')],
  ['voice', () => submitVoiceTask('image', 'video', 'audio', 'prompt')],
  ['queued voice', () => submitVoiceTaskQueued('image', 'video', 'audio', 'prompt')],
  ['upscale', () => submitUpscaleTask('video', { resolution: '720P' })],
  ['queued upscale', () => submitUpscaleTaskQueued('video', { resolution: '720P' })],
  ['interpolate', () => submitInterpolateTask('video', 60)],
  ['queued interpolate', () => submitInterpolateTaskQueued('video', 60)],
] as const)('rejects disabled %s without network calls or fake task results', async (_name, invoke) => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  await expect(invoke()).rejects.toThrow('本地');
  expect(fetch).not.toHaveBeenCalled();
});
