import React, { useState } from 'react';
import { Film } from 'lucide-react';

interface FilmstripThumbnailProps {
  src: string | null;
  alt: string;
}

const sprocketHoles: React.CSSProperties = {
  backgroundImage: 'radial-gradient(ellipse at center, rgba(255,255,255,0.92) 0 42%, transparent 47%)',
  backgroundRepeat: 'repeat-x',
  backgroundPosition: 'center',
  backgroundSize: '18px 8px',
};




export const FilmstripThumbnail: React.FC<FilmstripThumbnailProps> = ({ src, alt }) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const unavailable = !src || failedSrc === src;

  return (
    <div data-testid="filmstrip-thumbnail" className="relative h-full w-full overflow-hidden bg-n20">
      {unavailable ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-n100">
          <Film size={30} />
          <span className="text-[10px]">视频缩略图暂不可用</span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      )}

      {!unavailable && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-x-0 top-0 h-[14%] min-h-4 bg-n900">
            <div
              data-testid="filmstrip-sprockets-top"
              className="absolute inset-x-1 top-1/2 h-2 -translate-y-1/2"
              style={sprocketHoles}
            />
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[14%] min-h-4 bg-n900">
            <div
              data-testid="filmstrip-sprockets-bottom"
              className="absolute inset-x-1 top-1/2 h-2 -translate-y-1/2"
              style={sprocketHoles}
            />
          </div>
        </div>
      )}
    </div>
  );
};
