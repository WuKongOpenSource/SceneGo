import React from 'react';
import type { GeneratedImage } from '../types';
import { storyboardImageSourceLabel } from '../utils/storyboardImageSource';

export function StoryboardImageSourceBadge({ image }: { image: GeneratedImage }) {
  const label = storyboardImageSourceLabel(image);
  const source = image.source === 'upload' ? '外部上传' : image.generationModel
    ? `生成模型：${image.generationModel}` : '该图片没有保存模型记录';
  const title = image.timestamp > 0 ? `${source} · ${new Date(image.timestamp).toLocaleString()}` : source;
  return (
    <span
      data-testid="storyboard-image-source-badge"
      className="absolute left-1 top-1 z-10 max-w-[calc(100%-2.5rem)] truncate rounded bg-primary/90 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
      title={title}
    >
      {label}
    </span>
  );
}
