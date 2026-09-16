import React from 'react';
import { CARD_BODY_SCROLL_CLASS } from '../../utils/videoCardLayout';
import type { VideoGroupTiming } from '../../utils/videoGroupTiming';
import { VideoTimingSummary } from './VideoTimingSummary';

/** Expanded timing and the editor share a scroll area, never compete for height. */
export function VideoCardBody({ timing, selectedSeconds, multimodal = false, children }: {
  timing: VideoGroupTiming;
  selectedSeconds: number;
  multimodal?: boolean;
  children: React.ReactNode;
}) {
  return <div className={`${CARD_BODY_SCROLL_CLASS} flex flex-col`} data-testid="video-card-body">
    <VideoTimingSummary timing={timing} selectedSeconds={selectedSeconds} />
    <div
      className={`mt-2 flex flex-1 shrink-0 flex-col ${multimodal ? 'min-h-[280px]' : 'min-h-[112px]'}`}
      data-testid="video-card-composer"
    >
      {children}
    </div>
  </div>;
}
