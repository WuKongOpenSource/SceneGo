import { describe, expect, it } from 'vitest';
import { isCreationCreditShortfall, restoreVideoStatusAfterCreditRejection } from '../../utils/videoSubmissionError';

describe('video credit rejection presentation', () => {
  it.each(['创作点数不足：本次预计需要 315 点', '创作点数不足：Insufficient credits: need 315, available 200',
    'Insufficient credits: need 315, available 200'])('recognizes the local credit rejection: %s', message => {
    expect(isCreationCreditShortfall(new Error(message))).toBe(true);
    expect(isCreationCreditShortfall(message)).toBe(true);
  });
  it.each(['供应商账号积分不足', 'provider insufficient credits', '安全审核失败', 'HTTP 402', undefined])('does not hide unrelated errors: %s', message => {
    expect(isCreationCreditShortfall(message)).toBe(false);
  });
  it('preserves accepted history and selected result exactly', () => {
    const status = { state: 'done' as const, taskId: 'real-task', result: '/original.mp4', videos: ['/original.mp4'],
      videoPrompts: { '/original.mp4': 'original prompt' }, selected: true, isUpscaled: true };
    expect(restoreVideoStatusAfterCreditRejection(status)).toBe(status);
    expect(restoreVideoStatusAfterCreditRejection()).toEqual({ state: 'idle' });
  });
  it('only clears legacy synthetic credit failures, never a provider failure', () => {
    const previous = { state: 'failed' as const, error: '创作点数不足', videos: ['/kept.mp4'], result: '/kept.mp4' };
    expect(restoreVideoStatusAfterCreditRejection(previous)).toMatchObject({ state: 'done', error: undefined, videos: previous.videos, result: previous.result });
    expect(previous.error).toBe('创作点数不足');
    const provider = { state: 'failed' as const, error: '素材审核失败' };
    expect(restoreVideoStatusAfterCreditRejection(provider)).toBe(provider);
  });
});
