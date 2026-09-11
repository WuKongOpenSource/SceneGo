import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiJson = vi.fn();

vi.mock('../../services/httpClient', () => ({
  apiJson: (...args: any[]) => apiJson(...args),
}));

import { generateGeminiImageViaProxy } from '../../services/geminiImageService';

describe('geminiImageService model scope', () => {
  beforeEach(() => {
    apiJson.mockReset();
    apiJson.mockResolvedValue({
      files: [{ file_url: '/storage/studio-image.webp', file_id: 'file_1' }],
    });
  });

  it('passes the studio model scope to the backend proxy', async () => {
    await generateGeminiImageViaProxy({
      prompt: 'studio prompt',
      modelScope: 'studio',
    });

    const [, request] = apiJson.mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({
      prompt: 'studio prompt',
      model_scope: 'studio',
    });
  });
});
