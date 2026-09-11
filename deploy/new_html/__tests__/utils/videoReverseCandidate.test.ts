import { describe, expect, it } from 'vitest';
import type { VideoReverseSegment, VideoReverseTask } from '../../services/videoReverseService';
import {
  buildVideoReverseCandidateMetadata,
  buildVideoReverseCandidateName,
  buildVideoReverseCandidateScript,
  buildVideoReverseSegmentReference,
  buildVideoReverseStoryboardItems,
  getVideoReverseSourceTaskId,
} from '../../utils/videoReverseCandidate';

const task = {
  reverse_task_id: 'reverse_1',
  video_file_id: 'file_1',
  video_file_name: 'sample.mp4',
  duration_seconds: 8.5,
  credit_cost: 20,
  overall_prompt_zh: '两个人在办公室交谈。',
  overall_negative_prompt: '不要字幕。',
  completed_at: '2026-07-19T10:00:00Z',
  updated_at: '2026-07-19T10:00:00Z',
} as VideoReverseTask;

function makeSegment(overrides: Partial<VideoReverseSegment>): VideoReverseSegment {
  return {
    segment_id: '',
    reverse_task_id: task.reverse_task_id,
    sort_order: 0,
    start_seconds: 0,
    end_seconds: 0,
    frame_file_ids: [],
    description: '',
    prompt_zh: '',
    prompt_en: '',
    camera_description: '',
    motion_description: '',
    metadata: {},
    created_at: task.completed_at,
    ...overrides,
  };
}

const segments = [
  makeSegment({
    segment_id: 'seg_2',
    sort_order: 2,
    start_seconds: 4,
    end_seconds: 8.5,
    description: '机器人回答。',
    prompt_zh: '机器人近景。',
    frame_file_ids: ['frame_2'],
    frame_files: [{
      file_id: 'frame_2',
      file_url: '/api/files/frame_2/download',
      file_name: 'frame_2.jpg',
    }],
    metadata: {
      script_text: '机器人平静回答问题。',
      storyboard_description: '机器人站在窗边回答。',
      shot_design: '机器人近景，窗外霓虹反光，冷暖对比。',
    },
  }),
  makeSegment({
    segment_id: 'seg_1',
    sort_order: 1,
    start_seconds: 0,
    end_seconds: 4,
    description: '主角提问。',
    camera_description: '中景',
    motion_description: '缓慢推进',
    prompt_zh: '主角坐在桌边。',
    frame_file_ids: ['frame_1'],
    frame_files: [{
      file_id: 'frame_1',
      file_url: '/api/files/frame_1/download',
      thumbnail_url: '/api/files/frame_1/thumb',
      file_name: 'frame_1.jpg',
    }],
    keyframe_file_id: 'frame_1',
    keyframe_file_url: '/api/files/frame_1/download',
    metadata: {
      script_text: '主角追问关键证据。',
      storyboard_description: '主角握着文件坐在桌边提问。',
      shot_design: '主角坐在桌边，冷色办公室，中景构图。',
      dialogue: '证据在哪里？',
    },
  }),
];

describe('video reverse candidate helpers', () => {
  it('builds an ordered, editable candidate script', () => {
    const result = buildVideoReverseCandidateScript(task, segments);
    expect(result).toContain('【视频反推候选剧本】');
    expect(result).toContain('来源视频：sample.mp4');
    expect(result).toContain('【逐段文字脚本】');
    expect(result).toContain('【分镜脚本与镜头设计】');
    expect(result.indexOf('主角追问关键证据')).toBeLessThan(result.indexOf('机器人平静回答问题'));
    expect(result).toContain('拍摄角度：中景');
    expect(result).toContain('运镜方式：缓慢推进');
    expect(result).toContain('分镜生成提示词：主角坐在桌边，冷色办公室，中景构图。');
    expect(result).toContain('视频提示词：主角握着文件坐在桌边提问。；镜头语言：中景；运镜：缓慢推进');
  });

  it('keeps source identity for idempotent imports', () => {
    expect(buildVideoReverseCandidateName(task)).toBe('视频反推 · sample');
    expect(buildVideoReverseCandidateMetadata(task, segments)).toMatchObject({
      source_type: 'video_reverse',
      source_reverse_task_id: 'reverse_1',
      source_video_file_id: 'file_1',
      source_credit_cost: 20,
      generated_outputs: ['text', 'storyboard', 'shot_design'],
      keyframe_file_ids: ['frame_1', 'frame_2'],
    });
    expect(getVideoReverseSourceTaskId({
      metadata: JSON.stringify({ source_reverse_task_id: 'reverse_1' }),
    })).toBe('reverse_1');
  });

  it('builds storyboard items with one keyframe reference per segment', () => {
    const items = buildVideoReverseStoryboardItems(task, segments);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      shotNumber: '镜头1-1',
      originalText: '主角追问关键证据。',
      scriptSegment: '主角握着文件坐在桌边提问。',
      imagePrompt: '主角坐在桌边，冷色办公室，中景构图。',
      dialogue: '证据在哪里？',
      cameraMovement: '中景；缓慢推进',
      referenceConfigInitialized: true,
    });
    expect(items[0].configuredReferences?.[0]).toMatchObject({
      fileId: 'frame_1',
      url: '/api/files/frame_1/download',
      type: 'pose',
      isLocked: true,
    });
    expect(items[0].videoScriptBlock).toContain('---CUT---');
    expect(items[1].configuredReferences?.[0]).toMatchObject({
      fileId: 'frame_2',
      url: '/api/files/frame_2/download',
    });
  });

  it('can build a keyframe reference from segment metadata fallback', () => {
    const reference = buildVideoReverseSegmentReference(makeSegment({
      segment_id: 'seg_meta',
      start_seconds: 1,
      end_seconds: 2,
      frame_file_ids: [],
      metadata: {
        keyframe_file_id: 'frame_meta',
        keyframe_file_url: '/api/files/frame_meta/download',
      },
    }), 0);

    expect(reference).toMatchObject({
      fileId: 'frame_meta',
      url: '/api/files/frame_meta/download',
      isLocked: true,
    });
  });

  it('does not create an empty candidate', () => {
    expect(buildVideoReverseCandidateScript({
      ...task,
      overall_prompt_zh: '',
      overall_negative_prompt: '',
    }, [])).toBe('');
  });
});
