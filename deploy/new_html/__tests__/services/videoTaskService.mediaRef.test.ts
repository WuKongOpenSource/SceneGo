import {
    normalizeVideoMediaRef,
    submitSeedanceTask,
    submitTask,
} from '@runtime/videoTaskService';

describe('normalizeVideoMediaRef', () => {
    it('preserves persistent application URLs for MiniMax frames', () => {
        expect(normalizeVideoMediaRef('/storage/image/storyboard-real.png'))
            .toBe('/storage/image/storyboard-real.png');
        expect(normalizeVideoMediaRef('/api/files/file_real123/download'))
            .toBe('/api/files/file_real123/download');
    });

    it('preserves file ids and public URLs', () => {
        expect(normalizeVideoMediaRef('file_real123')).toBe('file_real123');
        expect(normalizeVideoMediaRef('https://cdn.example.test/frame.png'))
            .toBe('https://cdn.example.test/frame.png');
    });

    it('maps actual temporary upload filenames to the uploads mount', () => {
        expect(normalizeVideoMediaRef('uploaded-frame.png')).toBe('/uploads/uploaded-frame.png');
        expect(normalizeVideoMediaRef('uploads/uploaded-frame.png')).toBe('/uploads/uploaded-frame.png');
    });
});

describe('MiniMax submission validation', () => {
    it('persists the Hailuo model identity and selected 6-second duration', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
            JSON.stringify({ task_id: 'task_minimax_6s' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));

        await submitTask(
            '/storage/frame.png',
            null,
            'move gently',
            'MINI',
            undefined,
            undefined,
            'single',
            undefined,
            { duration: 6, minimax_resolution: '768P' },
        );

        const [, options] = fetchSpy.mock.calls[0];
        expect(JSON.parse(String(options?.body || '{}'))).toMatchObject({
            task_type: 'minimax_i2v',
            model: 'MINI',
            duration: 6,
            minimax_resolution: '768P',
        });
        fetchSpy.mockRestore();
    });

    it('rejects an unsupported resolution and duration pair before calling the API', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        await expect(submitTask(
            '/storage/frame.png',
            null,
            'move gently',
            'MINI',
            undefined,
            undefined,
            'single',
            undefined,
            {
                duration: 10,
                minimax_resolution: '1080P',
            },
        )).rejects.toThrow('1080P 仅支持 6 秒');

        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});

describe('Seedance model scope submission', () => {
    it('passes model_scope through to the backend task body', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
            JSON.stringify({ task_id: 'task_seedance_1' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));

        await submitSeedanceTask({
            sub_model: 'standard',
            model_scope: 'studio',
            prompt: 'make a shot',
            media_inputs: [],
        });

        const [, options] = fetchSpy.mock.calls[0];
        expect(JSON.parse(String(options?.body || '{}')).model_scope).toBe('studio');
        fetchSpy.mockRestore();
    });

    it('rejects unsupported Seedance Mini 1080p before calling the API', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        await expect(submitSeedanceTask({
            sub_model: 'mini',
            prompt: 'make a low cost shot',
            media_inputs: [],
            resolution: '1080p',
        })).rejects.toThrow('仅支持 480P 或 720P');

        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('keeps Seedance Mini multimodal media roles and 15-second duration without agent-plan normalization', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
            JSON.stringify({ task_id: 'task_seedance_mini_multi' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));

        await submitSeedanceTask({
            sub_model: 'mini',
            prompt: 'make a multimodal shot',
            duration: 15,
            media_inputs: [
                { kind: 'image', url: '/ref-a.png', file_id: 'sb_storyboard_only', role: 'reference_image' },
                { kind: 'image', url: '/ref-b.png', file_id: 'file_real_reference', role: 'reference_image' },
                { kind: 'video', url: '/ref.mp4', role: 'reference_video' },
                { kind: 'audio', url: '/ref.mp3', role: 'reference_audio' },
            ],
            resolution: '720p',
        });

        const [, options] = fetchSpy.mock.calls[0];
        expect(JSON.parse(String(options?.body || '{}'))).toMatchObject({
            task_type: 'seedance_multi',
            sub_model: 'mini',
            duration: 15,
            media_inputs: [
                { kind: 'image', url: '/ref-a.png', role: 'reference_image' },
                { kind: 'image', url: '/ref-b.png', file_id: 'file_real_reference', role: 'reference_image' },
                { kind: 'video', url: '/ref.mp4', role: 'reference_video' },
                { kind: 'audio', url: '/ref.mp3', role: 'reference_audio' },
            ],
        });
        fetchSpy.mockRestore();
    });

    it('maps two images to first and last frame only when agent-plan compatibility is enabled', async () => {
        localStorage.setItem('auth_token', 'test-token');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
            JSON.stringify({ task_id: 'task_seedance_plan_morph' }),
            { status: 200, headers: { 'content-type': 'application/json' } },
        ));

        await submitSeedanceTask({
            sub_model: 'standard',
            prompt: 'morph between frames',
            media_inputs: [
                { kind: 'image', url: '/start.png', role: 'reference_image' },
                { kind: 'image', url: '/end.png', role: 'reference_image' },
            ],
        }, undefined, undefined, true);

        const [, options] = fetchSpy.mock.calls[0];
        expect(JSON.parse(String(options?.body || '{}'))).toMatchObject({
            task_type: 'seedance_morph',
            media_inputs: [
                { kind: 'image', url: '/start.png', role: 'first_frame' },
                { kind: 'image', url: '/end.png', role: 'last_frame' },
            ],
        });
        fetchSpy.mockRestore();
    });
});
