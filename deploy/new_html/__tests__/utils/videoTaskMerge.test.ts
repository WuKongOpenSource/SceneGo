import { describe, expect, it } from 'vitest';

import type { MergedCardSnapshot, TaskGroup } from '../../services/videoTaskTypes';
import {
  buildDownwardMergePlan,
  buildVideoStoryboardShotLookup,
  canCreateFirstLastPair,
  canMergeAdjacentGroups,
  getTaskStatusHistoryDelta,
  mergeTaskStatusHistories,
  partitionMergedSnapshots,
} from '../../utils/videoTaskMerge';

const group = (
  uuid: string,
  model: TaskGroup['model'],
  ids = [uuid],
  duration = 5,
): TaskGroup => ({ uuid, model, ids, duration });

const mergeOptions = (
  segments: Record<string, string>,
  selectedEndIndex?: number,
) => ({
  getSegmentKey: (item: TaskGroup) => segments[item.uuid],
  getDurationSeconds: (item: TaskGroup) => item.duration,
  maxDurationSeconds: 15,
  maxImages: 9,
  selectedEndIndex,
});

describe('video storyboard shot labels', () => {
  it('numbers shots locally inside ordered script segments for snake and camel case rows', () => {
    const lookup = buildVideoStoryboardShotLookup([
      { item_id: 'b', sort_order: 2, script_segment_id: 'segment-a' },
      { itemId: 'a', sortOrder: 1, scriptSegmentId: 'segment-a' },
      { item_id: 'c', sort_order: 3, script_segment_id: 'segment-b' },
    ]);

    expect(lookup.get('a')).toMatchObject({ label: '镜头1-1', isFirstInSegment: true });
    expect(lookup.get('b')).toMatchObject({ label: '镜头1-2', isFirstInSegment: false });
    expect(lookup.get('c')).toMatchObject({ label: '镜头2-1', isFirstInSegment: true });
  });

  it('preserves explicit hierarchical segment numbers for legacy rows', () => {
    const lookup = buildVideoStoryboardShotLookup([
      { item_id: 'a', sort_order: 1, source_video_shot_no: '分镜2-7' },
      { item_id: 'b', sort_order: 2, source_video_shot_no: '分镜2-8' },
    ]);

    expect(lookup.get('a')?.label).toBe('镜头2-1');
    expect(lookup.get('b')?.label).toBe('镜头2-2');
  });
});

