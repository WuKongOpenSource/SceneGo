import { describe, expect, it } from 'vitest';
import {
  buildEnhanceSourceClips,
  withEntityFileVideoFallbacks,
} from '../../utils/enhanceSourceClips';

describe('enhanceSourceClips', () => {
  it('uses entity-file video fallbacks for segments whose legacy videoUrl is missing', () => {
    const segments = withEntityFileVideoFallbacks([
      {
        segmentId: 'seg_1',
        episodeId: 'ep_1',
        storyboardItemId: 'shot_1',
        sortOrder: 0,
        generationMode: 'i2v',
        model: 'MiniMaxH3',
        status: 'completed',
        durationMs: 5000,
        videoUrl: null,
        thumbnailUrl: null,
        inputParams: {},
        taskId: null,
      },
    ], {
      seg_1: '/api/files/file_gpu2_video/download',
    });

    expect(segments[0].videoUrl).toBe('/api/files/file_gpu2_video/download');
  });

  it('never replaces an explicitly selected segment video with a history fallback', () => {
    const segments = withEntityFileVideoFallbacks([
      {
        segmentId: 'seg_2',
        episodeId: 'ep_1',
        storyboardItemId: 'shot_2',
        sortOrder: 0,
        generationMode: 'i2v',
        model: 'MiniMaxH3',
        status: 'completed',
        durationMs: 5000,
        videoUrl: '/storage/missing-old-video.mp4',
        thumbnailUrl: null,
        inputParams: {},
        taskId: null,
      },
    ], {
      seg_2: '/api/files/file_latest_video/download',
    });

    expect(segments[0].videoUrl).toBe('/storage/missing-old-video.mp4');
  });

  it('does not add empty video clips to the beautify timeline', () => {
    const clips = buildEnhanceSourceClips([
      {
        segmentId: 'seg_empty',
        episodeId: 'ep_1',
        storyboardItemId: 'shot_empty',
        sortOrder: 0,
        generationMode: 'i2v',
        model: 'MiniMaxH3',
        status: 'pending',
        durationMs: 5000,
        videoUrl: null,
        thumbnailUrl: null,
        inputParams: {},
        taskId: null,
      },
      {
        segmentId: 'seg_video',
        episodeId: 'ep_1',
        storyboardItemId: 'shot_video',
        sortOrder: 1,
        generationMode: 'i2v',
        model: 'MiniMaxH3',
        status: 'completed',
        durationMs: 5000,
        videoUrl: '/api/files/file_video/download',
        thumbnailUrl: null,
        inputParams: {},
        taskId: null,
      },
    ], [], []);

    expect(clips.filter(clip => clip.type === 'video')).toEqual([
      expect.objectContaining({
        id: 'seg_video',
        url: '/api/files/file_video/download',
        startTime: 5,
      }),
    ]);
  });

  it('anchors storyboard audio to the matching generated video instead of the full storyboard clock', () => {
    const clips = buildEnhanceSourceClips([
      {
        segmentId: 'seg_2', episodeId: 'ep_1', storyboardItemId: 'shot_2', sortOrder: 0,
        generationMode: 'i2v', model: 'H3', status: 'completed', durationMs: 5000,
        videoUrl: '/video-2.mp4', thumbnailUrl: null,
        inputParams: {}, taskId: null,
      },
    ], [
      {
        itemId: 'shot_1', episodeId: 'ep_1', sortOrder: 0, sceneHeading: '', actionText: '', dialogue: '',
        cameraMovement: '', imagePrompt: '', videoPrompt: '', generatedImageUrl: null, boundAssets: [], configuredReferences: [],
        status: 'draft', dialogueAudioUrl: '/audio-1.mp3', narrationAudioUrl: null, sfxAudioUrl: null,
        audioDurationMs: 60_000, plannedDurationMs: 60_000,
      },
      {
        itemId: 'shot_2', episodeId: 'ep_1', sortOrder: 1, sceneHeading: '', actionText: '', dialogue: '',
        cameraMovement: '', imagePrompt: '', videoPrompt: '', generatedImageUrl: null, boundAssets: [], configuredReferences: [],
        status: 'draft', dialogueAudioUrl: '/audio-2.mp3', narrationAudioUrl: null, sfxAudioUrl: null,
        audioDurationMs: 4_000, plannedDurationMs: 4_000,
      },
    ], []);

    expect(clips.filter(clip => clip.type === 'audio')).toEqual([
      expect.objectContaining({ id: 'aud_sb_shot_2_dialogue', startTime: 0, audioKind: 'voice' }),
    ]);
  });

  it('restores persisted BGM timeline position and edit metadata', () => {
    const clips = buildEnhanceSourceClips([
      {
        segmentId: 'seg_1', episodeId: 'ep_1', storyboardItemId: 'shot_1', sortOrder: 0,
        generationMode: 'i2v', model: 'H3', status: 'completed', durationMs: 10_000,
        videoUrl: '/video.mp4', thumbnailUrl: null,
        inputParams: {}, taskId: null,
      },
    ], [], [{
      trackId: 'bgm_1', episodeId: 'ep_1', trackType: 'bgm', name: '主题音乐',
      audioUrl: '/bgm.mp3', durationMs: 8_000, startItemId: null, endItemId: null,
      generationParams: { timeline: { startMs: 2_000, durationMs: 5_000, volume: 0.4 } },
    }]);

    expect(clips.find(clip => clip.id === 'aud_track_bgm_1')).toEqual(expect.objectContaining({
      startTime: 2,
      duration: 5,
      audioKind: 'bgm',
      audioTrackId: 'bgm_1',
      volume: 0.4,
    }));
  });
});
