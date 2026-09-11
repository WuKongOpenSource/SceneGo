import { describe, it, expect } from 'vitest';
import { makeDefaultDashScopeParams } from '../../services/videoModelService';









describe('makeDefaultDashScopeParams', () => {
    it('Kling 默认值包含多镜头字段', () => {
        const p = makeDefaultDashScopeParams('Kling');
        expect(p.kling_multi_shot).toBe(false);
        expect(p.kling_shot_type).toBe('intelligence');
        expect(p.kling_multi_prompt).toEqual([]);
        expect(p.kling_keep_original_sound).toBe('no');
    });

    it('Vidu 默认值包含 resolution / size / seed / audio', () => {
        const p = makeDefaultDashScopeParams('Vidu');
        expect(p.vidu_resolution).toBe('720P');
        expect(p.vidu_size).toBe('1280*720');
        expect(p.vidu_seed).toBeUndefined();
        expect(p.vidu_audio).toBe(false);
    });

    it('HappyHorse 默认值包含 resolution / ratio / duration / watermark / seed', () => {
        const p = makeDefaultDashScopeParams('HappyHorse');
        expect(p.hh_resolution).toBe('1080P');
        expect(p.hh_ratio).toBe('16:9');
        expect(p.hh_duration).toBe(5);
        expect(p.hh_watermark).toBe(true);
        expect(p.hh_seed).toBeUndefined();
    });

    it('共用字段 prompt / media_inputs / duration 各自合理默认', () => {
        const k = makeDefaultDashScopeParams('Kling');
        expect(k.prompt).toBe('');
        expect(k.media_inputs).toEqual([]);
        expect(k.duration).toBe(5);
        expect(k.aspect_ratio).toBe('16:9');
    });

    it('项目为竖屏时把各视频厂商的初始比例统一为 9:16', () => {
        expect(makeDefaultDashScopeParams('Kling', '', [], '9:16').aspect_ratio).toBe('9:16');
        expect(makeDefaultDashScopeParams('Vidu', '', [], '9:16').vidu_size).toBe('720*1280');
        expect(makeDefaultDashScopeParams('HappyHorse', '', [], '9:16').hh_ratio).toBe('9:16');
    });
});
