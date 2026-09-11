import React, { useEffect, useRef, useState } from 'react';

export const withVideoFirstFrame = (url: string): string => {
  if (!url || url.includes('#')) return url;
  return `${url}#t=0.1`;
};

type LazyVideoPreload = 'none' | 'metadata' | 'auto';

interface LazyVideoProps extends Omit<React.VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'preload'> {
  src: string;
  preload?: LazyVideoPreload;
  rootMargin?: string;
  firstFrame?: boolean;
  hoverPreview?: boolean;
}

export const LazyVideo: React.FC<LazyVideoProps> = ({
  src,
  preload = 'metadata',
  rootMargin = '400px',
  firstFrame = true,
  hoverPreview = true,
  muted = true,
  onMouseEnter,
  onMouseLeave,
  ...props
}) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const hasEnteredView = useRef(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!hasEnteredView.current) {
      setInView(false);
    }
  }, [src]);

  useEffect(() => {
    const element = ref.current;
    if (!element || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      hasEnteredView.current = true;
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        hasEnteredView.current = true;
        setInView(true);
        observer.disconnect();
      }
    }, { rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  const videoSrc = inView && src ? (firstFrame ? withVideoFirstFrame(src) : src) : undefined;

  return (
    <video
      {...props}
      ref={ref}
      src={videoSrc}
      preload={inView ? preload : 'none'}
      muted={muted}
      onMouseEnter={(event) => {
        onMouseEnter?.(event);
        if (hoverPreview && inView) {
          event.currentTarget.play().catch(() => {});
        }
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event);
        if (hoverPreview) {
          event.currentTarget.pause();
          event.currentTarget.currentTime = 0;
        }
      }}
    />
  );
};

export default LazyVideo;
