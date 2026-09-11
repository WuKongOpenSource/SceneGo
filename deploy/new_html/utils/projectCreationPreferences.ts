export type ProjectOrientation = 'landscape' | 'portrait';
export type ProjectAspectRatio = '16:9' | '9:16';

export interface ProjectCreationPreferences {
  genre: string;
  durationSeconds: number;
  orientation: ProjectOrientation;
  aspectRatio: ProjectAspectRatio;
}

export const DEFAULT_PROJECT_CREATION_PREFERENCES: ProjectCreationPreferences = {
  genre: '悬疑',
  durationSeconds: 60,
  orientation: 'portrait',
  aspectRatio: '9:16',
};

export function aspectRatioForOrientation(orientation: ProjectOrientation): ProjectAspectRatio {
  return orientation === 'landscape' ? '16:9' : '9:16';
}

export function orientationLabel(orientation: ProjectOrientation): string {
  return orientation === 'landscape' ? '横屏' : '竖屏';
}

export function normalizeProjectCreationPreferences(
  settings: unknown,
  fallback: ProjectCreationPreferences = DEFAULT_PROJECT_CREATION_PREFERENCES,
): ProjectCreationPreferences {
  let root = settings;
  if (typeof root === 'string') {
    try { root = JSON.parse(root); } catch { root = {}; }
  }
  const record = root && typeof root === 'object' && !Array.isArray(root)
    ? root as Record<string, unknown>
    : {};
  const raw = record.creation_preferences && typeof record.creation_preferences === 'object'
    ? record.creation_preferences as Record<string, unknown>
    : record;
  const orientation: ProjectOrientation = raw.orientation === 'landscape' || raw.aspect_ratio === '16:9'
    ? 'landscape'
    : raw.orientation === 'portrait' || raw.aspect_ratio === '9:16'
      ? 'portrait'
      : fallback.orientation;
  const parsedDuration = Number(raw.duration_seconds);
  return {
    genre: typeof raw.genre === 'string' && raw.genre.trim() ? raw.genre.trim() : fallback.genre,
    durationSeconds: Number.isFinite(parsedDuration) && parsedDuration > 0
      ? Math.round(parsedDuration)
      : fallback.durationSeconds,
    orientation,
    aspectRatio: aspectRatioForOrientation(orientation),
  };
}

export function projectCreationSettings(preferences: ProjectCreationPreferences): Record<string, unknown> {
  return {
    creation_preferences: {
      genre: preferences.genre,
      duration_seconds: preferences.durationSeconds,
      orientation: preferences.orientation,
      aspect_ratio: aspectRatioForOrientation(preferences.orientation),
    },
  };
}

export function projectDefaultAspectRatio(
  settings: unknown,
  fallback: ProjectAspectRatio = '16:9',
): ProjectAspectRatio {
  let root = settings;
  if (typeof root === 'string') {
    try { root = JSON.parse(root); } catch { return fallback; }
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) return fallback;
  const record = root as Record<string, unknown>;
  const raw = record.creation_preferences;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
  return normalizeProjectCreationPreferences(root).aspectRatio;
}

export function applyProjectOrientationToText(
  text: string,
  orientation: ProjectOrientation,
): string {
  if (orientation !== 'landscape') return text;
  const forbidLandscapeMarker = '__OSTORY_FORBID_LANDSCAPE__';
  return text
    .replace(/严禁生成横屏构图/g, forbidLandscapeMarker)
    .replace(/9:16/g, '16:9')
    .replace(/竖屏/g, '横屏')
    .replace(/纵向空间/g, '横向空间')
    .replace(new RegExp(forbidLandscapeMarker, 'g'), '严禁生成竖屏构图');
}

export function applyProjectOrientationToPrompt<T extends { system?: string; user: string }>(
  prompt: T,
  orientation: ProjectOrientation,
): T {
  if (orientation !== 'landscape') return prompt;
  return {
    ...prompt,
    system: prompt.system
      ? applyProjectOrientationToText(prompt.system, orientation)
      : prompt.system,
    user: applyProjectOrientationToText(prompt.user, orientation),
  };
}
