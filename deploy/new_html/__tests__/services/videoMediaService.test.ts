import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  clearProjectVideoTasks,
  cropVideo,
  getProjectVideoTasks,
  readVideoDurationSeconds,
  secureMediaUrl,
} from '../../public-source/videoMediaService';

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

describe('video media service', () => {
  it('reads and rounds local video duration for Seedance cost estimation', async () => {
    const createObjectURL = vi.fn(() => 'blob:duration-test');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });

    const fakeVideo: any = { duration: 8.4321, preload: '' };
    Object.defineProperty(fakeVideo, 'src', {
      set: () => queueMicrotask(() => fakeVideo.onloadedmetadata?.()),
    });
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(fakeVideo);

    await expect(readVideoDurationSeconds(new File(['x'], 'reference.mp4'))).resolves.toBe(8.432);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:duration-test');
    createElement.mockRestore();
  });

  it('uses cookie-authenticated media URLs without query tokens', () => {
    expect(secureMediaUrl('/uploads/a.mp4')).toBe('/uploads/a.mp4');
    expect(secureMediaUrl('/uploads/a.mp4?token=existing')).toBe('/uploads/a.mp4');
  });

  it('loads and clears project video task imports', async () => {
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        success: true,
        project: { video_tasks: [{ image_url: '/uploads/shot.png', scene: 'A' }] },
      }))
      .mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await expect(getProjectVideoTasks('proj_1')).resolves.toEqual([
      { image_url: '/uploads/shot.png', scene: 'A' },
    ]);
    await clearProjectVideoTasks('proj_1');

    expect(mockFetch.mock.calls[0][0]).toBe('/api/projects/proj_1/workspace');
    expect(mockFetch.mock.calls[0][1].method).toBe('GET');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/projects/proj_1/clear-video-tasks');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
  });

  it('normalizes missing project video task arrays to an empty list', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, project: { video_tasks: null } }));

    await expect(getProjectVideoTasks('proj_1')).resolves.toEqual([]);
  });

  it('crops videos through the video endpoint', async () => {
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ filename: 'crop.mp4', url: '/uploads/crop.mp4' }));

    await cropVideo('source.mp4', 1.5, 4.25);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/video/crop');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      video_filename: 'source.mp4',
      start_time: 1.5,
      end_time: 4.25,
    });
  });

});
