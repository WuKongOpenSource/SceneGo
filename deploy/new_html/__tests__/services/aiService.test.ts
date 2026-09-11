import { beforeEach, describe, expect, it, vi } from 'vitest';

const callMinimaxM3WithRetry = vi.fn();

vi.mock('../../services/minimaxTextService', () => ({
  callMinimaxM3WithRetry: (...args: any[]) => callMinimaxM3WithRetry(...args),
}));
vi.mock('../../services/deepseekService', () => ({
  callDeepseekWithRetry: vi.fn(),
  callDeepseekChatWithRetry: vi.fn(),
}));
vi.mock('../../services/geminiProxyService', () => ({
  callGeminiProxyWithRetry: vi.fn(),
}));

import { callAI } from '../../services/aiService';
import { AiModel } from '../../types';

describe('aiService MiniMax dispatch', () => {
  beforeEach(() => {
    callMinimaxM3WithRetry.mockReset();
    callMinimaxM3WithRetry.mockResolvedValue('m3 result');
  });

  it('routes the MiniMax selector through M3 with the existing task context', async () => {
    const onStream = vi.fn();
    const taskContext = {
      operation: 'storyboard_script_generate',
      displayName: '分镜脚本生成',
    };

    await expect(callAI(
      AiModel.MinimaxM3,
      { system: 'system', user: 'hello {name}' },
      { name: 'Sample Project' },
      onStream,
      taskContext,
    )).resolves.toBe('m3 result');

    expect(callMinimaxM3WithRetry).toHaveBeenCalledWith(
      'hello Sample Project',
      'system',
      onStream,
      taskContext,
    );
  });
});
