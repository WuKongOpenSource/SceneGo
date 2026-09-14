import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf-8')
  + readFileSync(resolve(__dirname, '../../components/ProjectMaterialPicker.tsx'), 'utf-8');
const storyboardPageSource = readFileSync(resolve(__dirname, '../../pages/StoryboardGenPage.tsx'), 'utf-8');

describe('GenerationPage duplicate generation guards', () => {
  it('reports failures without a blocking alert that delays clearing shot progress', () => {
    const current = source.slice(source.indexOf('const handleGenerateCurrent'), source.indexOf('const handleBatchGenerate'));
    expect(current).toContain('crmMessage.error(');
    expect(current).not.toContain('alert(');
    expect(current).toContain('finally');
    expect(current).toContain('next.delete(shotId)');
    expect(current).toContain('clearShotProgress(shotId)');
  });
  it('routes each shot through the single-flight guard', () => {
    expect(source).toContain('generationRequestsRef.current');
    expect(source).toContain('runSingleFlight(');
    expect(source).toContain('() => executeGenerationForShot(shot, useCurrentState, model, currentRefs)');
  });

  it('does not run automatic review, retry, or model rerouting after generation', () => {
    expect(source).not.toContain('GenerationPage:smartConsistencyRouting');
    expect(source).not.toContain('GenerationPage:qualityReviewEnabled');
    expect(source).not.toContain('GenerationPage:autoRetryConsistency');
    expect(source).not.toContain('reviewStoryboardImage(');
    expect(source).not.toContain('resolveConsistencyModel(');
    expect(source).not.toContain('resolveGenerationAttemptResults(');
    expect(source).not.toContain('生成后自动验收');
    expect(source).not.toContain('不合格自动重试 1 次');
    expect(source).not.toContain('角色一致性优先调度');
  });
});

describe('GenerationPage image output settings', () => {
  it('defaults every storyboard image model to the project ratio and 1K', () => {
    expect(source).toContain("page: 'GenerationPage:imageRatio'");
    expect(source).toContain("defaultImageRatio = '16:9'");
    expect(source).toContain('defaultValue: defaultImageRatio');
    expect(source).toContain("page: 'GenerationPage:imageK'");
    expect(source).toContain("defaultValue: '1K'");
  });

  it('resolves auto settings before calling any provider', () => {
    expect(source).toContain('const resolvedImageSettings = resolveGptImageSettings(');
    expect(source).toContain('aspectRatio: resolvedImageSettings.ratio');
    expect(source).toContain('ratio: resolvedImageSettings.ratio');
    expect(source).toContain('outputWidth, outputHeight');
  });

  it('explains that automatic mode follows the largest reference image', () => {
    expect(source).toContain('按最大参考图和尺寸自动决定档位');
  });
});

describe('GenerationPage progress feedback', () => {
  it('labels provider progress separately from time-based estimates', () => {
    expect(source).toContain('实时进度');
    expect(source).toContain('预计进度');
    expect(source).toContain('formatStoryboardGenerationEta');
  });

  it('connects ComfyUI provider progress to the active shot', () => {
    expect(source).toContain(
      'progress => updateShotProviderProgress(shot.id, progress)',
    );
  });

  it('shows progress for single-shot and batch generation', () => {
    expect(source).toContain('currentGenerationProgress?.percent');
    expect(source).toContain('batchProgressDisplay?.aggregatePercent');
  });

  it('keeps estimated progress and remaining time on one line', () => {
    expect(source).toContain('mt-1 whitespace-nowrap text-[9px] text-primary/80');
    expect(source).toContain('mt-0.5 whitespace-nowrap text-[8px] text-n300');
    expect(source).toContain('mt-2 whitespace-nowrap text-[10px] text-n300');
  });
});

