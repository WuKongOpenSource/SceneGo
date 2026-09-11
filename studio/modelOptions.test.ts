import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SELECTABLE_MODELS,
  getModelDisplayName,
} from '@app/services/videoModelService';
import {
  STUDIO_AUDIO_MODEL_LABEL,
  STUDIO_IMAGE_MODEL_CONFIGURED,
  STUDIO_IMAGE_MODEL_LABEL,
  STUDIO_TEXT_MODEL_LABEL,
  STUDIO_VIDEO_MODEL_OPTIONS,
  STUDIO_VIDEO_MODEL_FAST_LABEL,
  STUDIO_VIDEO_MODEL_STANDARD_LABEL,
  getStudioVideoDuration,
  normalizeStudioAudioModel,
  normalizeStudioImageModel,
  normalizeStudioTextModel,
  normalizeStudioVideoModel,
  studioImageModelOverride,
} from './services/modelOptions';

const studioRoot = resolve(__dirname);

function readStudioFile(path: string): string {
  return readFileSync(resolve(studioRoot, path), 'utf8');
}

describe('Studio image model contract', () => {
  it('normalizes the old NanoBanana canvas value to the configured backend image model', () => {
    expect(normalizeStudioImageModel('nanobanana')).toBe(STUDIO_IMAGE_MODEL_CONFIGURED);
    expect(normalizeStudioImageModel('')).toBe(STUDIO_IMAGE_MODEL_CONFIGURED);
    expect(studioImageModelOverride('nanobanana')).toBeUndefined();
  });

  it('normalizes legacy Studio model ids to backend API config operation ids', () => {
    expect(normalizeStudioTextModel('gemini')).toBe('gemini-2.5-flash');
    expect(normalizeStudioVideoModel('fast')).toBe('Seedance2Fast');
    expect(normalizeStudioVideoModel('standard')).toBe('Seedance2');
    expect(normalizeStudioVideoModel('Kling')).toBe('Kling');
    expect(normalizeStudioAudioModel('minimax-speech-2.6-hd')).toBe('speech-hd');
  });

  it('exposes the same complete video model catalog as the main video workspace', () => {
    expect(STUDIO_VIDEO_MODEL_OPTIONS.map(option => option.v)).toEqual(SELECTABLE_MODELS);
    expect(STUDIO_VIDEO_MODEL_OPTIONS).toHaveLength(SELECTABLE_MODELS.length);
    expect(STUDIO_VIDEO_MODEL_OPTIONS).toContainEqual({
      v: 'Seedance15',
      l: getModelDisplayName('Seedance15'),
    });
    expect(STUDIO_VIDEO_MODEL_OPTIONS).toContainEqual({
      v: 'MiniMaxH3Mini',
      l: getModelDisplayName('MiniMaxH3Mini'),
    });
    expect(STUDIO_VIDEO_MODEL_OPTIONS).toContainEqual({
      v: 'HappyHorse',
      l: getModelDisplayName('HappyHorse'),
    });
  });

  it('exposes actual model versions with capability suffixes', () => {
    expect(STUDIO_TEXT_MODEL_LABEL).toBe('gemini-2.5-flash · 全能写作模型');
    expect(STUDIO_IMAGE_MODEL_LABEL).toBe('Doubao-Seedream-5.0-lite · 参考图生图模型');
    expect(STUDIO_VIDEO_MODEL_STANDARD_LABEL).toBe('Seedance 2.0 · 多模态标准视频模型');
    expect(STUDIO_VIDEO_MODEL_FAST_LABEL).toBe('Seedance 2.0 Fast · 多模态快速视频模型');
    expect(STUDIO_AUDIO_MODEL_LABEL).toBe('speech-2.8-hd · 高清语音模型');
    expect(readStudioFile('components/Node.tsx')).toContain('STUDIO_IMAGE_MODEL_OPTIONS');
  });

  it('uses provider-supported fixed durations for fixed-length video models', () => {
    expect(getStudioVideoDuration('MINI', 10, '1080p')).toBe(6);
    expect(getStudioVideoDuration('MINI', 10, '720p')).toBe(10);
    expect(getStudioVideoDuration('Veo', 5, '720p')).toBe(8);
    expect(getStudioVideoDuration('Sora2', 5, '720p')).toBe(15);
  });

  it('does not expose the migrated NanoBanana alias in Studio canvas source', () => {
    for (const path of [
      'App.tsx',
      'components/Node.tsx',
      'components/SketchEditor.tsx',
      'services/videoStrategies.ts',
      'platform/ostoryRuntime.ts',
    ]) {
      expect(readStudioFile(path).toLowerCase()).not.toContain('nanobanana');
    }
  });
});
