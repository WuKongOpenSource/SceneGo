import { describe, expect, it } from 'vitest';
import { videoUpscaleProgress } from '../../utils/videoUpscaleProgress';

describe('video upscale phase labels', () => {
  it.each(['准备素材', '读取视频', '加载模型', 'AI 放大中', '编码视频', '上传保存'])('identifies the reported phase %s', label => {
    expect(videoUpscaleProgress(`视频放大：${label}`).label).toBe(label);
  });

  it('labels a local counter without presenting it as total completion or remaining time', () => {
    expect(videoUpscaleProgress('视频放大：AI 放大中 · 当前阶段 120/121')).toEqual({
      label: 'AI 放大中', detail: '当前阶段 120/121，不代表整体完成比例',
    });
    expect(videoUpscaleProgress('视频放大：编码视频').label).toBe('编码视频');
  });

  it.each([undefined, null, {}, 'ComfyUI 正在生成 120/121', '工作流已提交，正在加载模型', 'unknown'])('does not guess a phase or percentage for legacy/unknown messages: %s', stage => {
    expect(videoUpscaleProgress(stage)).toEqual({ label: '视频放大处理中', detail: '正在处理视频，暂无法估算整体进度' });
  });

  it.each(['正在保存生成结果', '正在保存结果'])('keeps saving distinct from completed: %s', stage => {
    expect(videoUpscaleProgress(stage)).toEqual({ label: '上传保存', detail: '处理已结束，等待结果保存完成' });
  });
});
