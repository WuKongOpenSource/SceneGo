import React, { useState, useCallback, useEffect, useRef, ImgHTMLAttributes } from 'react';
import { ImageOff, RefreshCw } from 'lucide-react';

interface MediaImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'> {
  src: string;
  thumbnailSrc?: string;
  alt?: string;
  maxRetries?: number;
  fallbackClassName?: string;
}






export function MediaImage({ 
  src, 
  thumbnailSrc,
  alt = '', 
  maxRetries = 2,
  fallbackClassName,
  className,
  style,
  ...props 
}: MediaImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [retryCount, setRetryCount] = useState(0);
  const [isFullLoaded, setIsFullLoaded] = useState(!thumbnailSrc);
  const fullImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!thumbnailSrc || thumbnailSrc === src) {
      setIsFullLoaded(true);
      return;
    }
    const img = new Image();
    fullImgRef.current = img;
    img.onload = () => setIsFullLoaded(true);
    img.onerror = () => {};
    const cacheBuster = retryCount > 0 ? `${src.includes('?') ? '&' : '?'}_r=${retryCount}` : '';
    img.src = `${src}${cacheBuster}`;
    return () => { img.onload = null; img.onerror = null; };
  }, [src, thumbnailSrc, retryCount]);

  const handleError = useCallback(() => {
    if (retryCount < maxRetries) {
      setTimeout(() => {
        setRetryCount(c => c + 1);
        setStatus('loading');
      }, 1000 * (retryCount + 1));
    } else {
      setStatus('error');
    }
  }, [retryCount, maxRetries]);

  const handleRetry = useCallback(() => {
    setRetryCount(0);
    setStatus('loading');
    setIsFullLoaded(!thumbnailSrc);
  }, [thumbnailSrc]);

  if (status === 'error') {
    return (
      <div 
        className={fallbackClassName || className || 'flex flex-col items-center justify-center bg-n30 rounded'}
        style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 60 }}
      >
        <ImageOff className="w-6 h-6 text-n100" />
        <button 
          onClick={handleRetry}
          className="text-[10px] text-b400 hover:text-b300 mt-1 flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          重新加载
        </button>
      </div>
    );
  }

  const cacheBuster = retryCount > 0 ? `${src.includes('?') ? '&' : '?'}_r=${retryCount}` : '';
  const displaySrc = thumbnailSrc && !isFullLoaded ? thumbnailSrc : `${src}${cacheBuster}`;

  return (
    <img 
      src={displaySrc}
      alt={alt}
      className={`${className || ''} transition-[filter] duration-500 ${!isFullLoaded ? 'blur-sm scale-[1.02]' : 'blur-0 scale-100'}`}
      style={style}
      onError={handleError}
      onLoad={() => setStatus('loaded')}
      {...props}
    />
  );
}

export default MediaImage;
