export const CREATE_IDEA_STORAGE_KEY = 'create:idea';

export interface CreateIdeaSeed {
  sentence: string;
  genre: string;
  durationSeconds: number;
  orientation: 'landscape' | 'portrait';
  aspectRatio: '16:9' | '9:16';
  projectId: string;
  episodeId: string;
}

type CreateIdeaStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveCreateIdeaSeed(storage: CreateIdeaStorage, seed: CreateIdeaSeed): void {
  storage.setItem(CREATE_IDEA_STORAGE_KEY, JSON.stringify(seed));
}

export function readCreateIdeaSeed(
  storage: Pick<CreateIdeaStorage, 'getItem'>,
  episodeId: string,
): CreateIdeaSeed | null {
  const raw = storage.getItem(CREATE_IDEA_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CreateIdeaSeed> & { duration?: string };
    const sentence = typeof parsed.sentence === 'string' ? parsed.sentence.trim() : '';
    if (!sentence) return null;
    if (parsed.episodeId && parsed.episodeId !== episodeId) return null;
    const legacyDuration = typeof parsed.duration === 'string'
      ? Number.parseInt(parsed.duration, 10)
      : Number.NaN;
    const durationSeconds = Number.isFinite(Number(parsed.durationSeconds))
      ? Math.max(1, Math.round(Number(parsed.durationSeconds)))
      : Number.isFinite(legacyDuration)
        ? legacyDuration
        : 60;
    const orientation = parsed.orientation === 'landscape'
      || parsed.aspectRatio === '16:9'
      || (typeof parsed.duration === 'string' && !parsed.duration.includes('竖屏'))
      ? 'landscape'
      : 'portrait';
    return {
      sentence,
      genre: typeof parsed.genre === 'string' ? parsed.genre : '',
      durationSeconds,
      orientation,
      aspectRatio: orientation === 'landscape' ? '16:9' : '9:16',
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : '',
      episodeId: typeof parsed.episodeId === 'string' ? parsed.episodeId : episodeId,
    };
  } catch {
    return null;
  }
}

export function clearCreateIdeaSeed(storage: Pick<CreateIdeaStorage, 'removeItem'>): void {
  storage.removeItem(CREATE_IDEA_STORAGE_KEY);
}
