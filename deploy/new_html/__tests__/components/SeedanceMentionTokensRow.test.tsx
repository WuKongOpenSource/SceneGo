import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SeedanceMentionTokensRow } from '../../components/SeedanceMentionTokensRow';
import { baseParams } from '../utils/_fixtures/seedance';

describe('SeedanceMentionTokensRow', () => {
    it('renders nothing when no media and hideWhenEmpty defaults true', () => {
        const { container } = render(
            <SeedanceMentionTokensRow value={baseParams()} onChange={() => {}} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders one chip per media_inputs entry with 图片N / 视频N / 音频N labels', () => {
        const value = baseParams({
            media_inputs: [
                { kind: 'image', url: '/a.png', role: 'reference_image' },
                { kind: 'image', url: '/b.png', role: 'reference_image' },
                { kind: 'video', url: '/c.mp4', role: 'reference_video' },
                { kind: 'audio', url: '/d.mp3', role: 'reference_audio' },
            ],
        });
        render(<SeedanceMentionTokensRow value={value} onChange={() => {}} />);
        const row = screen.getByTestId('seedance-mention-tokens-row');
        expect(within(row).getByText('图片1')).toBeInTheDocument();
        expect(within(row).getByText('图片2')).toBeInTheDocument();
        expect(within(row).getByText('视频1')).toBeInTheDocument();
        expect(within(row).getByText('音频1')).toBeInTheDocument();
    });

    it('clicking the X on a chip removes the media and renumbers tokens in prompt', () => {
        const onChange = vi.fn();
        const value = baseParams({
            prompt: '镜头描述 图片1 图片2',
            media_inputs: [
                { kind: 'image', url: '/a.png', role: 'reference_image' },
                { kind: 'image', url: '/b.png', role: 'reference_image' },
            ],
        });
        render(<SeedanceMentionTokensRow value={value} onChange={onChange} />);

        const removeBtn = screen.getByLabelText('删除 图片1');
        fireEvent.click(removeBtn);
        expect(onChange).toHaveBeenCalled();
        const next = onChange.mock.calls[0][0];
        expect(next.media_inputs).toHaveLength(1);
        expect(next.media_inputs[0].url).toBe('/b.png');

        expect(next.prompt).toContain('图片1');
        expect(next.prompt).not.toContain('图片2');
    });

    it('clicking the thumbnail of an image chip calls onPreview(url, "image")', () => {
        const onPreview = vi.fn();
        const value = baseParams({
            media_inputs: [{ kind: 'image', url: '/a.png', role: 'reference_image' }],
        });
        render(<SeedanceMentionTokensRow value={value} onChange={() => {}} onPreview={onPreview} />);
        const previewBtn = screen.getByTitle('点击预览 图片1');
        fireEvent.click(previewBtn);
        expect(onPreview).toHaveBeenCalledWith('/a.png', 'image');
    });

    it('hovering an image chip shows a larger preview overlay', () => {
        const value = baseParams({
            media_inputs: [{ kind: 'image', url: '/a.png', role: 'reference_image' }],
        });
        render(<SeedanceMentionTokensRow value={value} onChange={() => {}} />);
        const chip = screen.getByText('图片1').closest('div')!;
        // Default: only one <img> (the thumbnail)
        expect(screen.getAllByRole('img')).toHaveLength(1);
        fireEvent.mouseEnter(chip);
        // After hover: thumbnail + overlay = 2 imgs
        expect(screen.getAllByRole('img')).toHaveLength(2);
        fireEvent.mouseLeave(chip);
        expect(screen.getAllByRole('img')).toHaveLength(1);
    });
});
