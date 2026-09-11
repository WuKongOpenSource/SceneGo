import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigateFromStudio, resolveStudioReturnTo } from './navigation';

const origin = 'https://app.example.test';
const fallback = '/projects/project-1/ep/episode-1';
afterEach(() => vi.unstubAllGlobals());

describe('Studio return destinations', () => {
  it.each([
    ['/projects/project-1/ep/episode-1/workflow/script', '/projects/project-1/ep/episode-1/workflow/script'],
    ['/credits?source=studio#usage', '/credits?source=studio#usage'],
    ['/projects/project%20A/ep/episode%2F1', '/projects/project%20A/ep/episode%2F1'],
    ['/projects/../credits', '/credits'],
    ['/projects?next=https://outside.example.test/#local', '/projects?next=https://outside.example.test/#local'],
    ['/', '/'],
  ])('preserves ordinary local navigation %s', (input, expected) => {
    expect(resolveStudioReturnTo(input, fallback, origin)).toBe(expected);
  });

  it.each([
    null, undefined, '', 5, {}, 'projects', '?next=/projects', '#canvas',
    'javascript:alert(1)', 'data:text/html,hello', 'https://outside.example.test/',
    `${origin}/projects`, '//outside.example.test/', '//app.example.test/projects',
    '/\\outside.example.test/', '/\t/outside.example.test/', '/\n/outside.example.test/',
    '/\r/outside.example.test/', '/\u0000/projects', ' /projects',
    '/inside/..//outside.example.test/', '/inside/%2e%2e//outside.example.test/',
    '/inside/../\\outside.example.test/',
  ])('uses the episode fallback for an unsafe destination %j', value => {
    expect(resolveStudioReturnTo(value, fallback, origin)).toBe(fallback);
  });

  it('also validates the fallback and the base origin', () => {
    expect(resolveStudioReturnTo(null, '/\\outside.example.test/', origin)).toBe('/projects');
    expect(resolveStudioReturnTo('/credits', fallback, 'not a URL')).toBe('/projects');
    expect(resolveStudioReturnTo('/credits', fallback, 'file:///tmp/app')).toBe('/projects');
    expect(resolveStudioReturnTo('/credits', fallback, 'http://localhost:5173')).toBe('/credits');
  });

  it('survives a login query round trip without changing scope or query values', () => {
    const destination = '/projects/p%2Fone/ep/e%3Ftwo/workflow/script?name=A%26B#clip';
    const studio = `/studio/?${new URLSearchParams({ projectId: 'p/one', episodeId: 'e?two', returnTo: destination })}`;
    const login = `/login?redirect=${encodeURIComponent(studio)}`;
    const afterLogin = new URL(login, origin).searchParams.get('redirect')!;
    const afterStudio = new URL(afterLogin, origin).searchParams.get('returnTo');
    expect(resolveStudioReturnTo(afterStudio, fallback, origin)).toBe(destination);
  });

  it('never produces an external navigation after decoding or path normalization', () => {
    const parts = ['/', '\\', '\t', '\n', '.', '..', '%2e', '%2f', 'outside.example.test'];
    for (const a of parts) for (const b of parts) {
      const path = resolveStudioReturnTo(`/${a}/${b}/`, fallback, origin);
      expect(new URL(path, origin).origin).toBe(origin);
      expect(path.startsWith('//')).toBe(false);
    }
  });
});

describe('Studio navigation sink', () => {
  function browser(topOrigin = origin) {
    const current = { location: { origin, assign: vi.fn() }, self: {}, top: { location: { origin: topOrigin, assign: vi.fn() } } };
    vi.stubGlobal('window', current);
    return current;
  }

  it('opens a safe return path in its same-origin host', () => {
    const current = browser();
    navigateFromStudio('/credits?from=studio');
    expect(current.top.location.assign).toHaveBeenCalledExactlyOnceWith(`${origin}/credits?from=studio`);
    expect(current.location.assign).not.toHaveBeenCalled();
  });

  it('uses the current window when not embedded', () => {
    const current = browser();
    current.self = current.top;
    navigateFromStudio('/projects');
    expect(current.location.assign).toHaveBeenCalledExactlyOnceWith(`${origin}/projects`);
    expect(current.top.location.assign).not.toHaveBeenCalled();
  });

  it('does not navigate an unrelated parent window', () => {
    const current = browser('https://outside.example.test');
    navigateFromStudio('/projects');
    expect(current.location.assign).toHaveBeenCalledExactlyOnceWith(`${origin}/projects`);
    expect(current.top.location.assign).not.toHaveBeenCalled();
  });

  it('falls back when the cross-origin parent denies location access', () => {
    const current = browser();
    Object.defineProperty(current.top, 'location', { get() { throw new Error('SecurityError'); } });
    navigateFromStudio('/credits');
    expect(current.location.assign).toHaveBeenCalledExactlyOnceWith(`${origin}/credits`);
  });

  it('revalidates runtime paths before assigning the URL', () => {
    const current = browser();
    navigateFromStudio('/inside/..//outside.example.test/');
    expect(current.top.location.assign).toHaveBeenCalledExactlyOnceWith(`${origin}/projects`);
  });

  it('keeps entry parsing and all editor exits behind the same validator', () => {
    const entry = readFileSync(resolve(__dirname, 'main.tsx'), 'utf-8');
    const app = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');
    expect(entry).toContain("resolveStudioReturnTo(search.get('returnTo'), safeDefaultReturn, window.location.origin)");
    expect(entry).not.toContain("requestedReturn.startsWith('/')");
    expect(app).toContain("import { navigateFromStudio } from './navigation'");
    expect(app).not.toContain('location.assign');
    expect(app).toContain('if (await saveNow()) navigateFromStudio(destination)');
  });
});
