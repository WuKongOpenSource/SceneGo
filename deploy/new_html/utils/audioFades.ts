export function normalizeAudioFades(duration: number, fadeIn = 0, fadeOut = 0) {
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const length = finite(duration);
  const start = Math.min(length, finite(fadeIn));
  return { fadeIn: start, fadeOut: Math.min(Math.max(0, length - start), finite(fadeOut)) };
}

export function audioFadeGain(duration: number, elapsed: number, fadeIn = 0, fadeOut = 0): number {
  const fades = normalizeAudioFades(duration, fadeIn, fadeOut);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= duration) return 0;
  return Math.min(1, fades.fadeIn > 0 ? elapsed / fades.fadeIn : 1,
    fades.fadeOut > 0 ? (duration - elapsed) / fades.fadeOut : 1);
}