describe('video task merge eligibility', () => {
  it('creates first/last pairs only from adjacent single-image cards of the same model', () => {
    expect(canCreateFirstLastPair([group('a', 'Seedance2'), group('b', 'Seedance2')], 0)).toBe(true);
    expect(canCreateFirstLastPair([group('a', 'Seedance2'), group('b', 'MINI')], 0)).toBe(false);
    expect(canCreateFirstLastPair([group('a', 'Seedance2', ['a', 'b']), group('c', 'Seedance2')], 0)).toBe(false);
  });

  it('allows content merges regardless of the models used by historical runs', () => {
    const groups = [
      { ...group('a', 'Seedance2', ['a', 'b']), mergedFrom: [] },
      group('c', 'Kling'),
      group('d', 'MINI'),
    ];
    expect(canMergeAdjacentGroups(groups, 0)).toBe(true);
    expect(canMergeAdjacentGroups(groups, 1)).toBe(true);
  });

  it('keeps different-model cards in one continuous downward range', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 5),
      group('b', 'Kling', ['b'], 5),
      group('c', 'MINI', ['c'], 5),
    ];
    const plan = buildDownwardMergePlan(groups, 0, mergeOptions({
      a: 'segment-1', b: 'segment-1', c: 'segment-1',
    }));

    expect(plan.canMerge).toBe(true);
    expect(plan.availableGroups.map(item => item.uuid)).toEqual(['a', 'b', 'c']);
    expect(plan.groups.map(item => item.uuid)).toEqual(['a', 'b', 'c']);
  });

  it('recommends the furthest continuous range that remains within 15 seconds', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 3),
      group('b', 'Seedance2', ['b'], 4),
      group('c', 'Seedance2', ['c'], 5),
      group('d', 'Seedance2', ['d'], 5),
    ];
    const plan = buildDownwardMergePlan(groups, 0, mergeOptions({
      a: 'segment-1', b: 'segment-1', c: 'segment-1', d: 'segment-2',
    }));

    expect(plan.canMerge).toBe(true);
    expect(plan.groups.map(item => item.uuid)).toEqual(['a', 'b', 'c']);
    expect(plan.availableGroups.map(item => item.uuid)).toEqual(['a', 'b', 'c', 'd']);
    expect(plan.totalDuration).toBe(12);
    expect(plan.crossesSegment).toBe(false);
  });

  it('allows an explicitly selected over-duration range and reports the warning', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 6),
      group('b', 'Seedance2', ['b'], 6),
      group('c', 'Seedance2', ['c'], 4),
    ];
    const plan = buildDownwardMergePlan(
      groups,
      0,
      mergeOptions({ a: 'segment-1', b: 'segment-1', c: 'segment-1' }, 2),
    );

    expect(plan.canMerge).toBe(true);
    expect(plan.exceedsDuration).toBe(true);
    expect(plan.totalDuration).toBe(16);
  });

  it('allows a cross-segment range and reports the warning', () => {
    const groups = [group('a', 'Seedance2', ['a'], 5), group('b', 'Seedance2', ['b'], 5)];
    const plan = buildDownwardMergePlan(
      groups,
      0,
      mergeOptions({ a: 'segment-1', b: 'segment-2' }, 1),
    );

    expect(plan.canMerge).toBe(true);
    expect(plan.crossesSegment).toBe(true);
  });

  it('recommends the next segment when it brings a short range closer to 15 seconds', () => {
    const groups = [
      group('a', 'Seedance2', ['a'], 4),
      group('b', 'Seedance2', ['b'], 4),
      group('c', 'Seedance2', ['c'], 4),
      group('d', 'Seedance2', ['d'], 4),
    ];
    const plan = buildDownwardMergePlan(groups, 0, mergeOptions({
      a: 'segment-1', b: 'segment-1', c: 'segment-2', d: 'segment-2',
    }));

    expect(plan.groups.map(item => item.uuid)).toEqual(['a', 'b', 'c']);
    expect(plan.totalDuration).toBe(12);
    expect(plan.crossesSegment).toBe(true);
  });

  it('stops before a range would exceed nine images', () => {
    const groups = [
      group('a', 'Seedance2', ['1', '2', '3', '4', '5'], 5),
      group('b', 'Seedance2', ['6', '7', '8', '9'], 5),
      group('c', 'Seedance2', ['10'], 5),
    ];
    const plan = buildDownwardMergePlan(groups, 0, mergeOptions({
      a: 'segment-1', b: 'segment-1', c: 'segment-1',
    }));

    expect(plan.groups.map(item => item.uuid)).toEqual(['a', 'b']);
    expect(plan.imageCount).toBe(9);
    expect(plan.hardStopReason).toBe('image_limit');
    expect(plan.blockingIndex).toBe(2);
  });
});

describe('merged video result history', () => {
  it('keeps videos, generation times, and per-video models aligned in storyboard order', () => {
    const merged = mergeTaskStatusHistories([
      {
        state: 'done',
        result: '/video/a.mp4',
        videos: ['/video/a.mp4'],
        videoGenerateTimes: [21],
        videoModels: ['Seedance2Mini'],
      },
      {
        state: 'done',
        result: '/video/b.mp4',
        videos: ['/video/b.mp4'],
        videoGenerateTimes: [34],
        videoModels: ['Kling'],
      },
    ]);

    expect(merged?.videos).toEqual(['/video/a.mp4', '/video/b.mp4']);
    expect(merged?.videoGenerateTimes).toEqual([21, 34]);
    expect(merged?.videoModels).toEqual(['Seedance2Mini', 'Kling']);
    expect(merged?.result).toBe('/video/a.mp4');
  });

  it('separates a video generated after the cards were merged', () => {
    const delta = getTaskStatusHistoryDelta(
      {
        state: 'done',
        videos: ['/video/a.mp4', '/video/b.mp4', '/video/merged.mp4'],
        videoGenerateTimes: [20, 30, 55],
        videoModels: ['Seedance2Mini', 'Kling', 'Seedance2'],
        result: '/video/merged.mp4',
      },
      [
        { videos: ['/video/a.mp4'], videoModels: ['Seedance2Mini'] },
        { videos: ['/video/b.mp4'], videoModels: ['Kling'] },
      ],
    );

    expect(delta?.videos).toEqual(['/video/merged.mp4']);
    expect(delta?.videoGenerateTimes).toEqual([55]);
    expect(delta?.videoModels).toEqual(['Seedance2']);
    expect(delta?.result).toBe('/video/merged.mp4');
  });
});

describe('merged card reverse operation', () => {
  const snapshots = ['a', 'b', 'c'].map(uuid => ({
    uuid,
    ids: [uuid],
    model: 'Seedance2' as const,
    prompt: uuid,
  })) satisfies MergedCardSnapshot[];

  it('partitions a middle child into contiguous before, removed, and after ranges', () => {
    expect(partitionMergedSnapshots(snapshots, 1)).toEqual({
      before: [snapshots[0]],
      removed: snapshots[1],
      after: [snapshots[2]],
    });
  });
});
