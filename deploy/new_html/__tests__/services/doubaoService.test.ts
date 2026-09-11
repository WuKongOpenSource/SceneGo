import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateDoubaoImages } from '../../services/doubaoService';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === 'auth_token' ? 'test-token' : null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
  } as unknown as Storage);
});

describe('generateDoubaoImages', () => {
  it('explains a timeout without retrying or discarding its status', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 504, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: '上游服务响应超时，请稍后重试' }),
    });
    await expect(generateDoubaoImages({ prompt: 'storyboard' })).rejects.toMatchObject({
      status: 504,
      message: '生图等待超时，暂未取得结果。请先查看生成历史，勿连续重复提交。',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests official Pro portrait mode and returns a persistent original reference', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ files: [{ file_id: 'original-id', file_url: '/storage/original.png', data_url: 'data:image/png;base64,AAAA' }] }),
    });
    const result = await generateDoubaoImages({ prompt: 'storyboard', model: 'doubao-seedream-5-0-pro-260628', seedancePortrait: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'doubao-seedream-5-0-pro-260628', seedance_portrait: true, references: [], reference_metadata: [],
    });
    expect(result).toEqual([{ url: '/storage/original.png', fileUrl: '/storage/original.png', fileId: 'original-id' }]);
  });

  it('passes an explicit ratio-preserving size to the backend', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ images: ['data:image/png;base64,AAAA'] }),
    });

    await generateDoubaoImages({
      prompt: 'turnaround',
      model: 'doubao-seedream-5-0-lite-260128',
      size: '2048x1152',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/materials/doubao');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'doubao-seedream-5-0-lite-260128',
      size: '2048x1152',
    });
  });
});
