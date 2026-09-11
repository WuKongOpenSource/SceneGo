import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProjectVideoTasks, secureMediaUrl, uploadImage } from '@runtime/videoMediaService';

describe('media access with cookie-only authentication', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('loads project media without requiring a browser token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true, project: { video_tasks: [{ image_url: '/storage/original.png', storyboard_id: 'shot-1' }] },
    }), { headers: { 'content-type': 'application/json' } }));
    await expect(getProjectVideoTasks('project-1')).resolves.toEqual([{ image_url: '/storage/original.png', storyboard_id: 'shot-1' }]);
    expect(fetchSpy).toHaveBeenCalledWith('/api/projects/project-1/workspace', expect.objectContaining({ credentials: 'same-origin' }));
    expect(new Headers(fetchSpy.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
  });

  it('sends the original file in a same-origin XHR without a token preflight', async () => {
    const open = vi.fn();
    const setRequestHeader = vi.fn();
    const send = vi.fn();
    class UploadRequest {
      open = open;
      setRequestHeader = setRequestHeader;
      upload = {};
      status = 200;
      responseText = JSON.stringify({ file_id: 'file-original', storage_url: '/storage/original.png' });
      onload?: () => void;
      send(body: FormData) { send(body); this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', UploadRequest);
    const original = new File(['original-bytes'], 'original.png', { type: 'image/png' });
    await expect(uploadImage(original)).resolves.toMatchObject({ file_id: 'file-original', url: '/storage/original.png' });
    expect(open).toHaveBeenCalledWith('POST', '/api/upload');
    expect(setRequestHeader).not.toHaveBeenCalled();
    expect(send.mock.calls[0][0].get('file')).toBe(original);
  });

  it('preserves the original media path while dropping legacy URL credentials', () => {
    expect(secureMediaUrl('/api/files/original/download?token=obsolete&quality=original')).toBe('/api/files/original/download?quality=original');
  });
});
