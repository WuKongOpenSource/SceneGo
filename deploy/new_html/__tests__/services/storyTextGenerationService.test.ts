import { beforeEach, describe, expect, it, vi } from 'vitest';

const callAI = vi.fn();

vi.mock('../../services/aiService', () => ({
  callAI: (...args: any[]) => callAI(...args),
}));

import {
  generateLyricsFromSummary,
  generateStorySummary,
  normalizeStorySummary,
  sha256Text,
  unicodeLength,
} from '../../services/storyTextGenerationService';
import { AiModel } from '../../types';

describe('story text generation service', () => {
  beforeEach(() => callAI.mockReset());

  it('summarizes the complete source through the existing text task pipeline', async () => {
    const story = `开端-${'情节'.repeat(80)}-最终结局`;
    callAI.mockResolvedValue('故事概要：主角历经冲突后完成使命。');

    await expect(generateStorySummary(story, { episodeId: 'ep-1' }))
      .resolves.toBe('主角历经冲突后完成使命。');
    expect(callAI).toHaveBeenCalledWith(
      AiModel.DeepseekChat,
      expect.any(Object),
      { story },
      undefined,
      { episodeId: 'ep-1' },
    );
  });

  it('normalizes by Unicode code points and never persists more than 100 characters', () => {
    const normalized = normalizeStorySummary(`摘要：${'😀'.repeat(101)}`);
    expect(unicodeLength(normalized)).toBe(100);
    expect(Array.from(normalized).every(value => value === '😀')).toBe(true);
  });

  it('uses text generation for lyrics and rejects empty provider output', async () => {
    callAI.mockResolvedValueOnce('```\n主歌：月光照亮归途\n```');
    await expect(generateLyricsFromSummary('归乡故事')).resolves.toContain('月光照亮归途');
    expect(callAI.mock.calls[0][0]).toBe(AiModel.DeepseekChat);

    callAI.mockResolvedValueOnce('   ');
    await expect(generateLyricsFromSummary('归乡故事')).rejects.toThrow('未返回有效歌词');
  });

  it('computes a stable SHA-256 source identity', async () => {
    await expect(sha256Text('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
