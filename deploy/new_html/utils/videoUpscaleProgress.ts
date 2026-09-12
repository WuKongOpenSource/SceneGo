/** Local node progress is not an estimate of end-to-end video processing time. */
export function videoUpscaleProgress(stage: unknown): { label: string; detail: string } {
  const message = typeof stage === 'string' ? stage : '';
  const match = /^视频放大：(准备素材|读取视频|加载模型|AI 放大中|编码视频|上传保存)(?: · 当前阶段 (\d+)\/(\d+))?$/.exec(message);
  if (match) {
    return {
      label: match[1],
      detail: match[2] ? `当前阶段 ${match[2]}/${match[3]}，不代表整体完成比例`
        : match[1] === 'AI 放大中' ? '正在提升画质，此阶段可能耗时较长' : '完成当前阶段后自动进入下一步',
    };
  }
  if (/^正在保存(?:生成)?结果/.test(message)) {
    return { label: '上传保存', detail: '处理已结束，等待结果保存完成' };
  }
  // Old agents and restored tasks cannot reliably identify the current node.
  // Never reinterpret their 120/121 or 89% as overall completion or time left.
  return { label: '视频放大处理中', detail: '正在处理视频，暂无法估算整体进度' };
}
