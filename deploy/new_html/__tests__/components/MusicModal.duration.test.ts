import { describe, expect, it } from 'vitest';
import { normalizeMusicDurationInput } from '../../components/audio/MusicModal';

describe('MusicModal duration input', () => {
  it('allows a complete draft value before validating it', () => {
    expect(normalizeMusicDurationInput('65')).toBe(65);
    expect(normalizeMusicDurationInput('')).toBe(30);
  });

  it('clamps only the committed value to the supported range', () => {
    expect(normalizeMusicDurationInput('1')).toBe(10);
    expect(normalizeMusicDurationInput('500')).toBe(300);
  });
});
