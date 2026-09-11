import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AudioStagePage timeline visibility', () => {
  it('starts collapsed and lets MultiTrackTimeline control expansion', () => {
    const source = readFileSync(
      resolve(__dirname, '../../pages/AudioStagePage.tsx'),
      'utf-8',
    );

    expect(source).toContain('const [timelineCollapsed, setTimelineCollapsed] = useState(true)');
    expect(source).toContain('collapsed={timelineCollapsed}');
    expect(source).toContain('onCollapsedChange={setTimelineCollapsed}');
  });

  it('exposes dubbing and music as parallel top-level workspaces', () => {
    const source = readFileSync(
      resolve(__dirname, '../../pages/AudioStagePage.tsx'),
      'utf-8',
    );

    expect(source).toContain("useState<'dubbing' | 'music'>('dubbing')");
    expect(source).toContain('配音制作');
    expect(source).toContain('音乐生成');
    expect(source).toContain('BGM / 主题曲');
    expect(source).toContain('presentation="embedded"');
    expect(source).toContain('<MusicAssetSidebar audioTracks={audioTracks} />');
    expect(source).toContain('audioTracks={audioTracks}');
  });

  it('places the audio timeline toggle before its title', () => {
    const source = readFileSync(
      resolve(__dirname, '../../components/audio/MultiTrackTimeline.tsx'),
      'utf-8',
    );

    expect(source.indexOf("title={collapsed ? '展开时间轴' : '折叠时间轴'}"))
      .toBeLessThan(source.indexOf('>时间轴</span>'));
  });

  it('starts the combined image and audio timeline collapsed with the same control style', () => {
    const source = readFileSync(
      resolve(__dirname, '../../pages/StoryboardGenPage.tsx'),
      'utf-8',
    );

    expect(source).toContain("page: 'StoryboardGenPage:timelinePanel'");
    expect(source).toContain('version: 2');
    expect(source).toContain('defaultValue: { collapsed: true, heightPx: 260 }');
    expect(source).toContain("title={timelineCollapsed ? '展开时间轴' : '折叠时间轴'}");
    expect(source).toContain('inline-flex h-7 shrink-0 items-center gap-1 rounded-md');
    expect(source.indexOf("title={timelineCollapsed ? '展开时间轴' : '折叠时间轴'}"))
      .toBeLessThan(source.indexOf('图 + 音联合时间轴'));
  });
});
