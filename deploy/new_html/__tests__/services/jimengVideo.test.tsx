import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SeedanceMultimodalPanel } from '../../components/SeedanceMultimodalPanel';
import { buildVideoModelOptions, withCurrentVideoModelOption, getModelDisplayName, getVideoCreditFallbackCost, prepareJimengComposerParams, SELECTABLE_MODELS, seedanceModelForSubModel, type SeedanceParams } from '../../services/videoModelService';
import { submitSeedanceTask } from '@runtime/videoTaskService';
import { getVideoTaskModel } from '../../services/videoTaskReconciliation';
import { formatPublicTaskText } from '../../utils/publicTaskTerminology';

const params: SeedanceParams = { sub_model: 'standard', prompt: '保留所有台词', duration: 3.2,
    media_inputs: [
        { kind: 'image', url: '/storage/original.png', file_id: 'file_original', role: 'first_frame' },
        { kind: 'video', url: '/storage/original.mp4', duration_seconds: 5 },
        { kind: 'audio', url: '/storage/original.wav', duration_seconds: 3 },
    ], resolution: '1080p', reference_audio_policy: 'trim_to_15', generate_audio: false };

describe('independent Jimeng connector', () => {
    it('uses only the generic not-enabled hint for authorized users', () => {
        const options = buildVideoModelOptions([
            { key: 'Seedance2', available: true },
            { key: 'JimengSeedance2', available: false, unavailable_reason: '该真人视频模型仅限管理员使用。' },
        ] as any, SELECTABLE_MODELS);
        expect(options.find(option => option.value === 'JimengSeedance2')).toMatchObject({
            available: false, unavailableReason: '未启用',
        });
        expect(options.find(option => option.value === 'Seedance2')?.available).toBe(true);
    });
    it.each([{ capabilities: null }, { capabilities: [] }, { capabilities: [{ key: 'Seedance2', available: true }] }])('does not reveal Jimeng without a capability or restore a historical selection', ({ capabilities }) => {
        const options = buildVideoModelOptions(capabilities, SELECTABLE_MODELS);
        expect(options.some(option => option.value === 'JimengSeedance2')).toBe(false);
        expect(withCurrentVideoModelOption(options, 'JimengSeedance2', capabilities)).toEqual(options);
    });
    it('has the exact label and follows Standard with the same fallback quote', () => {
        expect(getModelDisplayName('JimengSeedance2')).toBe('Jimeng·Seedance 2.0 · 真人视频模型');
        expect(SELECTABLE_MODELS[SELECTABLE_MODELS.indexOf('Seedance2') + 1]).toBe('JimengSeedance2');
        expect(getVideoCreditFallbackCost('JimengSeedance2')).toBe(getVideoCreditFallbackCost('Seedance2'));
        expect(seedanceModelForSubModel('jimeng_mini')).toBe('JimengSeedance2');
    });
    it('preserves all original references, text and editorial duration when changing provider', () => {
        const next = prepareJimengComposerParams(params);
        expect(next.media_inputs).toBe(params.media_inputs);
        expect(next.prompt).toBe(params.prompt);
        expect(next.duration).toBe(3.2);
        expect(next).toMatchObject({ resolution: '720p', reference_audio_policy: 'preserve', reference_mode: 'reference' });
    });
    it('clears the Ark-only portrait flag without modifying the original parameters', () => {
        const original: SeedanceParams = { ...params, portrait_reference_mode: 'character_background' };
        const next = prepareJimengComposerParams(original);
        expect(next.portrait_reference_mode).toBeUndefined();
        expect(next.media_inputs).toBe(original.media_inputs);
        expect(next.prompt).toBe(original.prompt);
        expect(original.portrait_reference_mode).toBe('character_background');
    });
    it('never shows the portrait control for stale Jimeng parameters', () => {
        const value: SeedanceParams = { ...params, sub_model: 'jimeng_mini', resolution: '720p',
            portrait_reference_mode: 'character_background' };
        render(<SeedanceMultimodalPanel value={value} onChange={vi.fn()} candidates={[]} />);
        expect(screen.queryByTestId('portrait-reference-control')).not.toBeInTheDocument();
        expect(screen.queryByText(/请选择 30 天内/)).not.toBeInTheDocument();
        expect(screen.getByRole('textbox')).toHaveValue(value.prompt);
    });
    it('offers full-reference mode and no unverifiable CLI switches', () => {
        render(<SeedanceMultimodalPanel value={prepareJimengComposerParams(params)} onChange={vi.fn()} candidates={[]} />);
        expect(screen.getByRole('combobox', { name: 'Seedance 生成模式' })).toHaveValue('reference');
        expect(screen.queryByRole('option', { name: '首尾帧' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '高级设置' })).not.toBeInTheDocument();
        expect(screen.getByText(/实际执行 seedance2.0mini/)).toBeInTheDocument();
        expect(screen.getByText(/标准模型同参数的一倍计费/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '声音与参考配音' }));
        expect(screen.queryByRole('checkbox', { name: 'AI 生成配音' })).not.toBeInTheDocument();
        expect(screen.queryByRole('checkbox', { name: '仅裁剪参考副本至 15 秒内' })).not.toBeInTheDocument();
    });
    it('submits only the independent task route while preserving full reference media', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ task_id: 'job' }), { status: 200 }));
        try {
            await submitSeedanceTask(prepareJimengComposerParams({ ...params, portrait_reference_mode: 'character_background' }), { episode_id: 'ep', entity_type: 'video_segment', entity_id: 'seg' });
            const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
            expect(body).toMatchObject({ task_type: 'jimeng_multimodal', model: 'JimengSeedance2', sub_model: 'jimeng_mini', duration: 4, resolution: '720p', episode_id: 'ep' });
            expect(body.media_inputs).toHaveLength(3);
            expect(body.media_inputs[0].url).toBe('/storage/original.png');
            expect(body).not.toHaveProperty('portrait_reference_mode');
            expect(params.duration).toBe(3.2);
        } finally { fetchMock.mockRestore(); }
    });
    it('still rejects a caller explicitly sending unsupported Jimeng portrait mode', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        try {
            await expect(submitSeedanceTask({ ...prepareJimengComposerParams(params), portrait_reference_mode: 'character_background' }))
                .rejects.toThrow('仿真人参考仅支持');
            expect(fetchMock).not.toHaveBeenCalled();
        } finally { fetchMock.mockRestore(); }
    });
    it('keeps result/history labels out of the Ark Mini namespace', () => {
        expect(getVideoTaskModel({ task_type: 'jimeng_multimodal', data: { model: 'Wan2' } } as any)).toBe('JimengSeedance2');
        expect(formatPublicTaskText(getModelDisplayName('JimengSeedance2'), 'jimeng')).toBe('Jimeng·Seedance 2.0 · 真人视频模型');
    });
});
