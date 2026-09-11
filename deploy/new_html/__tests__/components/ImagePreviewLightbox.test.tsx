import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImagePreviewLightbox } from '../../components/ImagePreviewLightbox';

describe('ImagePreviewLightbox', () => {
  it('shows side navigation for multiple images and wraps at both ends', () => {
    const onIndexChange = vi.fn();
    render(
      <ImagePreviewLightbox
        images={['/one.png', '/two.png', '/three.png']}
        currentIndex={0}
        onIndexChange={onIndexChange}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', '/one.png');
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上一张图片' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
  });

  it('supports keyboard arrows and Escape', () => {
    const onIndexChange = vi.fn();
    const onClose = vi.fn();
    render(
      <ImagePreviewLightbox
        images={['/one.png', '/two.png']}
        currentIndex={1}
        onIndexChange={onIndexChange}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('hides navigation controls for a single image', () => {
    render(
      <ImagePreviewLightbox
        images={['/one.png']}
        currentIndex={0}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: '上一张图片' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一张图片' })).not.toBeInTheDocument();
  });
});
