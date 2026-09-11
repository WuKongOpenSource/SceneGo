import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const videoGenSource = readFileSync(resolve(__dirname, '../../pages/VideoGenPage.tsx'), 'utf-8');
const storyboardGenSource = readFileSync(resolve(__dirname, '../../pages/StoryboardGenPage.tsx'), 'utf-8');
const videoPageSource = readFileSync(resolve(__dirname, '../../components/VideoPage.tsx'), 'utf-8');

describe('video workspace storyboard prompt wiring', () => {
  it('builds newly imported prompts from full storyboard context', () => {
    expect(videoGenSource).toContain('const prompt = buildStoryboardVideoPrompt(item as any)');
    expect(videoGenSource).toContain('item?.id');
    expect(videoGenSource).toContain('actionText:');
    expect(videoGenSource).toContain('dialogue:');
  });

  it('loads and persists complete segmented shot identity for the video workspace', () => {
    expect(videoGenSource).toContain('buildVideoStoryboardShotLookup(allStoryboardItemsForImport)');
    expect(videoGenSource).toContain('storyboardShotLabel: shotInfo?.label');
    expect(videoGenSource).toContain('isStoryboardSegmentStart: shotInfo?.isFirstInSegment');
    expect(videoGenSource).toContain('loadStoryboardItemsPage({ limit: totalStoryboardCount, includeTotal: false })');
  });

  it('carries the explicit storyboard selection and selected images into the video workspace', () => {
    expect(readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf-8'))
      .toContain(') || item.generatedImages?.[0]');
    expect(storyboardGenSource).toContain('normalizeStoryboardVideoExportPayload(data)');
    expect(storyboardGenSource).toContain('generated_image_url: item.finalImage');
    expect(storyboardGenSource).toContain('state: buildStoryboardVideoExportNavigationState(payload)');
    expect(videoGenSource).toContain('readStoryboardVideoExportNavigationState(location.state)');
    expect(videoGenSource).toContain('selectStoryboardItemsForVideoExport(');
    expect(videoGenSource).toContain('storyboardVideoExportImages.get(itemId)');
    expect(videoGenSource).toContain('if (storyboardVideoExport) {');
    expect(videoGenSource).toContain('正在导入${importTargetLabel}及其已选画面。');
  });

  it('consumes the one-time router handoff so refresh does not overwrite later video edits', () => {
    expect(videoGenSource).toContain('replace: true');
    expect(videoGenSource).toContain('state: null');
  });

  it('syncs current storyboard images across persisted model parameters and hides the action after success', () => {
    expect(videoGenSource).toContain('current => buildStoryboardImageSyncPatch(current, latestImageById)');
    expect(videoGenSource).toContain('countOutdatedStoryboardImages(verified.session, latestImageById)');
    expect(videoGenSource).toContain('if (!saveResult.success)');
    expect(videoGenSource).toContain("{(changedCount > 0 || syncing) && (");
    expect(videoGenSource).toContain("{syncing ? '同步中…' : '同步最新分镜图'}");
    expect(videoGenSource).not.toMatch(/const latestImageById[\s\S]{0,360}storyboardVideoExportImages\.get/);
  });

  it('upgrades untouched persisted prompts without replacing user edits', () => {
    expect(videoPageSource).toContain('upgradeLegacyStoryboardVideoPrompt(');
    expect(videoPageSource).toContain('getStoryboardPromptSourcesForGroup(group)');
    expect(videoPageSource).toContain('getEffectiveGroupPrompt(group)');
    expect(videoPageSource).toContain('item?.id');
  });

  it('renders hierarchical shot ranges and modal-based reversible merges', () => {
    expect(videoPageSource).toContain('getGroupShotRange(group, index)');
    expect(videoPageSource).not.toContain('`SB-${sortOrder + 1}`');
    expect(videoPageSource).toContain('data-testid="video-merge-dialog"');
    expect(videoPageSource).toContain('data-testid="video-merge-cross-segment-warning"');
    expect(videoPageSource).toContain('data-testid="video-merge-duration-warning"');
    expect(videoPageSource).toContain('data-testid="video-merged-card-dialog"');
    expect(videoPageSource).toContain('removeShotFromMergedCard(group.uuid, childIndex)');
    expect(videoPageSource).toContain('group.ids.length === 2 && !group.mergedFrom?.length');
  });

  it('labels every historical video with the model that generated it', () => {
    expect(videoPageSource).toContain('const videoModel = status.videoModels?.[idx]');
    expect(videoPageSource).toContain('const latestVideoModel = status.videoModels?.[Math.max(0, videos.length - 1)]');
    expect(videoPageSource).toContain('pendingVideoModel: status.pendingVideoModel');
    expect(videoPageSource).toContain("'历史模型未记录'");
    expect(videoPageSource).toContain('title={`#${idx + 1} · ${videoModelLabel}`}');
    expect(videoPageSource).toContain('{videoModelLabel}');
  });
});
