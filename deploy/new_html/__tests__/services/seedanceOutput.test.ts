import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../services/httpClient';
import { submitSeedanceTask, submitTask } from '@runtime/videoTaskService';
import { submitSeedanceTask as submitPublicSeedanceTask, submitTask as submitPublicTask } from '../../public-source/videoTaskService';
import { getSeedanceOutputError, type SeedanceParams } from '../../services/videoModelService';

vi.mock('../../services/httpClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/httpClient')>(),
  apiFetch: vi.fn(),
}));

beforeEach(() => vi.mocked(apiFetch).mockReset());

describe.each([['workspace', submitSeedanceTask], ['public', submitPublicSeedanceTask]] as const)('%s Seedance output request contract', (_name, submit) => {
  it.each([3, 3.5, 13, NaN])('rejects unsupported 1.5 Pro duration %s before HTTP', async duration => {
    await expect(submit({ sub_model: 'agent_plan', prompt: '', duration, media_inputs: [] })).rejects.toThrow('4–12');
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it('records 1.5 Pro identity and both frames at the exact calibrated duration', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ task_id: 'created' }), { status: 200 }));
    await submit({ sub_model: 'agent_plan', prompt: '动作', duration: 6, media_inputs: [
      { kind: 'image', url: '/a.png', role: 'first_frame' }, { kind: 'image', url: '/b.png', role: 'last_frame' },
    ] });
    expect(JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body))).toMatchObject({ model: 'Seedance15', sub_model: 'agent_plan', duration: 6, task_type: 'seedance_morph' });
  });
  it.each([undefined, null, '', '720P', ' 720p '])('submits the visible 720p default for %s', async resolution => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ task_id: 'created' }), { status: 200 }));
    const params = { sub_model: 'mini', prompt: 'pan slowly', duration: 15, resolution,
      media_inputs: [{ kind: 'image', url: '/storage/reference.png', role: 'reference_image' }],
    } as SeedanceParams;
    await submit(params);
    const body = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(body.resolution).toBe('720p');
    expect(body.duration).toBe(15);
    expect(body.media_inputs).toEqual(params.media_inputs);
    expect(body.sub_model).toBe('mini');
  });

  it.each(['mini', 'fast'] as const)('rejects upper-case 1080P for %s without a network request', async sub_model => {
    const params = { sub_model, prompt: 'pan slowly', resolution: ' 1080P ', media_inputs: [] } as unknown as SeedanceParams;
    await expect(submit(params)).rejects.toThrow('480P 或 720P');
    expect(apiFetch).not.toHaveBeenCalled();
    expect(params.resolution).toBe(' 1080P ');
  });

  it('allows explicit standard HD but rejects unknown output values', () => {
    expect(getSeedanceOutputError('standard', '1080P')).toBeNull();
    expect(getSeedanceOutputError('standard', '4K')).toContain('清晰度无效');
  });
  it('rejects aggregate reference audio overflow before a network request', async () => {
    const params = { sub_model: 'mini', resolution: '720p', duration: 15, media_inputs: [
      { kind: 'audio', url: '/one.wav', duration_seconds: 8.028 },
      { kind: 'audio', url: '/two.wav', duration_seconds: 8.028 },
    ] } as SeedanceParams;
    await expect(submit(params)).rejects.toThrow('16.056');
    expect(apiFetch).not.toHaveBeenCalled();
    expect(params.media_inputs).toHaveLength(2);
  });
  it('sends the explicit trim policy once while preserving original media and output duration', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ task_id: 'created' }), { status: 200 }));
    const params = { sub_model: 'mini', resolution: '720p', duration: 15, reference_audio_policy: 'trim_to_15', media_inputs: [
      { kind: 'audio', url: '/original.wav', duration_seconds: 23.832 },
    ] } as SeedanceParams;
    await submit(params);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(body.reference_audio_policy).toBe('trim_to_15');
    expect(body.media_inputs).toEqual([
      { ...params.media_inputs[0], role: 'reference_audio' },
    ]);
    expect(params.media_inputs[0]).not.toHaveProperty('role');
    expect(body.duration).toBe(15);
  });
});

describe.each([['workspace', submitTask], ['public', submitPublicTask]] as const)('%s generic video entry', (_name, submit) => {
  it('submits the Seedance default rather than omitting the field', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({ task_id: 'created' }), { status: 200 }));
    await submit('https://example.test/reference.png', null, 'pan slowly', 'Seedance2Mini');
    const body = JSON.parse(String(vi.mocked(apiFetch).mock.calls[0][1]?.body));
    expect(body.resolution).toBe('720p');
  });
  it('does not silently downgrade an explicit unsupported resolution', async () => {
    await expect(submit('https://example.test/reference.png', null, 'pan slowly', 'Seedance2Mini',
      undefined, undefined, 'multi', undefined, { resolution: '1080P' })).rejects.toThrow('480P 或 720P');
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
