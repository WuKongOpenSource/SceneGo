import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildStudioUrl } from '../../pages/StudioRedirectPage';

const source = readFileSync(resolve(__dirname, '../../pages/StudioRedirectPage.tsx'), 'utf-8');

describe('StudioRedirectPage', () => {
  it('preserves the project and episode scope in the Studio URL', () => {
    expect(buildStudioUrl('project A', 'episode/1')).toBe(
      '/studio/?projectId=project+A&episodeId=episode%2F1&returnTo=%2Fprojects%2Fproject%2520A%2Fep%2Fepisode%252F1%2Fworkflow%2Fscript',
    );
  });

  it.each([['project-1', 'episode-1'], ['project?admin=true#x', 'episode/one'], ['项目 A', '分集\\二']])('encodes route segments without changing the Studio scope %s %s', (projectId, episodeId) => {
    const url = new URL(buildStudioUrl(projectId, episodeId), 'https://app.example.test');
    expect(url.searchParams.get('projectId')).toBe(projectId);
    expect(url.searchParams.get('episodeId')).toBe(episodeId);
    expect(url.searchParams.get('returnTo')).toBe(`/projects/${encodeURIComponent(projectId)}/ep/${encodeURIComponent(episodeId)}/workflow/script`);
    expect(source).toContain('const workflowBase = `${episodeBase}/workflow`');
    expect(source).toContain('to: `${episodeBase}/canvas`');
  });

  it('hosts the isolated Studio inside the global navigation shell', () => {
    expect(source).toContain('<AppSidebar');
    expect(source).toContain('<iframe');
    expect(source).toContain('title="专业画布"');
    expect(source).not.toContain('window.location.replace');
  });
});
