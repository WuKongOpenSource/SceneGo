import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DubbingPanel } from '../../components/audio/DubbingPanel';
import type { AssetItem, ClipOverride, StoryboardItemDB } from '../../types';

function makeAsset(name: string, fileUrl: string): AssetItem {
  return {
    assetId: `asset-${name}`,
    projectId: 'project-1',
    episodeId: 'episode-1',
    assetType: 'character',
    name,
    description: '',
    thumbnailUrl: null,
    referenceImages: [],
    styleParams: {},
    tags: [],
    createdBy: 'test',
    createdAt: '2026-07-23T00:00:00Z',
    entityFiles: [{
      fileId: `file-${name}`,
      fileUrl,
      fileType: 'image/png',
      fileRole: 'reference_image',
      isSelected: true,
      createdAt: '2026-07-23T00:00:00Z',
    }],
  };
}

const storyboardItem: StoryboardItemDB = {
  itemId: 'shot-1',
  episodeId: 'episode-1',
  sortOrder: 1,
  sceneHeading: '',
  actionText: '',
  dialogue: '小悟：你好',
  cameraMovement: '',
  imagePrompt: '',
  videoPrompt: '',
  generatedImageUrl: null,
  boundAssets: ['char:小悟', 'char:小空'],
  configuredReferences: [],
  status: 'draft',
  dialogueAudioUrl: null,
  narrationAudioUrl: null,
  sfxAudioUrl: null,
  audioDurationMs: null,
  plannedDurationMs: 4000,
};

function Harness() {
  const [overrides, setOverrides] = useState<Record<string, ClipOverride>>({});
  return (
    <DubbingPanel
      storyboardItems={[storyboardItem]}
      clips={[{
        clipId: 'shot-1:speech:1',
        itemId: 'shot-1',
        sortOrder: 1,
        sequenceIndex: 0,
        type: 'dialogue',
        text: '你好',
        characterName: '小悟',
        audioUrl: null,
        durationMs: null,
        voiceId: null,
      }]}
      voiceMap={new Map()}
      charAssetMap={new Map([
        ['小悟', makeAsset('小悟', '/images/wukong.png')],
        ['小空', makeAsset('小空', '/images/wukong-space.png')],
      ])}
      localOverrides={overrides}
      setLocalOverrides={setOverrides}
      localAudio={{}}
      generatingIds={new Set()}
      errors={{}}
      playingKey=""
      onGenerate={vi.fn()}
      onTogglePlay={vi.fn()}
      onBatchGenerate={vi.fn()}
      batchRunning={false}
      allCharNames={['小悟', '小空', '旁白']}
      clipKeyFn={() => 'shot-1_dialogue'}
    />
  );
}

describe('DubbingPanel speaker avatar', () => {
  it('updates the avatar when the speaker is switched', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/images/wukong.png');

    fireEvent.change(screen.getByDisplayValue('小悟'), { target: { value: '小空' } });

    expect(container.querySelector('img')?.getAttribute('src')).toBe('/images/wukong-space.png');
  });

  it('shows the narrator fallback avatar after switching to narrator', () => {
    const { container } = render(<Harness />);
    fireEvent.change(screen.getByDisplayValue('小悟'), { target: { value: '旁白' } });

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('旁')).toBeInTheDocument();
  });

  it('groups multiple speech and silence segments by shot and preserves their order', () => {
    const onMoveSegment = vi.fn();
    render(
      <DubbingPanel
        storyboardItems={[{
          ...storyboardItem,
          audioSegments: [
            {
              segmentId: 'speech-1',
              kind: 'speech',
              sequenceIndex: 0,
              speaker: '小悟',
              text: '第一句',
              audioUrl: '/audio/one.mp3',
              durationMs: 5200,
            },
            {
              segmentId: 'silence-1',
              kind: 'silence',
              sequenceIndex: 1,
              label: '转身走到窗边',
              durationMs: 2000,
            },
            {
              segmentId: 'speech-2',
              kind: 'speech',
              sequenceIndex: 2,
              speaker: '小空',
              text: '第二句',
              audioUrl: '/audio/two.mp3',
              durationMs: 8100,
            },
          ],
        }]}
        clips={[
          {
            clipId: 'speech-1',
            itemId: 'shot-1',
            sortOrder: 1,
            sequenceIndex: 0,
            type: 'dialogue',
            text: '第一句',
            characterName: '小悟',
            audioUrl: '/audio/one.mp3',
            durationMs: 5200,
            voiceId: null,
          },
          {
            clipId: 'speech-2',
            itemId: 'shot-1',
            sortOrder: 1,
            sequenceIndex: 2,
            type: 'dialogue',
            text: '第二句',
            characterName: '小空',
            audioUrl: '/audio/two.mp3',
            durationMs: 8100,
            voiceId: null,
          },
        ]}
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
        allCharNames={['小悟', '小空', '旁白']}
        clipKeyFn={clip => clip.clipId}
        onMoveSegment={onMoveSegment}
      />,
    );

    expect(screen.getByText('镜头总时长 15.8s')).toBeInTheDocument();
    expect(screen.getByText('2 段配音')).toBeInTheDocument();
    expect(screen.getByDisplayValue('转身走到窗边')).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText('下移片段')[0]);
    expect(onMoveSegment).toHaveBeenCalledWith('shot-1', 'speech-1', 'down');
  });
});
