import { describe, expect, it } from 'vitest';
import {
  apiConfigErrorMessage,
  apiConfigCategories,
  bindingsForCategory,
  providerAccessModeForEndpoint,
} from '../../utils/apiConfigPresentation';

const minimaxBindings = [
  { operation: 'hailuo', label: '金丹 (Hailuo 2.3)', model_name: 'MiniMax-Hailuo-2.3' },
  { operation: 'hailuo-fast', label: '金丹 Fast', model_name: 'MiniMax-Hailuo-2.3-Fast' },
  { operation: 'tts-hd', label: '语音生成 (Speech 2.8 HD)', model_name: 'speech-2.8-hd' },
  { operation: 'tts-turbo', label: '语音生成 (Speech 2.8 Turbo)', model_name: 'speech-2.8-turbo' },
];

describe('API config presentation helpers', () => {
  it('projects one MiniMax key card into video and audio categories', () => {
    expect(apiConfigCategories({
      provider: 'minimax',
      category: 'video',
      model_bindings: minimaxBindings,
    }, ['video', 'audio'])).toEqual(['video', 'audio']);
  });

  it('does not project a speech-only MiniMax card into video just because the provider can do video', () => {
    expect(apiConfigCategories({
      provider: 'minimax',
      category: 'video',
      model_bindings: minimaxBindings.filter(binding => binding.operation.startsWith('tts')),
    }, ['video', 'audio'])).toEqual(['audio']);
  });

  it('shows only the bindings belonging to the current category card', () => {
    expect(bindingsForCategory(minimaxBindings, 'minimax', 'video')).toHaveLength(2);
    expect(bindingsForCategory(minimaxBindings, 'minimax', 'audio')).toHaveLength(2);
  });

  it('matches MiniMax channels by endpoint instead of treating every endpoint as standard', () => {
    const modes = [
      { mode: 'domestic', label: '国内站', endpoint: 'https://api.minimaxi.com/v1' },
      { mode: 'international', label: '国际站', endpoint: 'https://api.minimax.io/v1' },
    ];

    expect(providerAccessModeForEndpoint(modes, 'https://api.minimaxi.com/v1/')?.mode).toBe('domestic');
    expect(providerAccessModeForEndpoint(modes, 'https://api.minimax.io/v1')?.mode).toBe('international');
  });

  it('adds a region mismatch hint to MiniMax 401 errors', () => {
    const message = apiConfigErrorMessage(
      'minimax',
      'https://api.minimaxi.com/v1',
      'Authentication failed (HTTP 401): authorized_error',
    );

    expect(message).toContain('国内站');
    expect(message).toContain('不能混用');
  });
});
