import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../components/audio/DubbingCard', () => ({
  DubbingCard: () => <div data-testid="dubbing-card" />,
}));

import { DubbingPanel } from '../../components/audio/DubbingPanel';

function item(
  itemId: string,
  sortOrder: number,
  scriptSegmentId: string,
  plannedDurationMs: number,
) {
  return {
    itemId,
    episodeId: 'episode_1',
    sortOrder,
    scriptSegmentId,
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
    plannedDurationMs,
  };
}

describe('DubbingPanel storyboard segmentation', () => {
  it.each([
    { durations: [8000, 7000, 6000], segments: ['segment_1', 'segment_1', 'segment_2'], labels: ['镜头1-1', '镜头1-2', '镜头2-1'] },
    { durations: [5000, 3000, 3000, 3000, 3000, 3000], segments: ['segment_1', 'segment_2', 'segment_2', 'segment_2', 'segment_2', 'segment_2'], labels: ['镜头1-1', '镜头2-1', '镜头2-2', '镜头2-3', '镜头2-4', '镜头2-5'] },
  ])('preserves script segmentation independent of total duration: $labels', ({ durations, segments, labels }) => {
    render(
      <DubbingPanel
        storyboardItems={durations.map((duration, index) => item(`shot_${index}`, index, segments[index], duration)).reverse()}
        clips={[]}
        voiceMap={new Map()}
        charAssetMap={new Map()}
        localOverrides={{}}
        setLocalOverrides={vi.fn()}
        localAudio={{}}
        generatingIds={new Set()}
        errors={{}}
        playingKey=""
        onGenerate={vi.fn()}
        onTogglePlay={vi.fn()}
        onBatchGenerate={vi.fn()}
        batchRunning={false}
        allCharNames={[]}
        clipKeyFn={clip => clip.clipId}
      />,
    );

    expect(screen.getByText('分段1')).toBeInTheDocument();
    expect(screen.getByText('分段2')).toBeInTheDocument();
    expect(screen.getAllByText(/^镜头\d+-\d+$/).map(node => node.textContent)).toEqual(labels);
    expect(screen.queryByText('#3')).not.toBeInTheDocument();
  });
});
