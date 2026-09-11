import React from 'react';
import { sanitizeProcessingTerminology } from '../utils/processingTerminology';

/** Failure details must be readable on touch devices, not only in a tooltip. */
export function ComposeFailureNotice({ error }: { error?: string | null }) {
  const message = sanitizeProcessingTerminology(error).trim() || '未返回详细原因，请检查素材后重试。';
  return <span role="alert" className="max-w-lg break-words text-[11px] text-danger">
    合成失败：{message}
  </span>;
}
