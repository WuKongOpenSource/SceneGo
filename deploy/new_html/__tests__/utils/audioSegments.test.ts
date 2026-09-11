import { describe, expect, it } from 'vitest';
import type { StoryboardItemDB } from '../../types';
import {
  audioSegmentsToClips,
  parseLegacyDialogueSegments,
  serializeAudioSegmentsDialogue,
} from '../../utils/audioSegments';

function makeItem(patch: Partial<StoryboardItemDB> = {}): StoryboardItemDB {
  return {
    itemId: 'shot-1',
    episodeId: 'episode-1',
    sortOrder: 1,
    sceneHeading: '',
    actionText: '',
    dialogue: '',
    cameraMovement: '',
    imagePrompt: '',
    videoPrompt: '',
    generatedImageUrl: null,
    boundAssets: [],
    configuredReferences: [],
    status: 'draft',
    dialogueAudioUrl: null,
    narrationAudioUrl: null,
    sfxAudioUrl: null,
    audioDurationMs: null,
    plannedDurationMs: null,
    ...patch,
  };
}

describe('audioSegments', () => {
  it('keeps multiple dialogue clips in the same shot independent and ordered', () => {
    const item = makeItem({ dialogue: '小悟：第一句\n小空：第二句' });
    const segments = parseLegacyDialogueSegments(item, ['小悟', '小空']);
    const clips = audioSegmentsToClips(item, segments, () => null);

    expect(clips).toHaveLength(2);
    expect(clips.map(clip => clip.clipId)).toEqual([
      'shot-1:speech:1',
      'shot-1:speech:2',
    ]);
    expect(clips.map(clip => clip.characterName)).toEqual(['小悟', '小空']);
  });

  it('preserves silent action between two speech segments', () => {
    const item = makeItem({
      dialogue: '小悟：先说第一句\n（无声动作 2秒）\n小悟：再说第二句',
    });
    const segments = parseLegacyDialogueSegments(item, ['小悟']);

    expect(segments.map(segment => segment.kind)).toEqual(['speech', 'silence', 'speech']);
    expect(segments[1].durationMs).toBe(2000);
    expect(serializeAudioSegmentsDialogue(segments)).toContain('无声动作：2秒');
  });
});
