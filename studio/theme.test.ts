import { describe, expect, it } from 'vitest';
import {
  normalizeStudioCanvasTheme,
  persistStudioCanvasTheme,
  readStudioCanvasTheme,
  STUDIO_CANVAS_THEME_STORAGE_KEY,
} from './theme';

describe('Studio canvas theme', () => {
  it('defaults missing and unsupported preferences to light', () => {
    expect(normalizeStudioCanvasTheme(null)).toBe('light');
    expect(normalizeStudioCanvasTheme('system')).toBe('light');
    expect(readStudioCanvasTheme(null)).toBe('light');
  });

  it('restores an explicit dark preference', () => {
    const storage = {
      getItem: (key: string) => key === STUDIO_CANVAS_THEME_STORAGE_KEY ? 'dark' : null,
      setItem: () => undefined,
    };

    expect(readStudioCanvasTheme(storage)).toBe('dark');
  });

  it('persists the selected theme without coupling it to canvas history', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    expect(persistStudioCanvasTheme('dark', storage)).toBe(true);
    expect(values.get(STUDIO_CANVAS_THEME_STORAGE_KEY)).toBe('dark');
    expect(readStudioCanvasTheme(storage)).toBe('dark');
  });

  it('falls back safely when browser storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new Error('storage denied');
      },
      setItem: () => {
        throw new Error('storage denied');
      },
    };

    expect(readStudioCanvasTheme(storage)).toBe('light');
    expect(persistStudioCanvasTheme('dark', storage)).toBe(false);
  });
});
