import React from 'react';
import type { StoryboardSegmentLookupEntry } from '../utils/storyboardSegments';

/** Segment headings are siblings of shot cards, never part of their selection/drop target. */
export function StoryboardShotListEntry({ segment, children }: {
  segment?: StoryboardSegmentLookupEntry;
  children: React.ReactNode;
}) {
  return (
    <>
      {segment?.isFirstInSegment && (
        <h3
          data-testid="storyboard-segment-heading"
          className="flex min-h-9 items-center gap-3 border-b border-n40 bg-n20 px-5 py-2 text-xs font-semibold text-warning"
        >
          <span className="shrink-0">分段 {String(segment.segmentNo).padStart(2, '0')}</span>
          <span aria-hidden="true" className="h-px flex-1 bg-warning/20" />
        </h3>
      )}
      {children}
    </>
  );
}
