import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimelineTrack, type TimelineClip } from '../../components/TimelineTrack';

const clips: TimelineClip[] = [
  { id: 'image-1', label: '镜头一', track: 'image', imageUrl: '/one.png', startMs: 0, durationMs: 5000 },
  { id: 'image-2', label: '镜头二', track: 'image', imageUrl: '/two.png', startMs: 5000, durationMs: 5000 },
  { id: 'speech', label: '对白', track: 'dialogue', audioUrl: '/speech.mp3', startMs: 0, durationMs: 10000 },
  { id: 'music', label: '音乐', track: 'bgm', audioUrl: '/music.mp3', startMs: 5000, durationMs: 5000 },
];
let now = 0;
let frameId = 0;
let frames: Map<number, FrameRequestCallback>;
let paused: WeakMap<HTMLMediaElement, boolean>;

beforeEach(() => {
  now = 0;
  frameId = 0;
  frames = new Map();
  paused = new WeakMap();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () { return paused.get(this) ?? true; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () { paused.set(this, false); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () { paused.set(this, true); });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function openTimeline(props: Partial<React.ComponentProps<typeof TimelineTrack>> = {}) {
  const view = render(<TimelineTrack mode="combined" clips={clips} totalDurationMs={10000} showPreview {...props} />);
  const surface = screen.getByTestId('timeline-seek-surface');
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 100, width: 1000 } as DOMRect);
  const audio = [...view.container.querySelectorAll('audio')];
  return { ...view, surface, head: screen.getByRole('slider', { name: '播放位置' }), audio };
}

function pointer(clientX: number, pointerId = 1) { return { clientX, pointerId, button: 0, isPrimary: true }; }
function frame(elapsed: number) {
  act(() => {
    now += elapsed;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(now));
  });
}

