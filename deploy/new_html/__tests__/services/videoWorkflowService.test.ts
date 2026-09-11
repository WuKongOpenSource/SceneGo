import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expectSessionTransport } from '../../test/sessionTransport';

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

async function loadService() {
  return import('../../services/videoWorkflowService');
}

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  localStorage.setItem('auth_token', 'test-token');
});

describe('video workflow service', () => {
  it('creates video segments through the episode endpoint', async () => {
    const { createVideoSegment } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, segment_id: 'seg_1' }));

    await createVideoSegment('ep_1', { storyboard_item_id: 'sb_1', video_url: '/v.mp4' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/video-segments');
    expect(opts.method).toBe('POST');
    expectSessionTransport(opts);
    expect(JSON.parse(opts.body).storyboard_item_id).toBe('sb_1');
  });

  it('updates video segments by segment id', async () => {
    const { updateVideoSegment } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true }));

    await updateVideoSegment('seg_1', { status: 'completed' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/video-segments/seg_1');
    expect(opts.method).toBe('PUT');
    expect(JSON.parse(opts.body).status).toBe('completed');
  });

  it('fetchSeedanceOmni caches video capability responses', async () => {
    const { fetchSeedanceOmni } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, seedance_omni: true }));

    await expect(fetchSeedanceOmni()).resolves.toBe(true);
    await expect(fetchSeedanceOmni()).resolves.toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/video/capabilities');
  });

  it('fetchComfyuiAvailable caches video capability responses', async () => {
    const { fetchComfyuiAvailable } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, comfyui_available: true }));

    await expect(fetchComfyuiAvailable()).resolves.toBe(true);
    await expect(fetchComfyuiAvailable()).resolves.toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/video/capabilities');
  });

  it('loads the versioned model manifest and shares one request across capability helpers', async () => {
    const { fetchVideoCapabilities, fetchSeedanceOmni, fetchComfyuiAvailable } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({
      seedance_omni: true,
      comfyui_available: true,
      manifest_version: 'test-v1',
      models: [{
        key: 'MINI',
        label: '金丹',
        provider: 'minimax',
        task_types: ['i2v'],
        media_inputs: ['first_frame'],
        query_mode: 'async',
        parameter_rules: { normalization_policy: 'reject' },
      }],
    }));

    const [manifest, seedanceOmni, comfyuiAvailable] = await Promise.all([
      fetchVideoCapabilities(),
      fetchSeedanceOmni(),
      fetchComfyuiAvailable(),
    ]);

    expect(manifest.manifest_version).toBe('test-v1');
    expect(manifest.models[0].key).toBe('MINI');
    expect(seedanceOmni).toBe(true);
    expect(comfyuiAvailable).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps workflow and studio capability caches separated', async () => {
    const { fetchVideoCapabilities } = await loadService();
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        seedance_omni: false,
        comfyui_available: false,
        manifest_version: 'workflow-v1',
        model_scope: 'workflow',
        models: [],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        seedance_omni: true,
        comfyui_available: false,
        manifest_version: 'studio-v1',
        model_scope: 'studio',
        models: [],
      }));

    await expect(fetchVideoCapabilities()).resolves.toMatchObject({ manifest_version: 'workflow-v1' });
    await expect(fetchVideoCapabilities('studio')).resolves.toMatchObject({ manifest_version: 'studio-v1', model_scope: 'studio' });
    await expect(fetchVideoCapabilities('studio')).resolves.toMatchObject({ manifest_version: 'studio-v1' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('/api/video/capabilities');
    expect(mockFetch.mock.calls[1][0]).toBe('/api/video/capabilities?scope=studio');
  });

  it('can force-refresh cached video capabilities', async () => {
    const { fetchVideoCapabilities } = await loadService();
    mockFetch
      .mockResolvedValueOnce(mockJsonResponse({
        seedance_omni: false,
        comfyui_available: false,
        manifest_version: 'old',
        models: [],
      }))
      .mockResolvedValueOnce(mockJsonResponse({
        seedance_omni: true,
        comfyui_available: true,
        manifest_version: 'new',
        models: [],
      }));

    await expect(fetchVideoCapabilities()).resolves.toMatchObject({ manifest_version: 'old' });
    await expect(fetchVideoCapabilities('workflow', { force: true })).resolves.toMatchObject({ manifest_version: 'new' });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('loads video takes for the final compose picker', async () => {
    const { getVideoTakes } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, shots: [] }));

    await getVideoTakes('ep_1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/video-takes');
    expect(opts.method).toBe('GET');
  });

  it('starts episode compose with explicit selections', async () => {
    const { startCompose } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ status: 'running', total: 2, done: 0 }));

    await startCompose('ep_1', { sb_1: 'seg_1' });

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/compose');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      selections: { sb_1: 'seg_1' },
      audio_mode: 'video_original',
    });
  });

  it('keeps an explicit video-original compose choice', async () => {
    const { startCompose } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ status: 'running', total: 2, done: 0 }));

    await startCompose('ep_1', undefined, 'video_original');

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ audio_mode: 'video_original' });
  });

  it('sends the edited cut list to episode composition', async () => {
    const { startCompose } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ status: 'running', total: 2, done: 0 }));
    const timeline = [{
      clip_id: 'seg_1-cut-2',
      segment_id: 'seg_1',
      start_ms: 0,
      duration_ms: 1800,
      source_offset_ms: 1200,
    }];

    await startCompose('ep_1', undefined, 'reference_dubbing', timeline);

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      audio_mode: 'reference_dubbing',
      timeline,
    });
  });

  it('sends subtitle cues and style with the edited timeline', async () => {
    const { startCompose } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ status: 'running', total: 1, done: 0 }));
    const subtitles = [{ cue_id: 'cue-1', text: '中文字幕', start_ms: 500, duration_ms: 1500 }];
    const subtitleStyle = {
      font_size: 42,
      text_color: '#FFFFFF',
      background_color: '#000000',
      background_opacity: 0.55,
      position: 'bottom' as const,
    };

    await startCompose('ep_1', undefined, 'reference_dubbing', [], subtitles, subtitleStyle);

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      audio_mode: 'reference_dubbing',
      subtitles,
      subtitle_style: subtitleStyle,
    });
  });

  it('loads episode compose status', async () => {
    const { getComposeStatus } = await loadService();
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ status: 'done', total: 2, done: 2 }));

    await getComposeStatus('ep_1');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/compose/status');
    expect(opts.method).toBe('GET');
  });

  it('preflights edited clips before starting composition', async () => {
    const { preflightCompose } = await loadService();
    const timeline = [{
      clip_id: 'seg_1',
      segment_id: 'seg_1',
      start_ms: 0,
      duration_ms: 5000,
      source_offset_ms: 0,
      source_duration_ms: 5000,
    }];
    mockFetch.mockResolvedValueOnce(mockJsonResponse({ success: true, timeline, corrected: false }));

    await preflightCompose('ep_1', timeline);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('/api/episodes/ep_1/compose/preflight');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ timeline });
  });
});
