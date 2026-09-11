import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import release from '../../../static/platform-release.json';

const script = readFileSync(resolve(process.cwd(), '../static/platform-version.js'), 'utf8');

describe('login platform version', () => {
  it('keeps one update record per day for stable release-list keys', () => {
    const dates = release.records.map(record => record.date);
    expect(new Set(dates).size).toBe(dates.length);
  });

  beforeEach(() => { document.body.innerHTML = '<footer><span data-platform-version>版本信息</span><a href="/updates">更新记录</a></footer>'; });

  it('loads the canonical version without credentials or stale cache', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => release });
    await runInNewContext(script, { fetch, document });
    expect(fetch).toHaveBeenCalledWith('/static/platform-release.json', { cache: 'no-store', credentials: 'omit' });
    expect(document.querySelector('[data-platform-version]')).toHaveTextContent(`v${release.version}`);
  });

  it.each([null, '<img src=x onerror=alert(1)>', 'next', '2026.9.5<script>'])('ignores invalid version %s', async version => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version }) });
    await runInNewContext(script, { fetch, document });
    expect(document.querySelector('[data-platform-version]')).toHaveTextContent('版本信息');
    expect(document.querySelector('img')).toBeNull();
  });

  it('keeps the update link usable when metadata loading fails', async () => {
    await runInNewContext(script, { fetch: vi.fn().mockRejectedValue(new Error('offline')), document });
    expect(document.querySelector('a')).toHaveAttribute('href', '/updates');
  });
});
