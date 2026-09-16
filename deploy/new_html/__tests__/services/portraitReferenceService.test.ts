import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiJson } from '../../services/httpClient';
import { checkPortraitReferenceInputs } from '../../services/portraitReferenceService';
import type { SeedanceParams } from '../../services/videoModelService';

vi.mock('../../services/httpClient', () => ({ apiJson: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
const params = (references: string[]): SeedanceParams => ({
  sub_model: 'mini', prompt: '不改提示词', reference_mode: 'reference',
  media_inputs: references.map(url => ({ kind: 'image', url })),
});
const eligible = (extra = {}) => ({ purpose: 'character_four_view', portrait_reference_scopes: ['workflow'],
  portrait_reference_expires_at: Math.floor(Date.now() / 1000) + 300, ...extra });
const check = (value: SeedanceParams) => checkPortraitReferenceInputs(value, new AbortController().signal);

describe('portrait reference eligibility preflight', () => {
  it('uses verified eligibility instead of a model name, retaining valid originals and audio', async () => {
    vi.mocked(apiJson).mockResolvedValue({ items: {
      '/hero': eligible(), '/background': eligible({ purpose: 'pure_background' }),
      '/gemini': { display_label: 'Gemini · 文生图', generation_mode: 'text_to_image' },
      '/seedream-i2i': { display_label: 'Seedream 5.0 Lite · 图生图', generation_mode: 'image_to_image' },
      '/upload': {}, '/expired': eligible({ portrait_reference_expires_at: 1 }),
      '/other-scope': eligible({ portrait_reference_scopes: ['studio'] }),
      '/no-purpose': eligible({ purpose: undefined }),
    } });
    const value = params(['/hero', '/background', '/gemini', '/seedream-i2i', '/upload', '/expired', '/other-scope', '/no-purpose']);
    value.media_inputs.push({ kind: 'video', url: '/video' }, { kind: 'audio', url: '/voice' });
    expect(await check(value)).toEqual({ unsupportedIndices: [2, 3, 4, 5, 6, 7, 8],
      expiresAt: (Math.floor(Date.now() / 1000) + 300) * 1000 });
    expect(JSON.parse(vi.mocked(apiJson).mock.calls[0][1]!.body as string)).toEqual({
      references: value.media_inputs.slice(0, 8).map(item => item.url), include_portrait_eligibility: true,
    });
    expect(value.media_inputs).toHaveLength(10);
  });

  it('deduplicates registered file ids, rejects temporary images, and supports studio scope', async () => {
    vi.mocked(apiJson).mockResolvedValue({ items: { file_original: eligible({ portrait_reference_scopes: ['studio'] }) } });
    const value = params(['/original', '/original-copy', 'data:image/png;base64,AA', 'blob:temporary']);
    value.model_scope = 'studio';
    value.media_inputs[0].file_id = value.media_inputs[1].file_id = 'file_original';
    expect((await check(value)).unsupportedIndices).toEqual([2, 3]);
    expect(JSON.parse(vi.mocked(apiJson).mock.calls[0][1]!.body as string).references).toEqual(['file_original']);
  });

  it.each([{}, { items: {} }, { items: { '/image': null } }])('fails rather than marking images for removal on an incomplete response %s', async response => {
    vi.mocked(apiJson).mockResolvedValue(response);
    await expect(check(params(['/image']))).rejects.toThrow('返回不完整');
  });

  it('propagates service failures without returning a removal proposal', async () => {
    vi.mocked(apiJson).mockRejectedValue(new Error('offline'));
    await expect(check(params(['/image']))).rejects.toThrow('offline');
  });

  it('checks original URLs for legacy UI-only ids, just like the submission normalizer', async () => {
    vi.mocked(apiJson).mockResolvedValue({ items: { '/original': eligible(), '/other': eligible() } });
    const value = params(['/original', '/other']);
    value.media_inputs[0].file_id = 'sb_storyboard';
    value.media_inputs[1].file_id = 'ref_reference';
    expect((await check(value)).unsupportedIndices).toEqual([]);
    expect(JSON.parse(vi.mocked(apiJson).mock.calls[0][1]!.body as string).references).toEqual(['/original', '/other']);
    expect(value.media_inputs[0].file_id).toBe('sb_storyboard');
  });

  it('bounds requests to 16 references and does not reuse stale eligibility', async () => {
    vi.mocked(apiJson).mockImplementation(async (_url, init) => ({ items: Object.fromEntries(
      JSON.parse(init!.body as string).references.map((ref: string) => [ref, eligible()]),
    ) }));
    const value = params(Array.from({ length: 17 }, (_, i) => `/original${i}`));
    expect((await check(value)).unsupportedIndices).toEqual([]);
    expect(vi.mocked(apiJson).mock.calls.map(call => JSON.parse(call[1]!.body as string).references.length)).toEqual([16, 1]);
    await check(value);
    expect(apiJson).toHaveBeenCalledTimes(4);
  });

  it('aborts a hanging check after the deadline', async () => {
    vi.useFakeTimers();
    vi.mocked(apiJson).mockImplementation((_url, init) => new Promise((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const result = expect(check(params(['/image']))).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(20000);
    await result;
  });
});
