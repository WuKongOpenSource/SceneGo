import { describe, expect, it, vi } from 'vitest';

import type { GeneratedImage, StoryboardItem } from '../../types';
import {
  applyStoryboardProviderProgress,
  buildOtherStoryboardImagePickerItems,
  createStoryboardGenerationProgress,
  dedupeGeneratedImages,
  estimateStoryboardGenerationProgress,
  expectedStoryboardGenerationSeconds,
  formatStoryboardGenerationEta,
  resolveGenerationAttemptResults,
  runSingleFlight,
} from '../../utils/storyboardGeneration';

const image = (
  id: string,
  url: string,
  fileId?: string,
  generationAttempt = 1,
): GeneratedImage => ({
  id,
  url,
  fileId,
  generationAttempt,
  timestamp: 1,
});

const shot = (
  id: string,
  shotNumber: string | number,
  generatedImages: GeneratedImage[] = [],
  selectedImageId?: string,
): StoryboardItem => ({
  id,
  shotNumber,
  originalText: `${id} 原文`,
  scriptSegment: `${id} 分镜内容`,
  characters: [`${id} 人物`],
  scene: `${id} 场景`,
  props: [`${id} 道具`],
  generatedImages,
  selectedImageId,
});

describe('other storyboard image picker items', () => {
  it('excludes the current shot and lists the selected image before candidates', () => {
    const items = buildOtherStoryboardImagePickerItems([
      shot('shot-1', 1, [
        image('shot-1-image', '/shot-1.png'),
      ]),
      shot('shot-2', 2, [
        image('candidate', '/candidate.png', 'file-candidate'),
        image('selected', '/selected.png', 'file-selected'),
      ], 'selected'),
    ], 'shot-1');

    expect(items).toHaveLength(2);
    expect(items.map(item => item.shotId)).toEqual(['shot-2', 'shot-2']);
    expect(items[0]).toMatchObject({
      shotLabel: '镜头 02',
      imageId: 'selected',
      url: '/selected.png',
      fileId: 'file-selected',
      isSelected: true,
      imageLabel: '当前采用图',
    });
    expect(items[1]).toMatchObject({
      imageId: 'candidate',
      isSelected: false,
      imageLabel: '候选图 1',
    });
    expect(items[0].searchText).toContain('shot-2 人物');
    expect(items[0].searchText).toContain('shot-2 场景');
  });

  it('supports legacy single images and removes duplicate candidates within a shot', () => {
    const legacyShot = shot('legacy-shot', '镜头07', [
      image('first', '/same.png', 'same-file'),
      image('duplicate-file', '/duplicate-url.png', 'same-file'),
      image('duplicate-url', '/same.png'),
    ]);
    legacyShot.generatedImage = '/legacy.png';

    const items = buildOtherStoryboardImagePickerItems([legacyShot]);

    expect(items.map(item => item.url)).toEqual(['/same.png', '/legacy.png']);
    expect(items.map(item => item.shotLabel)).toEqual(['镜头07', '镜头07']);
    expect(items[1]).toMatchObject({
      imageId: 'legacy-legacy-shot',
      imageLabel: '候选图 1',
    });
  });
});

describe('storyboard generation request guards', () => {
  it('shares one request while the same shot is already generating', async () => {
    const inFlight = new Map<string, Promise<string>>();
    let resolveRequest: (value: string) => void = () => undefined;
    const pending = new Promise<string>((resolve) => {
      resolveRequest = resolve;
    });
    const factory = vi.fn(() => pending);

    const first = runSingleFlight(inFlight, 'shot-1', factory);
    const second = runSingleFlight(inFlight, 'shot-1', factory);

    expect(factory).toHaveBeenCalledTimes(1);
    resolveRequest('done');
    await expect(Promise.all([first, second])).resolves.toEqual(['done', 'done']);
    expect(inFlight.size).toBe(0);
  });

  it('allows a fresh request after the previous request fails', async () => {
    const inFlight = new Map<string, Promise<string>>();
    const factory = vi.fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce('retried');

    await expect(runSingleFlight(inFlight, 'shot-1', factory)).rejects.toThrow('failed');
    await expect(runSingleFlight(inFlight, 'shot-1', factory)).resolves.toBe('retried');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('keeps different shots independent', async () => {
    const inFlight = new Map<string, Promise<string>>();
    const factory = vi.fn(async (value: string) => value);

    await expect(Promise.all([
      runSingleFlight(inFlight, 'shot-1', () => factory('one')),
      runSingleFlight(inFlight, 'shot-2', () => factory('two')),
    ])).resolves.toEqual(['one', 'two']);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('storyboard generation result selection', () => {
  it('uses only the explicit retry attempt when it returns results', () => {
    const initial = [image('first', '/first.png', 'file-first', 1)];
    const retry = [image('retry', '/retry.png', 'file-retry', 2)];

    expect(resolveGenerationAttemptResults(initial, retry)).toEqual(retry);
  });

  it('falls back to the initial attempt when retry has no result', () => {
    const initial = [image('first', '/first.png', 'file-first', 1)];

    expect(resolveGenerationAttemptResults(initial, [])).toEqual(initial);
  });

  it('deduplicates provider results by file id or URL', () => {
    expect(dedupeGeneratedImages([
      image('one', '/one.png', 'file-one'),
      image('duplicate-file', '/other-url.png', 'file-one'),
      image('two', '/two.png'),
      image('duplicate-url', '/two.png'),
    ])).toEqual([
      image('one', '/one.png', 'file-one'),
      image('two', '/two.png'),
    ]);
  });
});

describe('storyboard generation progress feedback', () => {
  it('uses conservative expected durations for each provider family', () => {
    expect(expectedStoryboardGenerationSeconds('nanobanana')).toBe(90);
    expect(expectedStoryboardGenerationSeconds('gpt_image_vip')).toBe(120);
    expect(expectedStoryboardGenerationSeconds('qwen')).toBe(150);
  });

  it('advances estimated progress without pretending the provider reported completion', () => {
    const initial = createStoryboardGenerationProgress('nanobanana', 0);
    const halfway = estimateStoryboardGenerationProgress(initial, 45_000);
    const overtime = estimateStoryboardGenerationProgress(initial, 90_000);

    expect(halfway.mode).toBe('estimated');
    expect(halfway.percent).toBeGreaterThan(initial.percent);
    expect(halfway.etaSeconds).toBe(45);
    expect(overtime.percent).toBe(88);
    expect(overtime.etaSeconds).toBeNull();
  });

  it('normalizes GPU progress from ratio and percentage values', () => {
    const initial = createStoryboardGenerationProgress('qwen', 0);
    const ratioProgress = applyStoryboardProviderProgress(initial, 0.5, 45_000);
    const percentProgress = applyStoryboardProviderProgress(initial, 50, 45_000);

    expect(ratioProgress.mode).toBe('live');
    expect(ratioProgress.percent).toBe(50);
    expect(ratioProgress.etaSeconds).toBe(45);
    expect(percentProgress.percent).toBe(50);
  });

  it('formats short, minute-level, and overtime estimates clearly', () => {
    expect(formatStoryboardGenerationEta(35)).toBe('预计剩余约 35 秒');
    expect(formatStoryboardGenerationEta(90)).toBe('预计剩余约 2 分钟');
    expect(formatStoryboardGenerationEta(null)).toBe('已超过常规耗时，仍在处理');
  });
});
