import type { MergedCardSnapshot, TaskGroup, TaskStatus } from '../services/videoTaskTypes';

const normalizeSegmentKey = (key: string | null | undefined): string => String(key || '').trim();

const normalizeDuration = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const normalizePositiveInteger = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

const firstNonEmptyString = (...values: unknown[]): string => {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
};

const parseHierarchicalShot = (value: unknown): { segmentNo: number; localShotNo: number } | null => {
  const match = String(value ?? '').match(/(?:镜头|分镜)?\s*0*(\d+)\s*[-－—]\s*0*(\d+)/);
  if (!match) return null;
  return {
    segmentNo: Number.parseInt(match[1], 10),
    localShotNo: Number.parseInt(match[2], 10),
  };
};

export interface VideoStoryboardShotInfo {
  itemId: string;
  segmentKey: string;
  segmentNo: number;
  localShotNo: number;
  label: string;
  isFirstInSegment: boolean;
}

/**
 * Builds the canonical segmented shot labels consumed by the video workspace.
 * The input intentionally accepts both API snake_case rows and normalized
 * camelCase records because the video page can receive either shape.
 */
export function buildVideoStoryboardShotLookup(items: any[]): Map<string, VideoStoryboardShotInfo> {
  const ordered = (items || [])
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((left, right) => {
      const leftOrder = Number(left.item?.sort_order ?? left.item?.sortOrder);
      const rightOrder = Number(right.item?.sort_order ?? right.item?.sortOrder);
      if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.originalIndex - right.originalIndex;
    });

  const lookup = new Map<string, VideoStoryboardShotInfo>();
  const segmentNoByKey = new Map<string, number>();
  const localCountByKey = new Map<string, number>();
  const usedSegmentNos = new Set<number>();
  let nextSegmentNo = 1;

  ordered.forEach(({ item }) => {
    const itemId = firstNonEmptyString(item?.item_id, item?.itemId, item?.id);
    if (!itemId) return;

    const rawShot = firstNonEmptyString(
      item?.shot_number,
      item?.shotNumber,
      item?.source_video_shot_no,
      item?.sourceVideoShotNo,
      item?.localShotLabel,
      item?.title,
    );
    const parsedShot = parseHierarchicalShot(rawShot);
    const explicitSegmentKey = firstNonEmptyString(
      item?.script_segment_id,
      item?.scriptSegmentId,
      item?.segment_key,
      item?.segmentKey,
      item?.segment_id,
      item?.segmentId,
    );
    const segmentKey = explicitSegmentKey
      || (parsedShot ? `storyboard-segment-${parsedShot.segmentNo}` : 'storyboard-segment-unassigned');

    if (!segmentNoByKey.has(segmentKey)) {
      const syntheticNo = Number.parseInt(segmentKey.match(/^storyboard-segment-(\d+)$/)?.[1] || '', 10);
      const preferredNo = parsedShot?.segmentNo || (Number.isFinite(syntheticNo) ? syntheticNo : null);
      while (usedSegmentNos.has(nextSegmentNo)) nextSegmentNo += 1;
      const segmentNo = preferredNo && !usedSegmentNos.has(preferredNo) ? preferredNo : nextSegmentNo;
      segmentNoByKey.set(segmentKey, segmentNo);
      usedSegmentNos.add(segmentNo);
      nextSegmentNo = Math.max(nextSegmentNo, segmentNo + 1);
    }

    const localShotNo = (localCountByKey.get(segmentKey) || 0) + 1;
    localCountByKey.set(segmentKey, localShotNo);
    const segmentNo = segmentNoByKey.get(segmentKey)!;
    lookup.set(itemId, {
      itemId,
      segmentKey,
      segmentNo,
      localShotNo,
      label: `镜头${segmentNo}-${localShotNo}`,
      isFirstInSegment: localShotNo === 1,
    });
  });

  return lookup;
}

export function canCreateFirstLastPair(groups: TaskGroup[], index: number): boolean {
  const current = groups[index];
  const next = groups[index + 1];
  return Boolean(
    current
    && next
    && current.model === next.model
    && current.ids.length === 1
    && next.ids.length === 1,
  );
}

export function canMergeAdjacentGroups(
  groups: TaskGroup[],
  index: number,
): boolean {
  const current = groups[index];
  const next = groups[index + 1];
  return Boolean(current && next);
}

