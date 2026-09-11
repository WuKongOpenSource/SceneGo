import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StoryboardScriptColumn } from '../../components/StoryboardScriptColumn';
import type { ProjectFile } from '../../types';
import {
  STABILITY_CONSTRAINT_REFERENCE,
  VISUAL_STYLE_REFERENCE,
} from '../../utils/scriptPromptStandards';

const designColumnSource = readFileSync(resolve(__dirname, '../../components/StoryboardColumn.tsx'), 'utf-8');
const sharedVideoPrompt =
  `镜头1-1至镜头1-2，【视觉风格】${VISUAL_STYLE_REFERENCE}，【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}。`;

const file = {
  id: 'script-1',
  name: '测试分镜',
  storyboard: {
    items: [
      {
        id: 'shot-1',
        shotNumber: '镜头01',
        originalText: `镜头01\n主角推门进入办公室。\n视频提示词：${sharedVideoPrompt}`,
        scriptSegment: '主角进入办公室',
        videoPrompt: sharedVideoPrompt,
      },
      {
        id: 'shot-2',
        // Legacy imports may repeat shotNumber=1. Visible numbering follows list order,
        // matching the design cards on the right.
        shotNumber: 1,
        originalText: '镜头02\n主角走向桌边。',
        scriptSegment: '主角走向桌边',
        videoPrompt: sharedVideoPrompt,
      },
    ],
  },
} as ProjectFile;

describe('StoryboardScriptColumn', () => {
  it('selects the matching design item when a script block is clicked', () => {
    const onSelectItemIds = vi.fn();
    render(
      <StoryboardScriptColumn
        selectedFile={file}
        highlightedItemIds={new Set()}
        onSelectItemIds={onSelectItemIds}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /分镜1-1/ }));
    expect(onSelectItemIds).toHaveBeenCalledTimes(1);
    expect(Array.from(onSelectItemIds.mock.calls[0][0])).toEqual(['shot-1']);
  });

  it('scrolls only the script column when a design card is selected', () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollTo,
    });

    const { rerender } = render(
      <StoryboardScriptColumn
        selectedFile={file}
        highlightedItemIds={new Set()}
        onSelectItemIds={vi.fn()}
      />,
    );
    rerender(
      <StoryboardScriptColumn
        selectedFile={file}
        highlightedItemIds={new Set(['shot-2'])}
        onSelectItemIds={vi.fn()}
      />,
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(screen.getByRole('button', { name: /分镜1-2/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('uses visible item order when legacy shot numbers are duplicated', () => {
    render(
      <StoryboardScriptColumn
        selectedFile={file}
        highlightedItemIds={new Set()}
        onSelectItemIds={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /分镜1-1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /分镜1-2/ })).toBeInTheDocument();
  });

  it('renders segment prompts and every shot as separate cards', () => {
    render(
      <StoryboardScriptColumn
        selectedFile={file}
        highlightedItemIds={new Set()}
        onSelectItemIds={vi.fn()}
      />,
    );

    expect(screen.getByTestId('segment-1-visual-style-card')).toHaveTextContent(VISUAL_STYLE_REFERENCE);
    expect(screen.getByTestId('segment-1-stability-constraint-card')).toHaveTextContent(STABILITY_CONSTRAINT_REFERENCE);
    expect(screen.getByRole('button', { name: /分镜1-1/ })).not.toHaveTextContent('视频提示词');
    expect(screen.getByRole('button', { name: /分镜1-1/ })).not.toHaveTextContent('正向稳定约束');
    expect(
      screen.getByRole('button', { name: /分镜1-2/ }).compareDocumentPosition(
        screen.getByTestId('segment-1-visual-style-card'),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps linked scrolling inside each independent column', () => {
    expect(designColumnSource).toContain('data-testid="storyboard-design-scroll-container"');
    expect(designColumnSource).toContain('const scrollContainerRef = useRef<HTMLDivElement>(null)');
    expect(designColumnSource).toContain('container.scrollTo({');
    expect(designColumnSource).not.toContain('.scrollIntoView(');
    expect(designColumnSource).not.toContain('scale-[1.02]');
  });

  it('selects a design card even when its editable prompt field is clicked', () => {
    expect(designColumnSource).toContain('onClick={(e) => handleCardClick(e, item.id)}');
    expect(designColumnSource).not.toContain("target.tagName === 'TEXTAREA'");
    expect(designColumnSource).not.toContain("target.tagName === 'INPUT'");
  });

  it('gives long image and video prompts taller, user-resizable editors', () => {
    expect(designColumnSource).toContain('data-testid={`storyboard-image-prompt-${item.id}`}');
    expect(designColumnSource).toContain('min-h-[144px] max-h-[320px]');
    expect(designColumnSource).toMatch(
      /data-testid=\{`storyboard-image-prompt-\$\{item\.id\}`\}[\s\S]{0,320}rows=\{6\}/,
    );
    expect(designColumnSource).toContain('data-testid={`storyboard-video-prompt-${item.id}`}');
    expect(designColumnSource).toContain('min-h-[192px] max-h-[400px]');
    expect(designColumnSource).toContain('border border-n40 resize-y');
    expect(designColumnSource).toMatch(
      /data-testid=\{`storyboard-video-prompt-\$\{item\.id\}`\}[\s\S]{0,320}rows=\{9\}/,
    );
  });

  it('uses a visible waiting pill while quick mode is generating design shots', () => {
    expect(designColumnSource).toContain('正在生成镜头设计');
    expect(designColumnSource).toContain('等待镜头设计生成…');
    expect(designColumnSource).toContain('LoaderCircle className="h-3.5 w-3.5 animate-spin"');
  });

  it('shows explicit segment numbers and restarts shot numbering per segment', () => {
    const segmentedFile = {
      ...file,
      storyboard: {
        items: [
          { ...file.storyboard.items[0], id: 'segment-a-1', scriptSegmentId: 'segment-a' },
          { ...file.storyboard.items[1], id: 'segment-a-2', scriptSegmentId: 'segment-a' },
          { ...file.storyboard.items[0], id: 'segment-b-1', scriptSegmentId: 'segment-b' },
        ],
      },
    } as ProjectFile;

    render(
      <StoryboardScriptColumn
        selectedFile={segmentedFile}
        highlightedItemIds={new Set()}
        onSelectItemIds={vi.fn()}
      />,
    );

    expect(screen.getByText('共 2 个分段 · 3 个分镜')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分段1 分镜1-2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分段2 分镜2-1' })).toBeInTheDocument();
    expect(screen.getAllByText('01', { selector: '.text-warning' })).toHaveLength(1);
    expect(screen.getAllByText('02', { selector: '.text-warning' })).toHaveLength(1);
  });
});
