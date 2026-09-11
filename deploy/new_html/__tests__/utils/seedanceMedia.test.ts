import { describe, it, expect } from 'vitest';
import {
    nextTokenIndex,
    insertMention,
    removeMediaInput,
    canonicalizePrompt,
    shouldEnableWebSearch,
    parseArkAssetId,
    TOKEN_PREFIX,
} from '../../utils/seedanceMedia';
import type { SeedanceParams } from '../../services/videoModelService';
import type { SeedanceAssetCandidate } from '../../utils/seedanceMedia';

const baseParams = (over: Partial<SeedanceParams> = {}): SeedanceParams => ({
    sub_model: 'standard',
    prompt: '',
    media_inputs: [],
    duration: 5,
    ...over,
});

const imgCandidate = (over: Partial<SeedanceAssetCandidate> = {}): SeedanceAssetCandidate => ({
    id: 'cand_img_1',
    group: 'assets',
    kind: 'image',
    label: '主角立绘',
    url: '/storage/assets/hero.png',
    ...over,
});

describe('nextTokenIndex', () => {
    it('returns 1 when no media of that kind', () => {
        expect(nextTokenIndex(baseParams(), 'image')).toBe(1);
        expect(nextTokenIndex(baseParams(), 'video')).toBe(1);
        expect(nextTokenIndex(baseParams(), 'audio')).toBe(1);
    });
    it('counts only matching kind', () => {
        const v = baseParams({
            media_inputs: [
                { kind: 'image', url: '/a.png' },
                { kind: 'image', url: '/b.png' },
                { kind: 'audio', url: '/a.mp3' },
            ],
        });
        expect(nextTokenIndex(v, 'image')).toBe(3);
        expect(nextTokenIndex(v, 'audio')).toBe(2);
        expect(nextTokenIndex(v, 'video')).toBe(1);
    });
});

describe('insertMention (image)', () => {
    it('appends media_input and adds 图片N to prompt end', () => {
        const v = baseParams({ prompt: '英雄登场' });
        const next = insertMention(v, imgCandidate());
        expect(next.media_inputs).toHaveLength(1);
        expect(next.media_inputs[0]).toMatchObject({
            kind: 'image', url: '/storage/assets/hero.png',
        });
        expect(next.prompt).toBe('英雄登场 图片1');
    });
    it('does not duplicate token when one already exists in prompt', () => {
        const v = baseParams({
            prompt: '主图 图片1 走向参考',
            media_inputs: [{ kind: 'image', url: '/a.png' }],
        });
        const next = insertMention(v, imgCandidate({ id: 'cand_img_2', url: '/b.png' }));

        expect(next.media_inputs).toHaveLength(2);
        expect(next.prompt).toMatch(/图片1/);
        expect(next.prompt).toMatch(/图片2/);
    });
    it('reuses the existing media_input when the same image is inserted again', () => {
        const token = `${TOKEN_PREFIX.image}1`;
        const v = baseParams({
            prompt: `scene ${token}`,
            media_inputs: [{ kind: 'image', url: '/storage/assets/hero.png' }],
        });
        const next = insertMention(v, imgCandidate());
        expect(next.media_inputs).toHaveLength(1);
        expect(next.media_inputs[0].url).toBe('/storage/assets/hero.png');
        expect(next.prompt).toBe(`scene ${token}`);
    });
    it('reuses the existing media_input in caret mode', () => {
        const token = `${TOKEN_PREFIX.image}1`;
        const v = baseParams({
            prompt: 'look @hero now',
            media_inputs: [{ kind: 'image', url: '/storage/assets/hero.png' }],
        });
        const next = insertMention(v, imgCandidate(), { atPos: 5, caretPos: 10 });
        expect(next.media_inputs).toHaveLength(1);
        expect(next.prompt).toBe(`look ${token} now`);
    });
});

describe('insertMention (text candidate)', () => {
    it('inserts text content but does not touch media_inputs', () => {
        const v = baseParams({ prompt: 'INT. 卧室 - 夜' });
        const text: SeedanceAssetCandidate = {
            id: 'cand_text_1', group: 'storyboard_data', kind: 'text',
            label: '场景', text: '\n大风吹起窗帘',
        };
        const next = insertMention(v, text);
        expect(next.media_inputs).toHaveLength(0);
        expect(next.prompt).toBe('INT. 卧室 - 夜\n大风吹起窗帘');
    });
});

describe('insertMention (video pricing metadata)', () => {
    it('persists candidate duration for the server-owned credit estimate', () => {
        const candidate: SeedanceAssetCandidate = {
            id: 'cand_video_1',
            group: 'video_segments',
            kind: 'video',
            label: '参考视频',
            url: '/storage/reference.mp4',
            durationMs: 8500,
        };
        const next = insertMention(baseParams(), candidate);
        expect(next.media_inputs[0]).toMatchObject({
            kind: 'video',
            duration_seconds: 8.5,
        });
    });
});