export type DownwardMergeBlockedReason =
  | 'no_downward_target'
  | 'image_limit';

export interface DownwardMergePlan {
  /** The selected contiguous prefix, including the current card. */
  groups: TaskGroup[];
  /** Every hard-compatible downward card available to the range selector. */
  availableGroups: TaskGroup[];
  startIndex: number;
  endIndex: number;
  recommendedEndIndex: number;
  totalDuration: number;
  maxDuration: number;
  imageCount: number;
  maxImages: number;
  hasDownwardTarget: boolean;
  canMerge: boolean;
  crossesSegment: boolean;
  exceedsDuration: boolean;
  blockedReason?: DownwardMergeBlockedReason;
  hardStopReason?: DownwardMergeBlockedReason;
  blockingIndex?: number;
}

export interface BuildDownwardMergePlanOptions {
  getSegmentKey: (group: TaskGroup) => string | null | undefined;
  getDurationSeconds: (group: TaskGroup) => number | null | undefined;
  maxDurationSeconds: number;
  maxImages?: number;
  selectedEndIndex?: number;
}

/**
 * Builds a contiguous downward range for the merge dialog. Crossing a script
 * segment or exceeding the model duration are explicit warnings, not hard
 * blockers. The nine-image API ceiling is the only hard stop; the model saved
 * on an existing card describes a past/future generation choice, not whether
 * adjacent storyboard content can be regrouped.
 */
export function buildDownwardMergePlan(
  groups: TaskGroup[],
  index: number,
  options: BuildDownwardMergePlanOptions,
): DownwardMergePlan {
  const current = groups[index];
  const maxDuration = normalizeDuration(options.maxDurationSeconds);
  const maxImages = normalizePositiveInteger(options.maxImages) || 9;
  const currentDuration = current ? normalizeDuration(options.getDurationSeconds(current)) : 0;
  const currentImages = current?.ids?.length || 0;
  const base: DownwardMergePlan = {
    groups: current ? [current] : [],
    availableGroups: current ? [current] : [],
    startIndex: index,
    endIndex: index,
    recommendedEndIndex: index,
    totalDuration: currentDuration,
    maxDuration,
    imageCount: currentImages,
    maxImages,
    hasDownwardTarget: false,
    canMerge: false,
    crossesSegment: false,
    exceedsDuration: maxDuration > 0 && currentDuration > maxDuration,
    blockedReason: 'no_downward_target',
  };
  if (!current) return base;
  if (currentImages >= maxImages) {
    return { ...base, blockedReason: 'image_limit', blockingIndex: index + 1 };
  }

  const availableGroups: TaskGroup[] = [current];
  let availableImages = currentImages;
  let hardStopReason: DownwardMergeBlockedReason | undefined;
  let blockingIndex: number | undefined;

  for (let i = index + 1; i < groups.length; i += 1) {
    const next = groups[i];
    if (!next) break;
    const nextImageCount = next.ids?.length || 0;
    if (availableImages + nextImageCount > maxImages) {
      hardStopReason = 'image_limit';
      blockingIndex = i;
      break;
    }
    availableGroups.push(next);
    availableImages += nextImageCount;
  }

  if (availableGroups.length <= 1) {
    return {
      ...base,
      blockedReason: hardStopReason || 'no_downward_target',
      blockingIndex,
    };
  }

  let recommendedEndIndex = index + 1;
  let runningDuration = currentDuration;
  availableGroups.slice(1).forEach((group, offset) => {
    runningDuration += normalizeDuration(options.getDurationSeconds(group));
    if (maxDuration <= 0 || runningDuration <= maxDuration) {
      recommendedEndIndex = index + offset + 1;
    }
  });
  const requestedEndIndex = options.selectedEndIndex ?? recommendedEndIndex;
  const endIndex = Math.max(index + 1, Math.min(requestedEndIndex, index + availableGroups.length - 1));
  const selectedGroups = availableGroups.slice(0, endIndex - index + 1);
  const totalDuration = selectedGroups.reduce(
    (sum, group) => sum + normalizeDuration(options.getDurationSeconds(group)),
    0,
  );
  const imageCount = selectedGroups.reduce((sum, group) => sum + (group.ids?.length || 0), 0);
  const segmentKeys = new Set(selectedGroups.map(group => normalizeSegmentKey(options.getSegmentKey(group))));

  return {
    groups: selectedGroups,
    availableGroups,
    startIndex: index,
    endIndex,
    recommendedEndIndex,
    totalDuration,
    maxDuration,
    imageCount,
    maxImages,
    hasDownwardTarget: true,
    canMerge: true,
    crossesSegment: segmentKeys.size > 1,
    exceedsDuration: maxDuration > 0 && totalDuration > maxDuration,
    blockedReason: undefined,
    hardStopReason,
    blockingIndex: hardStopReason ? blockingIndex : undefined,
  };
}

