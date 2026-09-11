export const STORYBOARD_VIDEO_EXPORT_STATE_KEY = 'storyboardVideoExport';

export interface StoryboardVideoExportItem {
  shotId: string;
  finalImage: string | null;
  script?: string;
  imagePrompt?: string;
  videoPrompt?: string;
}

export interface StoryboardVideoExportPayload {
  version: 1;
  items: StoryboardVideoExportItem[];
}

function cleanOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text || undefined;
}

/**
 * Normalizes the explicit selection passed from storyboard design to the video
 * workspace. Invalid and duplicate shot ids are discarded at this boundary so
 * stale navigation state cannot accidentally widen an import to every shot.
 */
export function normalizeStoryboardVideoExportPayload(
  value: unknown,
): StoryboardVideoExportPayload | null {
  if (!value || typeof value !== 'object') return null;
  const rawItems = (value as { items?: unknown }).items;
  if (!Array.isArray(rawItems)) return null;

  const seen = new Set<string>();
  const items: StoryboardVideoExportItem[] = [];
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as Record<string, unknown>;
    const shotId = cleanOptionalText(item.shotId);
    if (!shotId || seen.has(shotId)) continue;
    seen.add(shotId);
    items.push({
      shotId,
      finalImage: cleanOptionalText(item.finalImage) || null,
      script: cleanOptionalText(item.script),
      imagePrompt: cleanOptionalText(item.imagePrompt),
      videoPrompt: cleanOptionalText(item.videoPrompt),
    });
  }

  return items.length > 0 ? { version: 1, items } : null;
}

export function buildStoryboardVideoExportNavigationState(
  payload: StoryboardVideoExportPayload,
): Record<typeof STORYBOARD_VIDEO_EXPORT_STATE_KEY, StoryboardVideoExportPayload> {
  return { [STORYBOARD_VIDEO_EXPORT_STATE_KEY]: payload };
}

export function readStoryboardVideoExportNavigationState(
  navigationState: unknown,
): StoryboardVideoExportPayload | null {
  if (!navigationState || typeof navigationState !== 'object') return null;
  return normalizeStoryboardVideoExportPayload(
    (navigationState as Record<string, unknown>)[STORYBOARD_VIDEO_EXPORT_STATE_KEY],
  );
}

function getStoryboardItemId(item: any): string {
  return String(item?.item_id ?? item?.itemId ?? item?.id ?? '').trim();
}

/** Keeps canonical storyboard order while limiting an import to the explicit selection. */
export function selectStoryboardItemsForVideoExport<T>(
  storyboardItems: T[],
  payload: StoryboardVideoExportPayload | null,
): T[] {
  if (!payload) return storyboardItems;
  const selectedIds = new Set(payload.items.map(item => item.shotId));
  return storyboardItems.filter(item => selectedIds.has(getStoryboardItemId(item)));
}

export function buildStoryboardVideoExportImageMap(
  payload: StoryboardVideoExportPayload | null,
): Map<string, string> {
  const images = new Map<string, string>();
  for (const item of payload?.items || []) {
    if (item.finalImage) images.set(item.shotId, item.finalImage);
  }
  return images;
}

export function isDurableStoryboardImageUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/');
}
