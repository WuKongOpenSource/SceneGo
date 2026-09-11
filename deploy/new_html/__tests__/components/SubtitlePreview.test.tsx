import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SubtitlePreview } from '../../components/SubtitlePreview';
import { DEFAULT_ENHANCE_SUBTITLE_STYLE } from '../../utils/enhanceTimelineEditor';

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
    style={DEFAULT_ENHANCE_SUBTITLE_STYLE} sourceWidth={1000} sourceHeight={500} onChange={onChange} onSelect={onSelect} />);
  return { onChange, onSelect, subtitle: screen.getByRole('button', { name: '移动字幕：测试字幕' }) };
}

describe('subtitle positioning', () => {
  it('drags against actual picture dimensions excluding letterboxing, saving once', () => {
    const { subtitle, onChange, onSelect } = setup();
    fireEvent.pointerDown(subtitle, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(subtitle, { clientX: 600, clientY: 400 });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(subtitle);
    expect(onSelect).toHaveBeenCalledWith('cue');
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ positionX: 60, positionY: 74 });
  });
  it('cancels a drag without saving and supports keyboard adjustments', () => {
    const { subtitle, onChange } = setup();
    fireEvent.pointerDown(subtitle, { button: 0, clientX: 500, clientY: 500 });
    fireEvent.pointerMove(subtitle, { clientX: 600, clientY: 400 });
    fireEvent.pointerCancel(subtitle);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(subtitle, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith({ positionX: 50, positionY: 89 });
  });
});
