import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../pages/EnhancePage.tsx'), 'utf-8');

describe('EnhancePage compose audio mode', () => {
  it('does not show local upscale counters as an overall percentage on the page', () => {
    const upscale = source.slice(source.indexOf("kind: 'video-upscale'"));
    const progress = upscale.slice(upscale.indexOf('onProgress:'), upscale.indexOf('onComplete:'));
    expect(progress).toContain('setProcessProgress(0)');
    expect(progress).toContain('视频放大处理中，阶段详情见任务通知');
    expect(progress).not.toContain('Math.floor');
    const restored = source.slice(source.indexOf('attachVideoPollCallbacks(uuid,'), source.indexOf('const applyEnhancement'));
    expect(restored).toContain("uuid.startsWith('enhance-upscale:')");
    expect(restored).toContain('setProcessProgress(isUpscale ? 0 : progress > 1 ? Math.floor(progress) : Math.floor(progress * 100))');
    expect(source).toContain('setProcessProgress(progress > 1 ? Math.floor(progress) : Math.floor(progress * 100))');
  });

  it('uses a deterministic subtitle canvas for black clips and transitions', () => {
    expect(source).toContain('sourceWidth={videoUnderPlayhead?.isBlack || blackTransitionUnderPlayhead ? 1920 : previewSourceSize.width}');
    expect(source).toContain('sourceHeight={videoUnderPlayhead?.isBlack || blackTransitionUnderPlayhead ? 1080 : previewSourceSize.height}');
  });
  it('defaults future compositions to video original audio', () => {
    expect(source).toContain(
      'useState<ComposeAudioMode>(DEFAULT_COMPOSE_AUDIO_MODE)',
    );
    expect(source).toContain("enabled: composeAudioMode === 'reference_dubbing' || clip.audioKind !== 'voice'");
  });

  it('does not let a completed legacy job restore video-original mode', () => {
    expect(source).toContain(
      "if (s.status === 'running' && s.audio_mode) setComposeAudioMode(s.audio_mode)",
    );
    expect(source).not.toContain(
      'if (s.audio_mode) setComposeAudioMode(s.audio_mode)',
    );
  });

  it('warns when video-original mode would ignore timeline dubbing', () => {
    expect(source).toContain("voiceClips.length > 0 && composeAudioMode === 'video_original'");
    expect(source).toContain('仅忽略时间线配音');
  });

  it('exposes voice, music and sound-effect entry points with separate timeline lanes', () => {
    expect(source).toContain('加入配音');
    expect(source).toContain('背景音乐');
    expect(source).toContain('特效音');
    expect(source).toContain("{ key: 'voice', clips: visibleTimeline.voice }");
    expect(source).toContain("{ key: 'bgm', clips: visibleTimeline.bgm }");
    expect(source).toContain("{ key: 'sfx', clips: visibleTimeline.sfx }");
  });

  it('offers precise audio alignment controls instead of drag-only editing', () => {
    expect(source).toContain('对齐当前视频片段');
    expect(source).toContain('移到播放头');
    expect(source).toContain('开始时间（秒）');
    expect(source).toContain('使用时长（秒）');
  });

  it('shows queue acceptance and processing failures inside the page', () => {
    expect(source).toContain('任务已进入处理队列');
    expect(source).toContain('role="alert"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain('setEnhanceError(`提交');
  });

  it('provides practical timeline editing controls and server-backed saving', () => {
    expect(source).toContain('撤销（Ctrl+Z）');
    expect(source).toContain('重做（Ctrl+Y / Ctrl+Shift+Z）');
    expect(source).toContain('在播放头处切分');
    expect(source).toContain('复制选中片段');
    expect(source).toContain('磁吸到播放头和片段边缘');
    expect(source).toContain("ripple: clip.type === 'video'");
    expect(source).toContain('拖动裁剪入点');
    expect(source).toContain('拖动裁剪出点');
    expect(source).toContain('createTimelineTrack');
    expect(source).toContain('updateTimelineTrack');
  });

  it('composes from the current edited cut list', () => {
    expect(source).toContain('const timeline = composeTimelineItems(clipsRef.current)');
    expect(source).toContain('await preflightCompose(episodeId, timeline)');
    expect(source).toContain('validatedTimeline');
    expect(source).toContain('const subtitleItems = composeSubtitleItems(subtitlesRef.current)');
    expect(source).toContain('composeSubtitleStyle(subtitleStyleRef.current)');
  });

  it('provides the complete subtitle editing and preview contract', () => {
    expect(source).toContain('在播放头位置添加字幕');
    expect(source).toContain('字幕内容');
    expect(source).toContain('开始时间（秒）');
    expect(source).toContain('持续时间（秒）');
    expect(source).toContain('<option value="top">上</option>');
    expect(source).toContain('<option value="center">中</option>');
    expect(source).toContain('<option value="bottom">下</option>');
    expect(source).toContain('文字颜色');
    expect(source).toContain('背景颜色');
    expect(source).toContain('背景透明度');
    expect(source).toContain('handleSubtitleDragStart');
    expect(source).toContain('handleSubtitleTrimStart');
    expect(source).toContain('cues={activeSubtitles}');
    expect(source).toContain('onChange={(id, updates) => updateSubtitleStyle(updates, id)}');
    expect(source).toContain('subtitles: updateSubtitleCueStyle(current.subtitles, cueId, updates, applySubtitleStyleToAll)');
    expect(source).not.toContain('位置应用于全部字幕');
  });

  it('requires opt-in for batch styling, resets scope per episode, and keeps changes undoable', () => {
    expect(source).toContain('const [applySubtitleStyleToAll, setApplySubtitleStyleToAll] = useState(false)');
    expect(source).toContain("const scope = episodeId || '';\n    setApplySubtitleStyleToAll(false)");
    expect(source).toContain('checked={applySubtitleStyleToAll}');
    expect(source).toContain('onChange={event => setApplySubtitleStyleToAll(event.target.checked)}');
    expect(source).toContain('同步修改所有字幕样式');
    expect(source).toContain('仅同步调整项，不改变文字和时间；新增字幕保持默认设置。');
    expect(source).toMatch(/const updateSubtitleStyle[\s\S]*?commitSubtitleTimeline\(current =>[\s\S]*?updateSubtitleCueStyle\(current.subtitles, cueId, updates, applySubtitleStyleToAll\)/);
    expect(source).toContain('[applySubtitleStyleToAll, commitSubtitleTimeline, selectedSubtitleId]');
  });
});
