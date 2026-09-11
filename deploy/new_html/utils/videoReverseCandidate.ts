import type {
  GenerationReference,
  StoryboardItem,
} from '../types';
import type { VideoReverseSegment, VideoReverseTask } from '../services/videoReverseService';

const clean = (value: unknown): string => String(value ?? '').trim();

const parseMetadata = (value: unknown): Record<string, any> => {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, any>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const orderedSegments = (segments: VideoReverseSegment[]): VideoReverseSegment[] => (
  [...segments].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
);

const segmentDurationSeconds = (segment: VideoReverseSegment): number => {
  const duration = Number(segment.end_seconds || 0) - Number(segment.start_seconds || 0);
  return Math.max(1, Math.round(Number.isFinite(duration) ? duration : 1));
};

const segmentScriptText = (segment: VideoReverseSegment): string => {
  const metadata = parseMetadata(segment.metadata);
  return clean(metadata.script_text)
    || clean(segment.description)
    || clean(segment.prompt_zh);
};

const segmentStoryboardDescription = (segment: VideoReverseSegment): string => {
  const metadata = parseMetadata(segment.metadata);
  return clean(metadata.storyboard_description)
    || clean(segment.description)
    || segmentScriptText(segment);
};

const segmentShotDesign = (segment: VideoReverseSegment): string => {
  const metadata = parseMetadata(segment.metadata);
  return clean(metadata.shot_design)
    || clean(segment.prompt_zh)
    || segmentStoryboardDescription(segment);
};

const segmentDialogue = (segment: VideoReverseSegment): string => {
  const metadata = parseMetadata(segment.metadata);
  return clean(metadata.dialogue);
};

const segmentCameraMovement = (segment: VideoReverseSegment): string => (
  [segment.camera_description, segment.motion_description]
    .map(clean)
    .filter(Boolean)
    .join('；')
);

const segmentVideoPrompt = (segment: VideoReverseSegment): string => (
  [
    segmentStoryboardDescription(segment),
    clean(segment.camera_description) ? `镜头语言：${clean(segment.camera_description)}` : '',
    clean(segment.motion_description) ? `运镜：${clean(segment.motion_description)}` : '',
  ].filter(Boolean).join('；')
);

export const getVideoReverseSourceTaskId = (script: any): string => {
  const metadata = parseMetadata(script?.metadata);
  return clean(metadata.source_reverse_task_id);
};

export const buildVideoReverseCandidateName = (task: VideoReverseTask): string => {
  const sourceName = clean(task.video_file_name || task.video_file_id)
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .slice(0, 48);
  return `视频反推 · ${sourceName || '未命名视频'}`;
};

export const buildVideoReverseSegmentReference = (
  segment: VideoReverseSegment,
  index: number,
): GenerationReference | null => {
  const metadata = parseMetadata(segment.metadata);
  const firstFrame = segment.frame_files?.find(frame => clean(frame.file_url));
  const fileId = clean(segment.keyframe_file_id)
    || clean(metadata.keyframe_file_id)
    || clean(firstFrame?.file_id)
    || clean(segment.frame_file_ids?.[0]);
  const url = clean(segment.keyframe_file_url)
    || clean(metadata.keyframe_file_url)
    || clean(firstFrame?.file_url);
  if (!url) return null;
  return {
    id: `video_reverse_keyframe_${clean(segment.segment_id) || index}_${fileId || 'url'}`,
    url,
    type: 'pose',
    name: `视频反推关键帧 ${String(index + 1).padStart(2, '0')}`,
    fileId: fileId || undefined,
    description: `来自 ${Number(segment.start_seconds || 0).toFixed(1)}s - ${Number(segment.end_seconds || 0).toFixed(1)}s 的视频反推关键帧`,
    source: 'manual',
    isLocked: true,
  };
};

const buildSegmentScriptBlock = (
  segment: VideoReverseSegment,
  index: number,
): string => {
  const shotNo = `镜头${index + 1}-1`;
  const duration = segmentDurationSeconds(segment);
  return [
    `分段${index + 1}`,
    shotNo,
    `时长（秒）：${duration}`,
    `画面描述：${segmentStoryboardDescription(segment) || '按原视频关键帧反推画面内容'}`,
    clean(segment.camera_description) ? `拍摄角度：${clean(segment.camera_description)}` : '',
    clean(segment.motion_description) ? `运镜方式：${clean(segment.motion_description)}` : '',
    segmentDialogue(segment) ? `台词：${segmentDialogue(segment)}` : '台词：',
    `分镜生成提示词：${segmentShotDesign(segment) || segmentStoryboardDescription(segment)}`,
    `视频提示词：${segmentVideoPrompt(segment) || segmentShotDesign(segment)}`,
    '---CUT---',
  ].filter(line => line !== '').join('\n');
};

export const buildVideoReverseStoryboardItems = (
  task: VideoReverseTask,
  segments: VideoReverseSegment[],
): StoryboardItem[] => (
  orderedSegments(segments).map((segment, index) => {
    const reference = buildVideoReverseSegmentReference(segment, index);
    const shotNo = `镜头${index + 1}-1`;
    const durationSeconds = segmentDurationSeconds(segment);
    return {
      id: `video_reverse_${clean(task.reverse_task_id)}_${clean(segment.segment_id) || index}`,
      shotNumber: shotNo,
      originalText: segmentScriptText(segment),
      scriptSegment: segmentStoryboardDescription(segment),
      imagePrompt: segmentShotDesign(segment),
      videoPrompt: segmentVideoPrompt(segment),
      dialogue: segmentDialogue(segment),
      characters: [],
      scene: '',
      props: [],
      cameraMovement: segmentCameraMovement(segment),
      plannedDurationMs: durationSeconds * 1000,
      duration: `${durationSeconds}秒`,
      scriptSegmentId: `video_reverse_segment_${index + 1}`,
      sourceVideoShotNo: shotNo,
      videoScriptBlock: buildSegmentScriptBlock(segment, index),
      configuredReferences: reference ? [reference] : [],
      referenceConfigInitialized: Boolean(reference),
      timestamp: Date.now(),
    };
  })
);

export const buildVideoReverseCandidateMetadata = (
  task: VideoReverseTask,
  segments: VideoReverseSegment[] = [],
) => ({
  source_type: 'video_reverse',
  source_reverse_task_id: task.reverse_task_id,
  source_video_file_id: task.video_file_id,
  source_video_name: task.video_file_name || '',
  source_duration_seconds: Number(task.duration_seconds || 0),
  source_credit_cost: Number(task.credit_cost || 0),
  source_completed_at: task.completed_at || task.updated_at || '',
  generated_outputs: ['text', 'storyboard', 'shot_design'],
  keyframe_file_ids: orderedSegments(segments)
    .map(segment => clean(segment.keyframe_file_id) || clean(segment.frame_file_ids?.[0]))
    .filter(Boolean),
});

export const buildVideoReverseCandidateScript = (
  task: VideoReverseTask,
  segments: VideoReverseSegment[],
): string => {
  const sortedSegments = orderedSegments(segments);
  if (!clean(task.overall_prompt_zh) && sortedSegments.length === 0) return '';

  const lines = [
    '【视频反推候选剧本】',
    `来源视频：${clean(task.video_file_name || task.video_file_id) || '未命名视频'}`,
    `反推任务：${task.reverse_task_id}`,
  ];

  if (clean(task.overall_prompt_zh)) {
    lines.push('', '【整体反推文字】', clean(task.overall_prompt_zh));
  }
  if (clean(task.overall_negative_prompt)) {
    lines.push('', '【生成限制】', clean(task.overall_negative_prompt));
  }

  if (sortedSegments.length > 0) {
    lines.push('', '【逐段文字脚本】');
    sortedSegments.forEach((segment, index) => {
      lines.push(
        `${index + 1}. ${Number(segment.start_seconds || 0).toFixed(1)}s - ${Number(segment.end_seconds || 0).toFixed(1)}s：${segmentScriptText(segment) || segmentStoryboardDescription(segment)}`,
      );
    });

    lines.push('', '【分镜脚本与镜头设计】');
    sortedSegments.forEach((segment, index) => {
      lines.push(buildSegmentScriptBlock(segment, index));
    });
  }

  return lines.join('\n').trim();
};