describe('GenerationPage storyboard rail layout', () => {
  it('gives double-digit segmented shot labels enough default rail width', () => {
    expect(source).toMatch(
      /page: 'GenerationPage:sidebarWidth',[\s\S]*?version: 2,[\s\S]*?defaultValue: 340,/,
    );
  });

  it('matches the script file rail with a compact title row and blue active edge', () => {
    expect(source).toContain('data-testid="storyboard-shot-list-title-row"');
    expect(source).toContain('({storyboardTotalCount})');
    expect(source).toContain('data-testid="storyboard-shot-card"');
    expect(source).toContain('border-b border-l-[3px]');
    expect(source).toContain("? 'border-l-primary bg-primary-light'");
    expect(source).toContain('line-clamp-2 min-h-10');
  });

  it('places segment headings outside the selectable shot cards while keeping hierarchical labels', () => {
    expect(source).toContain('buildStoryboardSegmentLookup(');
    expect(source).toContain('segmentInfo?.localShotLabel');
    expect(source).toMatch(/<StoryboardShotListEntry key=\{item.id\} segment=\{segmentInfo\}>\s*<div\s*data-testid="storyboard-shot-card"/);
    expect(source).not.toContain('segmentInfo?.isFirstInSegment');
  });
});

describe('GenerationPage other storyboard references', () => {
  it('offers other storyboard images without changing the source shot', () => {
    expect(source).toContain("['other-shot', '其他分镜']");
    expect(source).toContain('buildOtherStoryboardImagePickerItems(');
    expect(source).toContain('handleAddOtherStoryboardImage');
    expect(source).toContain('await onLoadAllStoryboardItems();');
    expect(source).toContain('其他分镜图片只建立当前镜头引用，不会修改来源镜头');
  });
});

describe('GenerationPage material picker modal', () => {
  it('shows a stable count badge on every filter and keeps the dialog size fixed', () => {
    expect(source).toContain('<ProjectMaterialPicker');
    expect(source).toContain('useProjectMaterialPicker(');
    expect(source).toContain('const materialPickerFilterCounts = useMemo');
    expect(source).toContain('const count = materialPickerFilterCounts[value];');
    expect(source).toContain('data-testid="material-picker-dialog"');
    expect(source).toContain('w-[min(1024px,calc(100vw-32px))] h-[min(760px,calc(100vh-2rem))]');
    expect(source).toContain('flex-1 min-h-0 overflow-y-auto p-5');
    expect(source).not.toContain("value === 'other-shot' && otherStoryboardImageItems.length > 0");
  });
});

describe('GenerationPage external reference persistence', () => {
  it('keeps current manual references during unrelated updates and saves edits immediately', () => {
    expect(source).toContain('activeReferenceShotIdRef.current');
    expect(source).toContain('resolveSelectedShotReferences(');
    expect(source).toContain('referencesRef.current = nextReferences');
    expect(source).toContain('configuredReferences: nextReferences');
    expect(source).toContain('referenceConfigInitialized: true');
    expect(source).not.toContain('pendingSaveRef.current');
  });

  it('keeps reference edits in the routed page snapshot while the server save is pending', () => {
    expect(storyboardPageSource).toContain('configuredReferenceDrafts');
    expect(storyboardPageSource).toContain('applyConfiguredReferenceDrafts(');
    expect(storyboardPageSource).toContain('[shotId]: nextReferences');
    expect(storyboardPageSource).toContain('storyboardItemToDbUpdate(resolvedUpdates)');
  });
});

