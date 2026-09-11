import React, { useEffect, useRef, useState } from 'react';

interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'loading' | 'decoding'> {
  src: string;
  rootMargin?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'sync' | 'async' | 'auto';
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  rootMargin = '300px',
  loading = 'lazy',
  decoding = 'async',
  ...props
}) => {
  const ref = useRef<HTMLImageElement | null>(null);
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

  return (
    <img
      {...props}
      ref={ref}
      src={inView ? src : undefined}
      loading={loading}
      decoding={decoding}
    />
  );
};

export default LazyImage;
