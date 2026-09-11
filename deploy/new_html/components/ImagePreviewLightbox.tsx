import React, { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

interface ImagePreviewLightboxProps {
  images: string[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export const ImagePreviewLightbox: React.FC<ImagePreviewLightboxProps> = ({
  images,
  currentIndex,
  onIndexChange,
  onClose,
}) => {
  const safeIndex = images.length > 0
    ? Math.min(Math.max(0, currentIndex), images.length - 1)
    : 0;
  const hasMultipleImages = images.length > 1;

  const move = useCallback((step: -1 | 1) => {
    if (!hasMultipleImages) return;
    onIndexChange((safeIndex + step + images.length) % images.length);
  }, [hasMultipleImages, images.length, onIndexChange, safeIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        move(1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [move, onClose]);

  if (!images.length) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-n900/65 p-8 backdrop-blur-sm"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        aria-label="关闭图片预览"
        onClick={onClose}
        className="absolute right-6 top-6 z-20 rounded-full bg-black/50 p-2 text-white/80 transition-colors hover:text-white"
      >
        <X size={24} />
      </button>

      {hasMultipleImages && (
        <>
          <button
            type="button"
            aria-label="上一张图片"
            title="上一张（←）"
            onClick={() => move(-1)}
            className="absolute left-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/55 p-3 text-white/85 shadow-lg transition-all hover:scale-105 hover:bg-black/70 hover:text-white sm:left-7"
          >
            <ChevronLeft size={34} />
          </button>
          <button
            type="button"
            aria-label="下一张图片"
            title="下一张（→）"
            onClick={() => move(1)}
            className="absolute right-4 top-1/2 z-20 -translate-y-1/2 rounded-full bg-black/55 p-3 text-white/85 shadow-lg transition-all hover:scale-105 hover:bg-black/70 hover:text-white sm:right-7"
          >
            <ChevronRight size={34} />
          </button>
          <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs text-white/90">
            {safeIndex + 1} / {images.length}
          </div>
        </>
      )}

      <img
        src={images[safeIndex]}
        alt={`图片预览 ${safeIndex + 1}/${images.length}`}
        className="max-h-[calc(100vh-4rem)] max-w-[calc(100vw-7rem)] rounded-lg object-contain shadow-2xl"
        onMouseDown={event => event.stopPropagation()}
      />
    </div>
  );
};
