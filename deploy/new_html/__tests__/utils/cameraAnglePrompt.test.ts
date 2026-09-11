import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHorizontalCameraOrbitInstruction, CAMERA_ORBIT_HELP, CAMERA_VIEWPOINT_GUARD } from '../../utils/cameraAnglePrompt';

describe('horizontal camera orbit instructions', () => {
  it.each([
    [-90, 'left', '左', 90], [-45, 'left', '左', 45],
    [45, 'right', '右', 45], [90, 'right', '右', 90],
  ])('maps %s to moving the camera around the subject', (angle, side, chineseSide, degrees) => {
    const prompt = buildHorizontalCameraOrbitInstruction(Number(angle));
    expect(prompt).toContain(`horizontal orbit of ${degrees} degrees around the main subject`);
    expect(prompt).toContain(`toward the ${side} of the original camera position`);
    expect(prompt).toContain(`原机位${chineseSide}侧水平环绕 ${degrees} 度`);
    expect(prompt).toContain('keeping the lens aimed at the subject');
    expect(prompt).not.toMatch(/Rotate (the )?camera/i);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'does not invent an orbit for %s', angle => {
      expect(buildHorizontalCameraOrbitInstruction(angle)).toBe('');
    },
  );

  it('keeps the scene upright while allowing viewpoint-dependent perspective and occlusion', () => {
    expect(CAMERA_VIEWPOINT_GUARD).toContain('world vertical axis');
    expect(CAMERA_VIEWPOINT_GUARD).toContain('camera roll at zero');
    expect(CAMERA_VIEWPOINT_GUARD).toContain('horizon level');
    expect(CAMERA_VIEWPOINT_GUARD).toContain('Do not rotate, tilt, flip, or mirror the canvas');
    expect(CAMERA_VIEWPOINT_GUARD).toContain('do not turn the subject in place');
    expect(CAMERA_VIEWPOINT_GUARD).toContain('world-space positions');
    expect(CAMERA_VIEWPOINT_GUARD).toContain('perspective, foreshortening, occlusion, and foreground/background parallax');
    expect(CAMERA_ORBIT_HELP).toContain('0 保持原机位');
    expect(CAMERA_ORBIT_HELP).toContain('并非精确三维测量');
  });

  it.each(['components/GenerationPage.tsx', 'components/MaterialPage.tsx', 'pages/DesignPage.tsx'])(
    '%s submits the shared orbit instruction and explains its meaning', file => {
      const source = readFileSync(resolve(__dirname, '../..', file), 'utf-8');
      expect(source).toMatch(/buildHorizontalCameraOrbitInstruction\((params|payload)\.rotate\)/);
      expect(source).toContain('label="水平环绕机位 (°)"');
      expect(source).toContain('{CAMERA_ORBIT_HELP}');
      expect(source).toContain('保持当前画面构图和内容。');
      expect(source).not.toMatch(/Rotate (the )?camera/);
    },
  );
});
