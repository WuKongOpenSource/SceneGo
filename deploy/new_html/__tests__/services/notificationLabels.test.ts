import { describe, expect, it } from 'vitest';
import type { RegisteredTask } from '../../types';
import { getNotificationModelLabel } from '../../services/notificationLabels';

function task(metadata?: Record<string, unknown>): RegisteredTask {
  return {
    taskId: 'gemini_img_1',
    kind: 'gemini-image',
    title: 'AI 生图任务',
    status: 'completed',
    createdAt: Date.now(),
    targetPage: 'generation',
    metadata,
  };
}

describe('getNotificationModelLabel', () => {
  it('shows the public Gemini model name from runtime metadata', () => {
    expect(getNotificationModelLabel(task({ modelName: 'nanobanana' }))).toBe(
      'Gemini 3.1 Flash Image Preview',
    );
  });

  it('shows the public Gemini model name from persisted task metadata', () => {
    expect(getNotificationModelLabel(task({ model: 'gemini-2.5-flash-image' }))).toBe(
      'Gemini 2.5 Flash Image',
    );
  });

  it('lets legacy tasks without a model use the generic fallback', () => {
    expect(getNotificationModelLabel(task())).toBeUndefined();
  });
});
