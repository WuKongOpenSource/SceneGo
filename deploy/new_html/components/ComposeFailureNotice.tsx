import React from 'react';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';

/** Failure details must be readable on touch devices, not only in a tooltip. */
export function ComposeFailureNotice({ error }: { error?: string | null }) {
  const raw = sanitizeProcessingTerminology(error).trim();
  // Also cover cached responses from older servers; never render raw paths or tool output.
  const message = /[/\\]|%2f|%5c|traceback|\[errno|ffmpeg|ffprobe/i.test(raw)
    ? '合成未完成，请重试；若仍失败，请联系管理员。'
    : raw || '未返回详细原因，请检查素材后重试。';
  return <span role="alert" className="max-w-lg break-words text-[11px] text-danger">
    合成失败：{message}
  </span>;
}
