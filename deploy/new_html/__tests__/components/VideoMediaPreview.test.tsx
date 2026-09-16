import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VideoMediaPreview } from '../../components/video/VideoMediaPreview';

vi.mock('../../components/SeedreamSourceBadge', () => ({ SeedreamSourceBadge: () => null }));

describe('VideoMediaPreview', () => {
  it.each(['image', 'video'] as const)('portals the %s preview above the editor and keeps the original download URL', kind => {
    const onClose = vi.fn();
    const url = kind === 'image' ? '/api/files/file_original/download?version=original' : '/original.mp4';
    const view = render(<div style={{ transform: 'translateX(0)', zIndex: 1 }}>
      <VideoMediaPreview url={url} kind={kind} onClose={onClose} />
    </div>);
    const preview = screen.getByRole('dialog');
    expect(preview.parentElement).toBe(document.body);
    expect(preview).toHaveClass('z-[10000]');
    expect(view.container).not.toContainElement(preview);
    const media = preview.querySelector(kind === 'image' ? 'img' : 'video')!;
    expect(media).toHaveAttribute('src', url);
    expect(within(preview).getByRole('link')).toHaveAttribute('href', url);
    expect(within(preview).getByRole('link')).toHaveAttribute('download');
    fireEvent.click(media);
    expect(onClose).not.toHaveBeenCalled();
    if (kind === 'video') {
      expect(media).toHaveAttribute('controls');
      expect(media).toHaveAttribute('autoplay');
    }
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('consumes Escape even after focus leaves the preview and removes the listener on close', () => {
    const onClose = vi.fn();
    const underlyingDialogKeyDown = vi.fn();
    document.addEventListener('keydown', underlyingDialogKeyDown);
    try {
      const view = render(<VideoMediaPreview url="/original.png" kind="image" onClose={onClose} />);
      (document.activeElement as HTMLElement).blur();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(underlyingDialogKeyDown).not.toHaveBeenCalled();
      view.unmount();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(underlyingDialogKeyDown).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', underlyingDialogKeyDown);
    }
  });

  it('restores focus without unmounting the editor or losing its caret and scroll', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <>
        <textarea defaultValue="人物图片1，保持动作" />
        <button onClick={() => setOpen(true)}>预览人物</button>
        {open && <VideoMediaPreview url="/original.png" kind="image" onClose={() => setOpen(false)} />}
      </>;
    }
    render(<Harness />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(4, 4);
    textarea.scrollTop = 25;
    fireEvent.click(screen.getByRole('button', { name: '预览人物' }));
    const close = screen.getByRole('button', { name: '关闭图片预览' });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(4);
    expect(textarea.scrollTop).toBe(25);
    expect(textarea).toHaveValue('人物图片1，保持动作');
  });
});
