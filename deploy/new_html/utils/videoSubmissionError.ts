import type { TaskStatus } from '../services/videoTaskTypes';

/** A local credit preflight rejection never represents a provider generation. */
export function isCreationCreditShortfall(error: unknown): boolean {
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  return message.includes('创作点数不足')
    || /Insufficient credits: need \d+, available \d+/i.test(message);
}

export function restoreVideoStatusAfterCreditRejection(previous?: TaskStatus): TaskStatus {
  if (!previous) return { state: 'idle' };
  // Older clients persisted preflight rejections as failed generations. Clear
  // only that synthetic error, retaining actual task history and chosen media.
  if (previous.state === 'failed' && isCreationCreditShortfall(previous.error)) {
    return { ...previous, state: previous.result || previous.videos?.length ? 'done' : 'idle',
      error: undefined, pendingVideoPrompt: undefined, pendingVideoModel: undefined };
  }
  return previous;
}
