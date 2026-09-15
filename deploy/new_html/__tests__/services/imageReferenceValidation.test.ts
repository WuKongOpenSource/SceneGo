import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiJson } from '../../services/httpClient';
import { validateImageReferences, validateAndRecoverImageReferences, InvalidImageReferencesError } from '../../services/imageReferenceValidation';
import type { GenerationReference, MaterialLibrary } from '../../types';

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

describe('deleted asset reference recovery', () => {
  const old: GenerationReference[] = [{ id: 'ref', assetId: 'office', fileId: 'old', name: '办公室', type: 'scene', url: '/old.png' }];
  const library: MaterialLibrary = { 办公室: [{ id: 'new', assetId: 'office', fileId: 'new', type: 'image', source: 'asset', timestamp: 1, url: '/original.png', thumbnail: '/tiny.jpg' }] };
  beforeEach(() => vi.resetAllMocks());

  it('rebinds a rejected reference to the unique same-asset original after validating it', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce({ invalid_indexes: [0] }).mockResolvedValueOnce({ invalid_indexes: [] });
    const result = await validateAndRecoverImageReferences(old, library, { shotId: 's' });
    expect(result).toEqual([{ ...old[0], fileId: 'new', url: '/original.png' }]);
    expect(old[0].url).toBe('/old.png');
    expect(JSON.parse(vi.mocked(apiJson).mock.calls[1][1]!.body as string).references).toEqual(['/original.png']);
  });

  it('preserves valid manual choices even when newer material is available', async () => {
    vi.mocked(apiJson).mockResolvedValue({ invalid_indexes: [] });
    expect(await validateAndRecoverImageReferences(old, library, { shotId: 's' })).toBe(old);
    expect(apiJson).toHaveBeenCalledTimes(1);
  });

  it('does not guess among multiple images, same-name assets, or missing asset IDs', async () => {
    for (const [references, candidates] of [
      [old, { 办公室: [...library.办公室, { ...library.办公室[0], id: 'other', fileId: 'other', url: '/other.png' }] }],
      [old, { 办公室: [{ ...library.办公室[0], assetId: 'another-office' }] }],
      [[{ ...old[0], assetId: undefined }], library],
    ] as [GenerationReference[], MaterialLibrary][]) {
      vi.mocked(apiJson).mockReset().mockResolvedValue({ invalid_indexes: [0] });
      await expect(validateAndRecoverImageReferences(references, candidates, { shotId: 's' })).rejects.toBeInstanceOf(InvalidImageReferencesError);
      expect(apiJson).toHaveBeenCalledTimes(1);
    }
  });

  it('fails closed if the replacement is inaccessible; no snapshot is changed', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce({ invalid_indexes: [0] }).mockResolvedValueOnce({ invalid_indexes: [0] });
    await expect(validateAndRecoverImageReferences(old, library, { shotId: 's' })).rejects.toBeInstanceOf(InvalidImageReferencesError);
    expect(old[0].fileId).toBe('old');
    expect(apiJson).toHaveBeenCalledTimes(2);
  });

  it('does not repair network or scope errors and keeps other valid references unchanged', async () => {
    vi.mocked(apiJson).mockRejectedValueOnce(new Error('scope denied'));
    await expect(validateAndRecoverImageReferences(old, library, { shotId: 's' })).rejects.toThrow('scope denied');
    expect(apiJson).toHaveBeenCalledTimes(1);
    vi.mocked(apiJson).mockResolvedValueOnce({ invalid_indexes: [0] }).mockResolvedValueOnce({ invalid_indexes: [] });
    const valid = { ...old[0], id: 'valid', fileId: 'valid', url: '/valid.png' };
    const result = await validateAndRecoverImageReferences([...old, valid], library, { shotId: 's' });
    expect(result[1]).toBe(valid);
  });
});
