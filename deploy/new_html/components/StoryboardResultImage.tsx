import React, { useEffect, useState } from 'react';
import { getImageThumbnailUrl } from '../services/imageLoaderService';

/** Preview recovery only: the original result URL and generation state never change. */
export function StoryboardResultImage({ url, thumbnail }: { url: string; thumbnail?: string }) {
  const preview = getImageThumbnailUrl(thumbnail || url, 360, 220);
  const [original, setOriginal] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setOriginal(false); setFailed(false); setAttempt(0); }, [url, thumbnail]);
  const retry = () => { setAttempt(value => value + 1); setOriginal(false); setFailed(false); };
  useEffect(() => {
    if (!failed || attempt > 0) return;
    const timer = setTimeout(retry, 1500);
    return () => clearTimeout(timer);
  }, [failed, attempt]);
  useEffect(() => {
    if (!failed) return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [failed]);
  return <>
    <img key={`${url}:${original}:${attempt}`} src={original ? url : preview} loading="lazy" decoding="async"
      alt={failed ? '图片暂未加载' : ''} className="h-full w-full object-contain transition-opacity duration-300"
      style={{ opacity: failed ? 0.3 : 1 }}
      onLoad={() => setFailed(false)}
      onError={() => { if (!original && preview !== url) setOriginal(true); else setFailed(true); }} />
    {failed && <div className="absolute inset-0 z-10 flex items-center justify-center bg-n20/90">
      <button type="button" onClick={event => { event.stopPropagation(); retry(); }}
        className="rounded-lg border border-primary/30 bg-n0 px-3 py-2 text-xs text-primary">
        重新加载图片
      </button>
    </div>}
  </>;
}
