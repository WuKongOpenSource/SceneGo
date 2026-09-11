/** Camera motion changes viewpoint, not the source image's pixel orientation. */
export const CAMERA_VIEWPOINT_GUARD = [
  'Interpret camera angle changes as moving the camera in the 3D scene, not rotating the image plane.',
  'For a horizontal angle change, orbit the camera around the main subject about the world vertical axis, keeping the lens aimed at the same subject.',
  'Keep camera roll at zero and the horizon level; keep the scene upright.',
  'Do not rotate, tilt, flip, or mirror the canvas, and do not turn the subject in place to simulate a new viewpoint.',
  'Keep the subject pose and world-space positions of people and objects unchanged.',
  'Reconstruct perspective, foreshortening, occlusion, and foreground/background parallax consistently from the new camera position instead of preserving their old pixel positions.',
].join(' ');

export const CAMERA_ORBIT_HELP = '相机绕主体水平换机位，始终朝向主体；负值向原机位左侧，正值向右侧，0 保持原机位。改变拍摄角度和透视，不旋转画面、不让主体转身。角度为 AI 重建参考，并非精确三维测量。';

export function buildHorizontalCameraOrbitInstruction(angle: number): string {
  if (!Number.isFinite(angle) || angle === 0) return '';
  const direction = angle < 0 ? 'left' : 'right';
  const degrees = Math.abs(angle);
  return `相机围绕主体向原机位${angle < 0 ? '左' : '右'}侧水平环绕 ${degrees} 度，镜头持续对准主体。 `
    + `Move the camera position along a horizontal orbit of ${degrees} degrees around the main subject toward the ${direction} of the original camera position, keeping the lens aimed at the subject.`;
}
