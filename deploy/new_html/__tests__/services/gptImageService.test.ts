





import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GptImageTier } from '../../services/gptImageService';
import { generateGptImage } from '../../services/gptImageService';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);

  const store: Record<string, string> = { auth_token: 'test-token' };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  } as unknown as Storage);
});

function okResp(images: string[] = ['data:image/png;base64,XXXX']) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({
      success: true,
      images,
      files: images.map(img => ({ data_url: img, file_id: 'f1', file_url: '/storage/f.png' })),
      model: 'gpt-image-2-vip',
      tier: 'vip',
    }),
  };
}

describe('generateGptImage', () => {
  it('tier=vip + 比例+K 自动映射为 size 字符串', async () => {
    fetchMock.mockResolvedValueOnce(okResp());
    await generateGptImage({
      tier: 'vip',
      prompt: 'hello',
      ratio: '16:9',
      k: '2K',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/gpt-image/generate');
    const body = JSON.parse(init.body);
    expect(body.tier).toBe('vip');

    expect(body.size).toBe('2688x1536');
    expect(body.references).toEqual([]);
  });

  it('ratio=auto 或 k=auto → size="auto" 透传', async () => {
    fetchMock.mockResolvedValueOnce(okResp());
    await generateGptImage({ tier: 'official', prompt: 'p', ratio: 'auto', k: '1K' });
    const body1 = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body1.size).toBe('auto');

    fetchMock.mockResolvedValueOnce(okResp());
    await generateGptImage({ tier: 'official', prompt: 'p', ratio: '1:1', k: 'auto' });
    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body2.size).toBe('auto');
  });

  it('默认 quality="auto"', async () => {
    fetchMock.mockResolvedValueOnce(okResp());
    await generateGptImage({ tier: 'vip', prompt: 'p' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.quality).toBe('auto');
  });

  it('references 透传给后端（让后端按长度走 generations / edits）', async () => {
    fetchMock.mockResolvedValueOnce(okResp());
    await generateGptImage({
      tier: 'vip',
      prompt: 'p',
      references: ['data:image/png;base64,AAAA', '/storage/x.png'],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.references).toEqual(['data:image/png;base64,AAAA', '/storage/x.png']);
  });

  it('forwards the shot navigation context used by task notifications', async () => {
    fetchMock.mockResolvedValueOnce(okResp());
    await generateGptImage({
      tier: 'vip',
      prompt: 'p',
      projectId: 'proj_1',
      episodeId: 'ep_1',
      sourcePage: 'generation',
      sourceItemId: 'shot_06',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      project_id: 'proj_1',
      episode_id: 'ep_1',
      source_page: 'generation',
      source_item_id: 'shot_06',
    });
  });

  it('tier 非法值直接抛错，不发请求', async () => {
    await expect(

      generateGptImage({ tier: 'pro' as GptImageTier, prompt: 'p' })
    ).rejects.toThrow(/tier/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prompt 为空或全空白直接抛错', async () => {
    await expect(generateGptImage({ tier: 'vip', prompt: '' })).rejects.toThrow(/prompt/);
    await expect(generateGptImage({ tier: 'vip', prompt: '   ' })).rejects.toThrow(/prompt/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('无脚本可见 token 时仍把请求交给 Cookie 会话和服务端鉴权', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    } as unknown as Storage);
    fetchMock.mockResolvedValueOnce(okResp());
    await expect(generateGptImage({ tier: 'vip', prompt: 'p' })).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('后端 4xx 抛带 detail 的错误', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: 'API Key 未配置' }),
    });
    await expect(generateGptImage({ tier: 'vip', prompt: 'p' })).rejects.toThrow(/API Key 未配置/);
  });

  it('后端 200 但 images=[] 抛 "未返回图片"', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, images: [], files: [], model: 'gpt-image-2-vip', tier: 'vip' }),
    });
    await expect(generateGptImage({ tier: 'vip', prompt: 'p' })).rejects.toThrow(/未返回图片/);
  });

  it('n 被夹紧到 [1,4]', async () => {
    fetchMock.mockResolvedValueOnce(okResp());
    await generateGptImage({ tier: 'vip', prompt: 'p', n: 99 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).n).toBe(4);

    fetchMock.mockResolvedValueOnce(okResp());
    await generateGptImage({ tier: 'vip', prompt: 'p', n: 0 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).n).toBe(1);
  });
});
