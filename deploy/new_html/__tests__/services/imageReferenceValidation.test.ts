import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiJson } from '../../services/httpClient';
import { validateImageReferences, InvalidImageReferencesError } from '../../services/imageReferenceValidation';

vi.mock('../../services/httpClient', () => ({ apiJson: vi.fn() }));
const refs = [{ url: '/storage/office.png', name: '办公室' }, { url: '/storage/snack.png', name: '辣条' }];

describe('image reference preflight', () => {
  beforeEach(() => vi.clearAllMocks());
  it('checks original references in the exact generation scope', async () => {
    vi.mocked(apiJson).mockResolvedValue({ invalid_indexes: [] });
    await validateImageReferences(refs, { projectId: 'p', episodeId: 'e', shotId: 's' });
    expect(JSON.parse(vi.mocked(apiJson).mock.calls[0][1]!.body as string)).toEqual({
      references: refs.map(ref => ref.url), project_id: 'p', episode_id: 'e', entity_type: 'storyboard_item', entity_id: 's',
    });
  });
  it('names invalid materials without exposing paths or dropping them', async () => {
    vi.mocked(apiJson).mockResolvedValue({ invalid_indexes: [0, 1] });
    const error = await validateImageReferences(refs, { shotId: 's' }).catch(error => error);
    expect(error).toBeInstanceOf(InvalidImageReferencesError);
    expect(error.message).toContain('办公室、辣条');
    expect(error.message).not.toContain('/storage/');
    expect(error.urls).toEqual(refs.map(ref => ref.url));
    expect(refs).toHaveLength(2);
  });
  it('does not check unused references in text-only generation', async () => {
    await validateImageReferences([], { shotId: 's' });
    expect(apiJson).not.toHaveBeenCalled();
  });
  it('fails closed on network and malformed responses', async () => {
    vi.mocked(apiJson).mockRejectedValueOnce(new Error('network'));
    await expect(validateImageReferences(refs, { shotId: 's' })).rejects.toThrow('network');
    vi.mocked(apiJson).mockResolvedValueOnce({});
    await expect(validateImageReferences(refs, { shotId: 's' })).rejects.toThrow('校验');
  });
});
