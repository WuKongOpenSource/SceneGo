import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SubtitlePreview } from '../../components/SubtitlePreview';
import { DEFAULT_ENHANCE_SUBTITLE_STYLE, type EnhanceSubtitleCue, updateSubtitleCueStyle } from '../../utils/enhanceTimelineEditor';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 1000, height: 600, x: 0, y: 0, top: 0, left: 0, right: 1000, bottom: 600, toJSON: () => ({}) });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const onChange = vi.fn();
  const onSelect = vi.fn();
  render(<SubtitlePreview cues={[{ id: 'cue', text: '测试字幕', startTime: 0, duration: 3 }]}
    sourceWidth={1000} sourceHeight={500} onChange={onChange} onSelect={onSelect} />);
  return { onChange, onSelect, subtitle: screen.getByRole('button', { name: '移动字幕：测试字幕' }) };
}

describe('subtitle positioning', () => {
  it('previews synchronized opacity and moves the batch without copying the selected font size', () => {
    let cues: EnhanceSubtitleCue[] = [
      { id: 'a', text: '标题', startTime: 0, duration: 3, style: {
        ...DEFAULT_ENHANCE_SUBTITLE_STYLE, fontSize: 70, positionY: 50,
      } },
      { id: 'b', text: '对白', startTime: 0, duration: 3 },
    ];
    const view = () => <SubtitlePreview cues={cues} sourceWidth={1000} sourceHeight={500}
      onSelect={() => {}} onChange={(id, changes) => { cues = updateSubtitleCueStyle(cues, id, changes, true); }} />;
    const { rerender } = render(view());
    cues = updateSubtitleCueStyle(cues, 'a', { backgroundOpacity: 0 }, true);
    rerender(view());
    const title = screen.getByRole('button', { name: '移动字幕：标题' });
    const dialogue = screen.getByRole('button', { name: '移动字幕：对白' });
    expect(title).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0)', top: '50%', fontSize: '70px' });
    expect(dialogue).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0)', top: '94%', fontSize: '42px' });
    fireEvent.keyDown(title, { key: 'ArrowUp' });
    rerender(view());
    expect(title).toHaveStyle({ top: '49%', fontSize: '70px' });
    expect(dialogue).toHaveStyle({ top: '49%', fontSize: '42px' });
  });

  it('drags against actual picture dimensions excluding letterboxing, saving once', () => {
    const { subtitle, onChange, onSelect } = setup();
    fireEvent.pointerDown(subtitle, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(subtitle, { clientX: 600, clientY: 400 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(subtitle);
    expect(onSelect).toHaveBeenCalledWith('cue');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('cue', { positionX: 60, positionY: 74 });
  });
  it('cancels a drag without saving and supports keyboard adjustments', () => {
    const { subtitle, onChange } = setup();
    fireEvent.pointerDown(subtitle, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(subtitle, { clientX: 600, clientY: 400 });
    fireEvent.pointerCancel(subtitle);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(subtitle, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('cue', { positionX: 50, positionY: 89 });
  });

  it('moves only the grabbed cue, even before selection updates, and new cues stay at defaults', () => {
    let cues: EnhanceSubtitleCue[] = [
      { id: 'a', text: '标题', startTime: 0, duration: 3, style: { ...DEFAULT_ENHANCE_SUBTITLE_STYLE, fontSize: 70 } },
      { id: 'b', text: '对白', startTime: 0, duration: 3 },
    ];
    const onChange = vi.fn((id, changes) => { cues = updateSubtitleCueStyle(cues, id, changes); });
    const view = () => <SubtitlePreview cues={cues} sourceWidth={1000} sourceHeight={500} onChange={onChange} onSelect={() => {}} />;
    const { rerender } = render(view());
    const title = screen.getByRole('button', { name: '移动字幕：标题' });
    const dialogue = screen.getByRole('button', { name: '移动字幕：对白' });
    fireEvent.pointerDown(title, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(title, { clientX: 500, clientY: 280 });
    expect(title.style.top).toBe('50%');
    expect(dialogue.style.top).toBe('94%');
    expect(dialogue.style.fontSize).toBe('42px');
    fireEvent.pointerUp(title);
    cues = [...cues, { id: 'c', text: '新字幕', startTime: 0, duration: 3 }];
    rerender(view());
    expect(title.style.top).toBe('50%');
    expect(title.style.fontSize).toBe('70px');
    expect(dialogue.style.top).toBe('94%');
    const added = screen.getByRole('button', { name: '移动字幕：新字幕' });
    expect(added.style.top).toBe('94%');
    expect(added.style.fontSize).toBe('42px');
    fireEvent.keyDown(dialogue, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('b', { positionX: 49, positionY: 94 });
  });
});
