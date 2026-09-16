import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectSessionTransport } from '../../test/sessionTransport';
import {
  addProjectMember,
  createEpisode,
  deleteEpisode,
  duplicateEpisode,
  deleteProject,
  exportToVideo,
  getEpisodes,
  getProject,
  getProjectMembers,
  listProjects,
  removeProjectMember,
  reorderEpisodes,
  saveProject,
  updateEpisode,
  updateProject,
  updateProjectMember,
} from '../../services/projectWorkflowService';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: any) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => data,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('project workflow service', () => {
  it('notifies recent projects only after a successful project rename', async () => {
    const listener = vi.fn();
    window.addEventListener('projects:updated', listener);
    try {
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: false }));
      await updateProject('proj_1', { project_name: 'Rejected' });
      expect(listener).not.toHaveBeenCalled();
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
      await updateProject('proj_1', { project_name: 'Renamed' });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].detail).toEqual({ projectId: 'proj_1', projectName: 'Renamed' });
      mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));
      await updateEpisode('ep_1', { episode_name: 'Episode only' });
      expect(listener).toHaveBeenCalledOnce();
    } finally { window.removeEventListener('projects:updated', listener); }
  });

  it('lists projects with optional organization scope', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, projects: [] }));

    await listProjects(200, 'org_1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/projects/list?limit=200&org_id=org_1');
    expect(opts.method).toBe('GET');
    expectSessionTransport(opts);
  });

  it('saves, loads, updates, and deletes projects', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, project_id: 'proj_1' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, project: { id: 'proj_1' } }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await saveProject({ project_name: 'Draft' });
    await getProject('proj_1');
    await updateProject('proj_1', { project_name: 'Final' });
    await deleteProject('proj_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/projects/save');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).project_name).toBe('Draft');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/projects/proj_1');
    expect(mockFetch.mock.calls[1][1].method).toBe('GET');
    expect(mockFetch.mock.calls[2][0]).toBe('/api/projects/proj_1');
    expect(mockFetch.mock.calls[2][1].method).toBe('PUT');
    expect(JSON.parse(mockFetch.mock.calls[2][1].body).project_name).toBe('Final');
    expect(mockFetch.mock.calls[3][0]).toBe('/api/projects/proj_1');
    expect(mockFetch.mock.calls[3][1].method).toBe('DELETE');
  });

  it('exports selected storyboard items to video', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, exported_count: 2, video_tasks: [] }));

    await exportToVideo('proj_1', ['shot_1', 'shot_2']);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/projects/proj_1/export-to-video');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body).selected_items).toEqual(['shot_1', 'shot_2']);
  });

  it('reports a denied save instead of success without clearing the valid session', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: '无权保存该项目' }),
    });

    await expect(saveProject({ project_id: 'another-project', name: 'Draft' })).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('无权保存该项目'),
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('auth_token')).toBe('test-token');
  });

  it('manages project members', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, members: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await getProjectMembers('proj_1');
    await addProjectMember('proj_1', 'user_1', 'editor', 'script');
    await updateProjectMember('proj_1', 'user_1', { role: 'owner' });
    await removeProjectMember('proj_1', 'user_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/projects/proj_1/members');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/projects/proj_1/members');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).responsibility).toBe('script');
    expect(mockFetch.mock.calls[2][0]).toBe('/api/projects/proj_1/members/user_1');
    expect(mockFetch.mock.calls[2][1].method).toBe('PUT');
    expect(mockFetch.mock.calls[3][0]).toBe('/api/projects/proj_1/members/user_1');
    expect(mockFetch.mock.calls[3][1].method).toBe('DELETE');
  });

  it('manages project episodes', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({ success: true, episodes: [] }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, episode_id: 'ep_1' }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true, episode: { episode_id: 'ep_copy' } }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await getEpisodes('proj_1');
    await createEpisode('proj_1', 'Episode 1', 'Intro');
    await updateEpisode('ep_1', { status: 'ready', settings: { cover_url: '/cover.png' } });
    await duplicateEpisode('ep_1');
    await reorderEpisodes('proj_1', ['ep_2', 'ep_1']);
    await deleteEpisode('ep_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/projects/proj_1/episodes');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/projects/proj_1/episodes');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[1][1].body).episode_name).toBe('Episode 1');
    expect(mockFetch.mock.calls[2][0]).toBe('/api/episodes/ep_1');
    expect(mockFetch.mock.calls[2][1].method).toBe('PUT');
    expect(JSON.parse(mockFetch.mock.calls[2][1].body).settings.cover_url).toBe('/cover.png');
    expect(mockFetch.mock.calls[3][0]).toBe('/api/episodes/ep_1/duplicate');
    expect(mockFetch.mock.calls[3][1].method).toBe('POST');
    expect(mockFetch.mock.calls[4][0]).toBe('/api/projects/proj_1/episodes/reorder');
    expect(mockFetch.mock.calls[4][1].method).toBe('POST');
    expect(JSON.parse(mockFetch.mock.calls[4][1].body).episode_ids).toEqual(['ep_2', 'ep_1']);
    expect(mockFetch.mock.calls[5][0]).toBe('/api/episodes/ep_1');
    expect(mockFetch.mock.calls[5][1].method).toBe('DELETE');
  });
});
