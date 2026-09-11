import { describe, expect, it } from 'vitest';
import type { GenerationReference, StoryboardItem } from '../../types';
import { isSeedreamStoryboardModel, SEEDREAM_PRO_MODEL, storyboardSubmissionReferences, seedreamTextOnlyPrompt } from '../../utils/seedreamStoryboard';

const references: GenerationReference[] = [{ id: 'ref-1', url: '/storage/character.png', type: 'character', name: '阿亮', description: '穿蓝色外套', source: 'manual' }];
const shot = {
  id: 'shot-1', generatedImage: '/storage/legacy.png', selectedImageId: 'selected',
  generatedImages: [{ id: 'selected', url: '/storage/original.png', thumbnail: '/storage/thumb.webp', timestamp: 1 }],
} as StoryboardItem;

describe('Seedream storyboard portrait mode', () => {
  it('only applies to the two Seedream options and uses the official Pro ID', () => {
    expect(isSeedreamStoryboardModel('doubao')).toBe(true);
    expect(isSeedreamStoryboardModel('doubao_pro')).toBe(true);
    expect(isSeedreamStoryboardModel('nanobanana')).toBe(false);
    expect(SEEDREAM_PRO_MODEL).toBe('doubao-seedream-5-0-pro-260628');
  });

  it('sends no bound references and does not mutate their saved configuration', () => {
    expect(storyboardSubmissionReferences(shot, references, true)).toEqual([]);
    expect(references).toHaveLength(1);
  });

  it('does not turn a second generation into image-to-image through a previous result', () => {
    expect(storyboardSubmissionReferences(shot, [], true)).toEqual([]);
    expect(shot.generatedImage).toBe('/storage/legacy.png');
  });

  it('keeps normal image-to-image references and falls back to an original, not its thumbnail', () => {
    expect(storyboardSubmissionReferences(shot, references, false)).toEqual(references);
    expect(storyboardSubmissionReferences(shot, [], false)[0].url).toBe('/storage/original.png');
  });

  it('preserves text settings without inventing an uploaded reference or exposing its URL', () => {
    const prompt = seedreamTextOnlyPrompt('走进茶馆', references);
    expect(prompt).toContain('走进茶馆');
    expect(prompt).toContain('【阿亮】穿蓝色外套');
    expect(prompt).toContain('未附图片');
    expect(prompt).not.toContain('参考图1');
    expect(prompt).not.toContain('/storage/');
  });
});