const normalizeVideoHistoryKey = (value: unknown): string => (
  typeof value === 'string'
    ? value.split('?')[0].replace(/^https?:\/\/[^/]+/, '')
    : ''
);

/**
 * Combines already-generated videos when storyboard cards are regrouped.
 * The first status remains authoritative for the latest attempt/result; all
 * videos are immutable history and are appended in storyboard order.
 */
export function mergeTaskStatusHistories(
  statuses: Array<TaskStatus | null | undefined>,
): TaskStatus | undefined {
  const existing = statuses.filter((status): status is TaskStatus => Boolean(status));
  if (existing.length === 0) return undefined;

  const primary = statuses[0] || existing[0];
  const videos: string[] = [];
  const times: number[] = [];
  const models: NonNullable<TaskStatus['videoModels']> = [];
  const seen = new Set<string>();

  existing.forEach((status) => {
    (status.videos || []).forEach((videoUrl, index) => {
      const key = normalizeVideoHistoryKey(videoUrl);
      if (!key || seen.has(key)) return;
      seen.add(key);
      videos.push(videoUrl);
      times.push(status.videoGenerateTimes?.[index] || 0);
      models.push(status.videoModels?.[index]);
    });
  });

  return {
    ...primary,
    state: primary.state || (videos.length > 0 ? 'done' : undefined),
    progress: primary.progress ?? (videos.length > 0 ? 100 : undefined),
    result: primary.result || '',
    videos,
    videoGenerateTimes: times,
    videoModels: models,
    uploadedVideos: Object.assign({}, ...existing.map(status => status.uploadedVideos || {})),
  };
}

/** Returns videos generated after the child histories were merged. */
export function getTaskStatusHistoryDelta(
  current: TaskStatus | null | undefined,
  baselineStatuses: Array<TaskStatus | null | undefined>,
): TaskStatus | undefined {
  if (!current) return undefined;
  const baselineKeys = new Set<string>();
  baselineStatuses.forEach((status) => {
    (status?.videos || []).forEach(videoUrl => baselineKeys.add(normalizeVideoHistoryKey(videoUrl)));
  });

  const videos: string[] = [];
  const times: number[] = [];
  const models: NonNullable<TaskStatus['videoModels']> = [];
  (current.videos || []).forEach((videoUrl, index) => {
    if (baselineKeys.has(normalizeVideoHistoryKey(videoUrl))) return;
    videos.push(videoUrl);
    times.push(current.videoGenerateTimes?.[index] || 0);
    models.push(current.videoModels?.[index]);
  });
  if (videos.length === 0) return undefined;

  const resultKey = normalizeVideoHistoryKey(current.result);
  return {
    ...current,
    result: resultKey && videos.some(videoUrl => normalizeVideoHistoryKey(videoUrl) === resultKey)
      ? current.result
      : '',
    videos,
    videoGenerateTimes: times,
    videoModels: models,
  };
}

export interface MergedSnapshotPartition {
  before: MergedCardSnapshot[];
  removed: MergedCardSnapshot;
  after: MergedCardSnapshot[];
}

/** Keeps the original sequence contiguous when one child leaves a merged card. */
export function partitionMergedSnapshots(
  snapshots: MergedCardSnapshot[],
  removeIndex: number,
): MergedSnapshotPartition | null {
  if (removeIndex < 0 || removeIndex >= snapshots.length) return null;
  return {
    before: snapshots.slice(0, removeIndex),
    removed: snapshots[removeIndex],
    after: snapshots.slice(removeIndex + 1),
  };
}