describe('TimelineTrack seeking', () => {
  it('drags the playhead continuously using the track coordinates and updates the image preview', () => {
    const { head, surface } = openTimeline();
    fireEvent.pointerDown(head, pointer(300));
    expect(head).toHaveFocus();
    expect(head).toHaveAttribute('aria-valuenow', '2000');
    fireEvent.pointerMove(window, pointer(800));
    expect(head).toHaveAttribute('aria-valuenow', '7000');
    expect(screen.getByRole('img', { name: '镜头二' })).toBeInTheDocument();
    fireEvent.pointerUp(window, pointer(600));
    expect(head).toHaveStyle({ left: '50%' });
    fireEvent.pointerMove(window, pointer(1000));
    expect(head).toHaveAttribute('aria-valuenow', '5000');
    fireEvent.click(surface, { clientX: 1000 });
    expect(head).toHaveAttribute('aria-valuenow', '5000');
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
  });

  it('supports dragging the track beyond either edge and clamps to the full duration', () => {
    const { surface, head } = openTimeline();
    fireEvent.pointerDown(surface, pointer(600));
    fireEvent.pointerMove(window, pointer(-200));
    expect(head).toHaveAttribute('aria-valuenow', '0');
    fireEvent.pointerMove(window, pointer(1600));
    fireEvent.pointerUp(window, pointer(1600));
    expect(head).toHaveAttribute('aria-valuenow', '10000');
    expect(screen.getByRole('img', { name: '镜头二' })).toBeInTheDocument();
  });

  it('seeks on a clip click while preserving the optional clip selection callback', () => {
    const onClipClick = vi.fn();
    const { head } = openTimeline({ onClipClick });
    fireEvent.click(screen.getByTitle('镜头二 (0:05)'), { clientX: 850 });
    expect(head).toHaveAttribute('aria-valuenow', '7500');
    expect(onClipClick).toHaveBeenCalledExactlyOnceWith(clips[1]);
  });

  it('does not fire a clip action after dragging or change clip timing', () => {
    const onClipClick = vi.fn();
    const snapshot = JSON.stringify(clips);
    const { head } = openTimeline({ onClipClick });
    const clip = screen.getByTitle('镜头一 (0:05)');
    fireEvent.pointerDown(clip, pointer(200));
    fireEvent.pointerMove(window, pointer(700));
    fireEvent.pointerUp(window, pointer(800));
    fireEvent.click(clip, { clientX: 800 });
    expect(head).toHaveAttribute('aria-valuenow', '7000');
    expect(onClipClick).not.toHaveBeenCalled();
    expect(JSON.stringify(clips)).toBe(snapshot);
    expect(clip.querySelector('img')).toHaveAttribute('draggable', 'false');
  });

  it('synchronizes an already-playing audio clip and overlapping tracks when seeking', () => {
    const { surface, audio, head } = openTimeline();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(audio[0].paused).toBe(false);
    fireEvent.click(surface, { clientX: 700 });
    expect(audio[0].currentTime).toBe(6);
    expect(audio[1].currentTime).toBe(1);
    expect(audio[1].paused).toBe(false);
    fireEvent.click(surface, { clientX: 300 });
    expect(audio[0].currentTime).toBe(2);
    expect(audio[1].paused).toBe(true);
    frame(100);
    expect(head).toHaveAttribute('aria-valuenow', '2100');
  });

  it('pauses while scrubbing and resumes only if playback was already running', () => {
    const { surface, audio, head } = openTimeline();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.pointerDown(surface, pointer(300));
    expect(audio[0].paused).toBe(true);
    expect(frames.size).toBe(0);
    fireEvent.pointerMove(window, pointer(700));
    expect(audio[0].currentTime).toBe(6);
    expect(audio[1].currentTime).toBe(1);
    expect(audio[1].paused).toBe(true);
    fireEvent.pointerUp(window, pointer(800));
    expect(audio[0].currentTime).toBe(7);
    expect(audio[1].currentTime).toBe(2);
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    frame(100);
    expect(head).toHaveAttribute('aria-valuenow', '7100');
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(head).toHaveAttribute('aria-valuenow', '0');
    expect(audio.every(player => player.paused && player.currentTime === 0)).toBe(true);
  });

  it.each(['pointercancel', 'blur', 'lostpointercapture'])('ends a cancelled drag on %s without unexpected playback', (eventName) => {
    const { surface, head } = openTimeline();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.pointerDown(surface, pointer(300));
    fireEvent.pointerMove(window, pointer(700));
    if (eventName === 'blur') fireEvent.blur(window);
    else if (eventName === 'lostpointercapture') fireEvent.lostPointerCapture(window, pointer(700));
    else fireEvent.pointerCancel(window, pointer(700));
    fireEvent.pointerMove(window, pointer(900));
    fireEvent.pointerUp(window, pointer(900));
    expect(head).toHaveAttribute('aria-valuenow', '6000');
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument();
    expect(frames.size).toBe(0);
  });

  it('ignores secondary pointers and right-click dragging', () => {
    const { surface, head } = openTimeline();
    fireEvent.pointerDown(surface, { ...pointer(600), button: 2 });
    fireEvent.pointerMove(window, pointer(800));
    expect(head).toHaveAttribute('aria-valuenow', '0');
    fireEvent.pointerDown(surface, { ...pointer(400), pointerType: 'touch' });
    fireEvent.pointerMove(window, pointer(900, 2));
    fireEvent.pointerUp(window, pointer(900, 2));
    expect(head).toHaveAttribute('aria-valuenow', '3000');
    fireEvent.pointerUp(window, pointer(500));
    expect(head).toHaveAttribute('aria-valuenow', '4000');
  });

  it('supports keyboard fine seeking and Home/End without overflowing the duration', () => {
    const { head } = openTimeline();
    fireEvent.keyDown(head, { key: 'ArrowRight' });
    expect(head).toHaveAttribute('aria-valuenow', '100');
    fireEvent.keyDown(head, { key: 'ArrowRight', shiftKey: true });
    expect(head).toHaveAttribute('aria-valuenow', '1100');
    fireEvent.keyDown(head, { key: 'End' });
    fireEvent.keyDown(head, { key: 'ArrowRight' });
    expect(head).toHaveAttribute('aria-valuenow', '10000');
    fireEvent.keyDown(head, { key: 'Home' });
    fireEvent.keyDown(head, { key: 'ArrowLeft' });
    expect(head).toHaveAttribute('aria-valuenow', '0');
  });

  it('does not seek or pause when adding or deleting audio', () => {
    const onDeleteClip = vi.fn();
    const onAddBgm = vi.fn();
    const { surface, head } = openTimeline({ onDeleteClip, onAddBgm });
    fireEvent.click(surface, { clientX: 700 });
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    const remove = screen.getByTitle('删除 BGM');
    fireEvent.pointerDown(remove, pointer(900));
    fireEvent.pointerUp(window, pointer(900));
    fireEvent.click(remove, { clientX: 900 });
    fireEvent.click(screen.getByTitle('添加本地 BGM'));
    expect(head).toHaveAttribute('aria-valuenow', '6000');
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();
    expect(onDeleteClip).toHaveBeenCalledExactlyOnceWith(clips[3]);
    expect(onAddBgm).toHaveBeenCalledOnce();
  });

  it('stops at the end, replays from zero, and cancels audio and animation on unmount', () => {
    const { audio, head, unmount } = openTimeline();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    frame(10000);
    expect(head).toHaveAttribute('aria-valuenow', '10000');
    expect(audio.every(player => player.paused)).toBe(true);
    expect(frames.size).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(head).toHaveAttribute('aria-valuenow', '0');
    expect(audio[0].currentTime).toBe(0);
    unmount();
    expect(frames.size).toBe(0);
    expect(audio.every(player => player.paused)).toBe(true);
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    fireEvent.pointerUp(window, pointer(500));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('captures the pointer and releases it with all listeners when unmounted during a drag', () => {
    const { audio, head, unmount } = openTimeline();
    head.setPointerCapture = vi.fn();
    head.hasPointerCapture = vi.fn().mockReturnValue(true);
    head.releasePointerCapture = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.pointerDown(head, pointer(300));
    expect(head.setPointerCapture).toHaveBeenCalledWith(1);
    unmount();
    expect(head.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
    vi.mocked(HTMLMediaElement.prototype.play).mockClear();
    fireEvent.pointerMove(window, pointer(900));
    fireEvent.pointerUp(window, pointer(900));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(audio[0].currentTime).toBe(2);
    expect(frames.size).toBe(0);
  });

  it('clamps the position if the duration shrinks and safely handles an empty track', () => {
    const { head, surface, rerender } = openTimeline();
    fireEvent.click(surface, { clientX: 900 });
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    rerender(<TimelineTrack mode="combined" clips={clips} totalDurationMs={3000} />);
    expect(head).toHaveAttribute('aria-valuenow', '3000');
    expect(frames.size).toBe(0);
    rerender(<TimelineTrack mode="combined" clips={[]} totalDurationMs={0} />);
    expect(head).toHaveAttribute('aria-valuenow', '0');
    expect(head).toHaveStyle({ left: '0%' });
    expect(screen.getByRole('button', { name: '播放' })).toBeDisabled();
    vi.mocked(surface.getBoundingClientRect).mockReturnValue({ left: 100, width: 0 } as DOMRect);
    fireEvent.click(surface, { clientX: 500 });
    expect(head).toHaveAttribute('aria-valuenow', '0');
  });
});
