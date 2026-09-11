import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/VideoPage.tsx'), 'utf-8');

describe('VideoPage per-card credit estimates', () => {
  it('renders estimates from each card settings in both card and list views', () => {
    expect(source).toContain('const getGroupVideoCreditEstimateParams');
    expect(source).toContain('data-testid="video-card-credit-estimate"');
    expect(source).toContain('data-testid="video-list-card-credit-estimate"');
    expect(source.match(/params=\{getGroupVideoCreditEstimateParams\(group\)\}/g)).toHaveLength(2);
    expect(source).toContain('h3_upscale_720p: isMiniMaxH3Model(group.model) && group.h3Upscale720p === true');
    expect(source).toContain('reference_video_count: referenceVideos.length');
    expect(source).toContain('reference_video_durations: referenceVideos.map(item => item.duration_seconds ?? null)');
    expect(source.match(/fallbackCost=\{getGroupVideoCreditFallbackCost\(group\)\}/g)).toHaveLength(2);
  });

  it('does not show the hidden new-card default model as a global per-video price', () => {
    expect(source).not.toContain('params={getVideoCreditEstimateParams(globalModel)}');
    expect(source).not.toContain('<span className="text-[10px] text-n300">每个视频</span>');
  });

  it('refreshes dynamic processing-node capabilities without requiring a page reload', () => {
    expect(source).toContain('window.setInterval(refresh, 15_000)');
    expect(source).toContain('window.clearInterval(refreshTimer)');
    expect(source).toContain('.filter(option => option.available)');
  });
});
