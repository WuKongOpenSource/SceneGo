import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StoryboardImageSourceBadge } from '../../components/StoryboardImageSourceBadge';
import type { GeneratedImage } from '../../types';

afterEach(cleanup);
const base: GeneratedImage = { id: 'image-1', url: '/original.jpg', timestamp: 0 };

describe('storyboard result source badge', () => {
  it('does not infer Seedream text-to-image from a saved model label', () => {
    render(<StoryboardImageSourceBadge image={{ ...base, generationModel: 'doubao-seedream-5.0-lite' }} />);
    expect(screen.queryByText(/Seedream/)).not.toBeInTheDocument();
  });

  it('marks upload immediately and preserves the parent image click action', () => {
    const onClick = vi.fn();
    render(<div onClick={onClick}><StoryboardImageSourceBadge image={{ ...base, source: 'upload' }} /></div>);
    fireEvent.click(screen.getByText('外部上传'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows each image independently and falls back honestly for historical data', () => {
    render(<><StoryboardImageSourceBadge image={{ ...base, generationModel: 'gpt_image_vip' }} />
      <StoryboardImageSourceBadge image={{ ...base, source: 'upload' }} />
      <StoryboardImageSourceBadge image={base} /></>);
    expect(screen.getByText('GPT Image 2 VIP')).toBeInTheDocument();
    expect(screen.getByText('外部上传')).toBeInTheDocument();
    expect(screen.getByText('模型未记录')).toBeInTheDocument();
  });

  it('wires both upload paths, recovered tasks, and per-file reload into the result grid', () => {
    const source = readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf8');
    const page = readFileSync(resolve(__dirname, '../../pages/StoryboardGenPage.tsx'), 'utf8');
    expect(source).toContain('<StoryboardImageSourceBadge image={img} />');
    expect(source.match(/source: 'upload'/g)).toHaveLength(2);
    expect(source).toContain('generationModel: task.model');
    expect(page).toContain('...storyboardImageSource(ef.metadata)');
    expect(source).not.toContain("{img.generationModel || ''}");
  });
});