describe('insertMention (caret mode)', () => {
    it('replaces "@搜索词" segment with 图片N at the cursor position', () => {

        const v = baseParams({ prompt: '镜头 @英 走向窗户' });
        const next = insertMention(v, imgCandidate(), { atPos: 3, caretPos: 5 });
        expect(next.media_inputs).toHaveLength(1);
        expect(next.prompt).toBe('镜头 图片1 走向窗户');
    });

    it('inserts at the very start when atPos=0', () => {
        const v = baseParams({ prompt: '@主 描述' });
        const next = insertMention(v, imgCandidate(), { atPos: 0, caretPos: 2 });
        expect(next.prompt).toBe('图片1 描述');
    });

    it('falls back to legacy append when opts is undefined', () => {
        const v = baseParams({ prompt: '英雄登场' });
        const next = insertMention(v, imgCandidate());
        expect(next.prompt).toBe('英雄登场 图片1');
    });

    it('caret mode adds trailing space when next char is non-space', () => {
        const v = baseParams({ prompt: '@x完结' });
        const next = insertMention(v, imgCandidate(), { atPos: 0, caretPos: 2 });
        expect(next.prompt).toBe('图片1 完结');
    });

    it('caret mode does not add trailing space when next char is whitespace', () => {
        const v = baseParams({ prompt: '@x 完结' });
        const next = insertMention(v, imgCandidate(), { atPos: 0, caretPos: 2 });
        expect(next.prompt).toBe('图片1 完结');
    });

    it('caret mode also works for text candidates (replaces @搜索词 with text)', () => {
        const v = baseParams({ prompt: '前缀 @场 尾' });
        const text: SeedanceAssetCandidate = {
            id: 'cand_text_1', group: 'storyboard_data', kind: 'text',
            label: '场景', text: '【场景】卧室',
        };
        const next = insertMention(v, text, { atPos: 3, caretPos: 5 });
        expect(next.media_inputs).toHaveLength(0);
        expect(next.prompt).toBe('前缀 【场景】卧室 尾');
    });
});

describe('insertMention (ark_asset_id)', () => {
    it('treats arkAssetId candidate as media_input with kind=image by default', () => {
        const v = baseParams();
        const cand: SeedanceAssetCandidate = {
            id: 'cand_ark_1', group: 'ark_asset_id', kind: 'image',
            label: 'asset://abc', arkAssetId: 'asset://abc',
        };
        const next = insertMention(v, cand);
        expect(next.media_inputs).toHaveLength(1);
        expect(next.media_inputs[0].kind).toBe('image');
        // url field stores the asset:// id (worker.py converts to image_url with id reference)
        expect(next.media_inputs[0].url).toBe('asset://abc');
        expect(next.prompt).toMatch(/图片1/);
    });
});

describe('removeMediaInput', () => {
    it('renumbers same-kind tokens after removal', () => {
        const v = baseParams({
            prompt: '从 图片1 走到 图片2 然后 图片3',
            media_inputs: [
                { kind: 'image', url: '/a.png' },
                { kind: 'image', url: '/b.png' },
                { kind: 'image', url: '/c.png' },
            ],
        });

        const next = removeMediaInput(v, 1);
        expect(next.media_inputs).toHaveLength(2);
        expect(next.media_inputs[0].url).toBe('/a.png');
        expect(next.media_inputs[1].url).toBe('/c.png');

        expect(next.prompt).toBe('从 图片1 走到  然后 图片2');
    });
    it('renumbers only same kind, leaves others untouched', () => {
        const v = baseParams({
            prompt: '图片1 视频1 音频1 图片2',
            media_inputs: [
                { kind: 'image', url: '/a.png' },
                { kind: 'video', url: '/v.mp4' },
                { kind: 'audio', url: '/a.mp3' },
                { kind: 'image', url: '/b.png' },
            ],
        });
        const next = removeMediaInput(v, 0);
        expect(next.media_inputs).toHaveLength(3);
        expect(next.prompt).toMatch(/视频1/);
        expect(next.prompt).toMatch(/音频1/);
        expect(next.prompt).toMatch(/图片1/);
        expect(next.prompt).not.toMatch(/图片2/);
    });
});

describe('canonicalizePrompt', () => {
    it('marks orphan tokens (no backing media) without deleting them', () => {
        const v = baseParams({
            prompt: '图片1 图片3',
            media_inputs: [{ kind: 'image', url: '/a.png' }],   // only 1
        });
        const result = canonicalizePrompt(v);
        expect(result.orphans).toContain('图片3');
        expect(result.orphans).toHaveLength(1);
        expect(result.prompt).toBe('图片1 图片3');
    });
    it('appends missing tokens for media_inputs not referenced in prompt', () => {
        const v = baseParams({
            prompt: '场景描写',
            media_inputs: [
                { kind: 'image', url: '/a.png' },
                { kind: 'audio', url: '/a.mp3' },
            ],
        });
        const result = canonicalizePrompt(v);
        expect(result.prompt).toMatch(/图片1/);
        expect(result.prompt).toMatch(/音频1/);
        expect(result.added).toEqual(['图片1', '音频1']);
    });
});

describe('shouldEnableWebSearch', () => {
    it('true when no media_inputs + non-empty prompt + supported sub_model', () => {
        expect(shouldEnableWebSearch(baseParams({ prompt: '查一下今天天气' }))).toBe(true);
    });
    it('false when any media_input present', () => {
        expect(shouldEnableWebSearch(baseParams({
            prompt: 'x',
            media_inputs: [{ kind: 'image', url: '/a.png' }],
        }))).toBe(false);
    });
    it('false when prompt is empty', () => {
        expect(shouldEnableWebSearch(baseParams({ prompt: '   ' }))).toBe(false);
    });
});

describe('parseArkAssetId', () => {
    it('accepts valid asset:// strings', () => {
        expect(parseArkAssetId('asset://abc-123')).toBe('asset://abc-123');
        expect(parseArkAssetId('  asset://x  ')).toBe('asset://x');
    });
    it('rejects malformed', () => {
        expect(parseArkAssetId('asset://')).toBeNull();
        expect(parseArkAssetId('http://x')).toBeNull();
        expect(parseArkAssetId('')).toBeNull();
    });
});
