import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoryboardShotListEntry } from '../../components/StoryboardShotListEntry';
import { buildStoryboardSegmentLookup } from '../../utils/storyboardSegments';
import type { StoryboardItem } from '../../types';

afterEach(cleanup);

const shots: StoryboardItem[] = ['1-1', '2-1', '2-2', '2-3', '2-4', '2-5'].map(number => ({
  id: number,
  scriptSegmentId: `segment-${number.split('-')[0]}`,
  originalText: `镜头${number}\n时间：3秒`,
  scriptSegment: `镜头${number}`,
  duration: '3秒',
  characters: [],
}));
const lookup = buildStoryboardSegmentLookup(shots);

describe('storyboard shot list segment headings', () => {
  it('renders each heading once outside its shots, preserving source order and selection', () => {
    const select = vi.fn();
    const list = (selectedId: string, visible = shots) => (
      <div data-testid="rail">
        {visible.map(shot => (
          <StoryboardShotListEntry key={shot.id} segment={lookup.get(shot.id)}>
            <button type="button" aria-pressed={shot.id === selectedId} onClick={() => select(shot.id)}>
              {lookup.get(shot.id)?.localShotLabel}
            </button>
          </StoryboardShotListEntry>
        ))}
      </div>
    );
    const view = render(list('2-3'));
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map(element => element.textContent)).toEqual(['分段 01', '分段 02']);
    expect(Array.from(screen.getByTestId('rail').children).map(element => element.textContent)).toEqual([
      '分段 01', '镜头1-1', '分段 02', '镜头2-1', '镜头2-2', '镜头2-3', '镜头2-4', '镜头2-5',
    ]);
    headings.forEach(heading => {
      expect(heading.closest('button')).toBeNull();
      expect(heading.querySelector('button')).toBeNull();
      fireEvent.click(heading);
    });
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '镜头2-5' }));
    expect(select).toHaveBeenCalledWith('2-5');
    view.rerender(list('2-5'));
    expect(screen.getAllByRole('heading', { level: 3 })).toEqual(headings);
    expect(screen.getByRole('button', { name: '镜头2-5' })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(list('2-5', shots.slice(0, 3)));
    view.rerender(list('2-5'));
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
  });

  it('does not invent a segment for an entry without metadata', () => {
    render(<StoryboardShotListEntry><button>镜头01</button></StoryboardShotListEntry>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '镜头01' })).toBeInTheDocument();
  });
});
