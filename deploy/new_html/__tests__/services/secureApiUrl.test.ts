import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiFetch, handleUnauthorized, publicFetch, safeBrowserResourceUrl, secureApiUrl } from '../../services/httpClient';

describe('secureApiUrl cookie session', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('preserves the Studio destination after an actual unauthorized response', () => {
    const location = { pathname: '/studio/', search: '?projectId=project-1&episodeId=episode-1', hash: '#canvas', href: '' };
    vi.stubGlobal('window', { location });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => handleUnauthorized('checkSession')).toThrow('未授权');
    expect(location.href).toBe('/login?redirect=' + encodeURIComponent('/studio/?projectId=project-1&episodeId=episode-1#canvas'));
  });

  it('moves an embedded Studio session expiry to the same-origin parent login', () => {
    const location = { origin: 'https://app.example.test', pathname: '/studio/', search: '?projectId=p&episodeId=e', hash: '', href: '' };
    const parentLocation = { origin: location.origin, pathname: '/projects/p/ep/e/canvas', search: '?view=canvas', hash: '', href: '' };
    vi.stubGlobal('window', { location, top: { location: parentLocation } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => handleUnauthorized('checkSession')).toThrow('未授权');
    expect(parentLocation.href).toBe('/login?redirect=' + encodeURIComponent('/projects/p/ep/e/canvas?view=canvas'));
    expect(location.href).toBe('');
  });

  it('never navigates a foreign embedding window on session expiry', () => {
    const location = { origin: 'https://app.example.test', pathname: '/studio/', search: '?projectId=p&episodeId=e', hash: '', href: '' };
    const parentLocation = { origin: 'https://other.example.test', href: '' };
    vi.stubGlobal('window', { location, top: { location: parentLocation } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => handleUnauthorized('checkSession')).toThrow('未授权');
    expect(parentLocation.href).toBe('');
    expect(location.href).toBe('/login?redirect=' + encodeURIComponent('/studio/?projectId=p&episodeId=e'));
  });

  it('falls back safely when browser isolation prevents reading the parent', () => {
    const location = { origin: 'https://app.example.test', pathname: '/studio/', search: '', hash: '', href: '' };
    vi.stubGlobal('window', { location, top: { get location() { throw new DOMException('Cross-origin', 'SecurityError'); } } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => handleUnauthorized('checkSession')).toThrow('未授权');
    expect(location.href).toBe('/login?redirect=%2Fstudio%2F');
  });

  it('同源媒体 URL 不再注入当前 token', () => {
    localStorage.setItem('auth_token', 'fresh-1');
    expect(secureApiUrl('/storage/audio/x.mp3')).toBe('/storage/audio/x.mp3');
  });

  it('清除同源 URL 里遗留的旧 token', () => {
    localStorage.setItem('auth_token', 'fresh-2');
    const stale = '/storage/audio/x.mp3?token=expired-yesterday';
    expect(secureApiUrl(stale)).toBe('/storage/audio/x.mp3');
  });

  it('保留其它查询参数并删除 token', () => {
    localStorage.setItem('auth_token', 'fresh-3');
    const url = '/api/file?id=42&token=old&v=2';
    const out = secureApiUrl(url);
    expect(out).toContain('id=42');
    expect(out).toContain('v=2');
    expect(out).not.toContain('token=fresh-3');
    expect(out).not.toContain('token=old');
  });

  it('未登录时也清除同源 URL 中的遗留 token', () => {
    const url = '/storage/audio/x.mp3?token=whatever';
    expect(secureApiUrl(url)).toBe('/storage/audio/x.mp3');
  });

  it('不修改第三方签名 URL 的 token 参数', () => {
    const url = 'https://cdn.example.test/video.mp4?token=provider-signature';
    expect(secureApiUrl(url)).toBe(url);
  });

  it('拒绝可执行、本地文件和主动文档 URL 协议', () => {
    expect(safeBrowserResourceUrl('javascript:alert(1)')).toBe('');
    expect(safeBrowserResourceUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeBrowserResourceUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe('');
    expect(safeBrowserResourceUrl('file:///etc/passwd')).toBe('');
  });

  it('允许网页、Blob、相对路径和无脚本位图 data URL', () => {
    expect(safeBrowserResourceUrl('/storage/example.png')).toBe('/storage/example.png');
    expect(safeBrowserResourceUrl('https://cdn.example.test/example.mp4')).toBe('https://cdn.example.test/example.mp4');
    expect(safeBrowserResourceUrl('blob:https://app.example.test/id')).toBe('blob:https://app.example.test/id');
    expect(safeBrowserResourceUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('拒绝 URL 内嵌账号密码', () => {
    expect(safeBrowserResourceUrl('https://user:secret@example.test/file')).toBe('');
  });

  it('没有脚本可见 token 时仍发送同源 Cookie 请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/user/info');

    expect(fetchMock).toHaveBeenCalledWith('/api/user/info', expect.objectContaining({
      credentials: 'same-origin',
    }));
  });

  it('服务端确认旧会话升级后删除 localStorage token', async () => {
    localStorage.setItem('auth_token', 'legacy-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-ostory-session-upgraded': '1',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/user/info');

    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('公开请求明确不携带会话 Cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await publicFetch('https://cdn.example.test/public.json');

    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.test/public.json', expect.objectContaining({
      credentials: 'omit',
    }));
  });
});
