import { describe, expect, it } from 'vitest';
import { resolveVideoImageIdentifier, extractFileId } from '../../utils/videoImageIdentifier';
import type { UploadedImage } from '../../services/videoTaskTypes';

const image = (over: Partial<UploadedImage>): UploadedImage => ({
    id: 'img_1',
    url: '',
    filename: '',
    uploadTime: 1,
    ...over,
});

describe('extractFileId', () => {
    it('extracts file_id from download urls', () => {
        expect(extractFileId('/api/files/file_abc123/download')).toBe('file_abc123');
        expect(extractFileId('https://app.example.test/api/files/file_abc123/download')).toBe('file_abc123');
    });
});

describe('resolveVideoImageIdentifier', () => {
    it('uses persistent url for ComfyUI instead of storyboard display filename', () => {
        const img = image({
            filename: 'storyboard_1.png',
            url: '/api/files/file_real123/download',
            storageUrl: '/api/files/file_real123/download',
        });

        expect(resolveVideoImageIdentifier(img, false)).toBe('/api/files/file_real123/download');
    });

    it('keeps explicit ComfyUI filename first', () => {
        const img = image({
            filename: 'storyboard_1.png',
            url: '/api/files/file_real123/download',
            comfyuiFilename: 'already_uploaded.png',
        });

        expect(resolveVideoImageIdentifier(img, false)).toBe('already_uploaded.png');
    });

    it('uses file_id for external API models', () => {
        const img = image({
            filename: 'storyboard_1.png',
            storageUrl: '/api/files/file_real123/download',
        });

        expect(resolveVideoImageIdentifier(img, true)).toBe('file_real123');
    });

    it('uses the persistent storyboard URL instead of its display filename for external APIs', () => {
        const img = image({
            filename: 'storyboard_35.png',
            url: '/storage/image/storyboard-real.png',
            storageUrl: '/storage/image/storyboard-real.png',
        });

        expect(resolveVideoImageIdentifier(img, true)).toBe('/storage/image/storyboard-real.png');
    });

    it('does not use storyboard display names as external API transfer refs', () => {
        expect(resolveVideoImageIdentifier(image({ filename: 'storyboard_35.png' }), true)).toBe('');
    });

    it('does not use storyboard or placeholder display names as ComfyUI transfer refs', () => {
        expect(resolveVideoImageIdentifier(image({ filename: 'storyboard_1.png' }), false)).toBe('');
        expect(resolveVideoImageIdentifier(image({ filename: 'placeholder_1' }), false)).toBe('');
        expect(resolveVideoImageIdentifier(image({ filename: '空卡片' }), false)).toBe('');
    });
});
