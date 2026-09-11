export type StudioCanvasTheme = 'light' | 'dark';

export const STUDIO_CANVAS_THEME_STORAGE_KEY = 'ostory.studio.canvas-theme';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function normalizeStudioCanvasTheme(value: string | null | undefined): StudioCanvasTheme {
  return value === 'dark' ? 'dark' : 'light';
}

function browserStorage(): ThemeStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStudioCanvasTheme(storage: ThemeStorage | null = browserStorage()): StudioCanvasTheme {
  if (!storage) return 'light';
  try {
    return normalizeStudioCanvasTheme(storage.getItem(STUDIO_CANVAS_THEME_STORAGE_KEY));
  } catch {
    return 'light';
  }
}

export function persistStudioCanvasTheme(
  theme: StudioCanvasTheme,
  storage: ThemeStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STUDIO_CANVAS_THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
