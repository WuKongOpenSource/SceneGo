import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf-8');
const layoutSource = readFileSync(resolve(__dirname, '../../layouts/GlobalToolsLayout.tsx'), 'utf-8');
const sidebarSource = readFileSync(resolve(__dirname, '../../components/AppSidebar.tsx'), 'utf-8');
const mediaSource = readFileSync(resolve(__dirname, '../../pages/MediaLibraryPage.tsx'), 'utf-8');
const upscaleSource = readFileSync(resolve(__dirname, '../../pages/ImageUpscalePage.tsx'), 'utf-8');

describe('project-independent user tools', () => {
  it('registers standalone routes for every global tool', () => {
    expect(appSource).toContain('path="/tools" element={<GlobalToolsLayout />}');
    for (const route of ['media-library', 'image-upscale', 'history', 'recycle-bin']) {
      expect(appSource).toContain(`path="${route}"`);
      expect(sidebarSource).toContain(`to: '/tools/${route}'`);
    }
    expect(layoutSource).toContain('<AppSidebar credits={availableCredits} />');
    expect(layoutSource).toContain('<Outlet />');
  });

  it('keeps professional canvas project-scoped and presents a project picker', () => {
    expect(sidebarSource).toContain('选择专业画布所属项目');
    expect(sidebarSource).toContain('请先创建项目');
    expect(sidebarSource).toContain('projects.map');
    expect(sidebarSource).toContain('openCanvasForProject(project.project_id)');
  });

  it('loads and uploads personal media without requiring a project id', () => {
    expect(mediaSource).toContain("const params: any = { limit: 200 }");
    expect(mediaSource).toContain("permissionScope: projectId ? 'project' : 'private'");
    expect(mediaSource).toContain("projectId: projectId || undefined");
    expect(mediaSource).not.toContain('if (!files.length || !projectId) return');
  });

  it('allows image upscale submission without project or episode params', () => {
    expect(upscaleSource).toContain('if (!file || !previewUrl || busy) return');
    expect(upscaleSource).not.toContain('!projectId || !episodeId');
    expect(upscaleSource).toContain('...(projectId ? {');
  });
});
