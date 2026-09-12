import { expect, it } from 'vitest';
import { audioFadeGain, normalizeAudioFades } from '../../utils/audioFades';

it('fades relative to the trimmed clip edges without changing the source or base volume', () => {
  expect([0, 1, 2, 5, 8, 9, 10].map(t => audioFadeGain(10, t, 2, 2))).toEqual([0, .5, 1, 1, 1, .5, 0]);
  expect(audioFadeGain(10, 0, 0, 0)).toBe(1);
  expect(audioFadeGain(10, 5, 0, 0)).toBe(1);
  expect(normalizeAudioFades(3, 2, 5)).toEqual({ fadeIn: 2, fadeOut: 1 });
  expect(normalizeAudioFades(3, -1, NaN)).toEqual({ fadeIn: 0, fadeOut: 0 });
});