describe('GenerationPage reference actions', () => {
  it('validates exact submitted references before progress, credits, or provider calls', () => {
    const execute = source.slice(source.indexOf('const executeGenerationForShot'), source.indexOf('const generateForShot'));
    expect(execute.indexOf('await validateImageReferences(submittedReferences')).toBeGreaterThan(execute.indexOf('storyboardSubmissionReferences('));
    expect(execute.indexOf('await validateImageReferences(submittedReferences')).toBeLessThan(execute.indexOf('await assertEnoughCredits('));
    expect(execute.indexOf('await validateImageReferences(submittedReferences')).toBeLessThan(execute.indexOf('beginShotProgress('));
    expect(source).toContain('onError={() => markReferenceAvailability(ref.url, false)}');
    expect(source).toContain('onLoad={() => markReferenceAvailability(ref.url, true)}');
    expect(source).toContain('素材不可用，请重新选择');
    expect(source).toContain('不会自动忽略这些参考图');
  });
  it('keeps the submitted reference list independent from material bindings', () => {
    expect(source).toContain('handleDeleteReference(ref)');
    expect(source).toContain('从当前镜头删除参考图片');
    expect(source).not.toContain('handleSetReferenceLocked');
    expect(source).not.toContain('detachShotReference');
    const referenceControls = source.slice(source.indexOf('{/* Reference Images */}'));
    expect(referenceControls).toContain('handleDeleteReference(ref)');
    expect(referenceControls).not.toContain('素材绑定');
    expect(source).not.toContain('当前绑定');
    expect(source).not.toContain('解除素材绑定');
    expect(source).not.toContain('目标镜头的参考图片已锁定');
    expect(source).not.toContain('disabled={selectedShot?.isConfigConfirmed || references.length >= 6}');
    expect(source).not.toContain('disabled={references.length >= 6 || selectedShot?.isConfigConfirmed}');
  });

  it('keeps reference image actions available on hover inside narrow cards', () => {
    expect(source).toContain('data-testid="reference-image-actions"');
    expect(source).toContain('grid grid-cols-2 gap-1');
    expect(source).toContain('pointer-events-none absolute right-1 top-1 z-10 grid grid-cols-2 gap-1 opacity-0');
    expect(source).toContain('group-hover:pointer-events-auto group-hover:opacity-100');
    expect(source).toContain('inline-flex h-5 w-5 items-center justify-center');
  });

  it('copies cross-shot images into submitted references instead of generated results', () => {
    expect(source).toContain("'reference_image',");
    expect(source).toContain(
      'configuredReferences: [...currentReferences, copiedReference].slice(0, 6)',
    );
    expect(source).toContain('从其他镜头的画面分镜结果拖入');
    expect(source).toContain('实际提交参考图片');
  });

  it('uses the requested independent reference labels and preserves bottom scroll space', () => {
    expect(source).toContain('项目素材');
    expect(source).toContain('自动绑定');
    expect(source).toContain('mt-1 text-[11px] font-normal text-n100">可拖拽图片到此');
    expect(source).toContain('whitespace-nowrap rounded border border-primary bg-primary px-3 py-2 text-xs');
    expect(source).toContain('whitespace-nowrap rounded border border-primary/30 bg-primary-light px-3 py-2 text-xs');
    expect(source).not.toContain('<span className="font-normal text-n100 ml-2">可拖拽图片到此</span>');
    expect(source).not.toContain('从项目素材选择');
    expect(source).not.toContain('恢复绑定素材');
    expect(source).toContain('storyboard-config-pane min-h-0');
    expect(source).toContain('pb-24');
    expect(storyboardPageSource).toContain('layout-safe flex-1 min-h-0 overflow-hidden');
  });

  it('restores defaults incrementally and blocks overflow without deleting current images', () => {
    expect(source).toContain('mergeDefaultShotReferences(');
    expect(source).toContain("alert('无法恢复自动绑定，因为超过6张图')");
    expect(source).toContain("alert('当前已是默认绑定状态')");
    expect(source).toContain('updateCurrentShotReferences(merged.references)');
  });
});

describe('GenerationPage computer operation composition', () => {
  it('applies the screen-back constraint only to the submitted generation prompt', () => {
    expect(source).toContain('const identityAnchoredPrompt = buildIdentityAnchoredPrompt(');
    expect(source).toContain('const promptToUse = applyComputerOperationOrientationConstraint(');
    expect(source).toContain('shot.originalText');
    expect(source).toContain('shot.scriptSegment');
  });
});

describe('GenerationPage result card actions', () => {
  it('keeps all hover actions in a non-wrapping six-column toolbar', () => {
    expect(source).toContain('data-testid="storyboard-result-actions"');
    expect(source).toContain('className="grid grid-cols-6 gap-1"');
    expect(source).toContain('inline-flex h-7 min-w-0 items-center justify-center');
    expect(source).toContain('<span className="sr-only">14 视角</span>');
    expect(source).toContain('<span className="sr-only">单角度</span>');
  });

  it('selects and scrolls to a shot opened from a notification', () => {
    expect(source).toContain('focusShotId?: string | null');
    expect(source).toContain('pendingNotificationFocusRef');
    expect(source).toContain("target.scrollIntoView({ block: 'center', behavior: 'smooth' })");
    expect(source).toContain('data-storyboard-shot-id={item.id}');
    expect(storyboardPageSource).toContain("searchParams.get('shotId')");
    expect(storyboardPageSource).toContain('focusShotId={notificationShotId}');
  });
});
