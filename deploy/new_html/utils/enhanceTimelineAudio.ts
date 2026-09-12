import { audioFadeGain } from './audioFades';

export interface TimelineAudioClip {
  id: string;
  startTime: number;
  duration: number;
  sourceOffset?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  enabled?: boolean;
}

export interface TimelineAudioElement {
  currentTime: number;
  paused: boolean;
  volume?: number;
  play: () => Promise<void> | void;
  pause: () => void;
}

export interface SyncTimelineAudioOptions {
  clips: TimelineAudioClip[];
  audioElements: Map<string, TimelineAudioElement>;
  currentTime: number;
  playing: boolean;
}

export async function syncTimelineAudioPlayback({
  clips,
  audioElements,
  currentTime,
  playing,
}: SyncTimelineAudioOptions): Promise<void> {
  if (!playing) {
    audioElements.forEach(el => el.pause());
    return;
  }

  await Promise.all(clips.map(async clip => {
    const el = audioElements.get(clip.id);
    if (!el) return;
    if (clip.enabled === false) {
      el.pause();
      return;
    }
    const inRange = currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration;
    if (!inRange) {
      el.pause();
      return;
    }

    const target = Math.max(0, currentTime - clip.startTime + (clip.sourceOffset || 0));
    if (typeof el.volume === 'number') {
      const volume = Number.isFinite(clip.volume) ? clip.volume! : 1;
      el.volume = Math.min(1, Math.max(0, volume)) * audioFadeGain(
        clip.duration, currentTime - clip.startTime, clip.fadeIn, clip.fadeOut,
      );
    }
    if (el.paused || Math.abs(el.currentTime - target) > 0.35) {
      el.currentTime = target;
    }
    if (el.paused) {
      await el.play();
    }
  }));
}
