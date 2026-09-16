import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { SeedreamSourceBadge } from '../SeedreamSourceBadge';

interface VideoMediaPreviewProps {
  url: string;
  kind: 'image' | 'video';
  onClose: () => void;
}

/** Preview is above the expanded composer (9500) and its pickers (9700–9900). */
export const VideoMediaPreview: React.FC<VideoMediaPreviewProps> = ({ url, kind, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const label = kind === 'image' ? '图片预览' : '视频预览';

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  useEffect(() => {
    // Clicking an image can move focus to body. Capture Escape before the
    // underlying prompt dialog's document listener can dismiss that editor.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  // A body portal also escapes transforms/stacking contexts on the workflow page.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={label}
      className="fixed inset-0 z-[10000] bg-n900/90 flex items-center justify-center"
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <button ref={closeRef} type="button" aria-label={`关闭${label}`} onClick={onClose}
        className="absolute top-4 right-4 z-10 text-white hover:text-n300">
        <X className="w-8 h-8" />
      </button>
      <a href={url} download aria-label={kind === 'image' ? '下载原图' : '下载视频'}
        className="absolute top-4 right-16 z-10 text-white hover:text-n300">
        <Download className="w-8 h-8" />
      </a>
      {kind === 'image' && <div className="absolute top-4 left-4 z-10 rounded bg-white/95 p-2">
        <SeedreamSourceBadge reference={url} />
      </div>}
      {kind === 'video'
        ? <video src={url} preload="metadata" className="max-w-[90vw] max-h-[90vh]" controls autoPlay />
        : <img src={url} decoding="async" alt="原图预览" className="max-w-[90vw] max-h-[90vh] object-contain" />}
    </div>,
    document.body,
  );
};
