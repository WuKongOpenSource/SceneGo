export type TurnaroundAssetType = 'character' | 'scene' | 'prop';

const CHARACTER_TURNAROUND_SUFFIX = [
  'Create one clean horizontal four-panel character reference sheet of the exact same character, with exactly four images arranged side by side from left to right.',
  'Panel 1: full-body front view. Panel 2: full-body strict 90-degree side profile. Panel 3: full-body back view. Panel 4: an enlarged front-facing waist-up half-body portrait with a clearly visible face.',
  'The first three panels must show the complete body at the same scale and neutral standing pose; the fourth panel must be a larger half-body portrait, not another full-body view.',
  'Keep the identity, face, age, hairstyle, outfit, body proportions, colors, and identifying details exactly identical in all four panels.',
  'Do not duplicate, mirror, repeat, or substitute any panel. Do not generate both left-side and right-side views.',
  'Use a seamless pure white background with no scene, text, labels, borders, props, or extra characters.',
  'All four views, especially Panel 4 (the enlarged waist-up portrait), must share the same seamless pure white (#FFFFFF) canvas. No separate portrait rectangle, gray or blue backdrop, gradient, vignette or visible panel border. Use neutral even studio lighting; these background requirements override any environmental lighting or backdrop in the description.',
  'Match the explicitly described age and facial features in every view. Do not age up a young adult because of historical clothing, occupation or a serious expression; do not invent a beard or mature wrinkles. Preserve any facial hair explicitly requested.',
].join(' ');

const PROP_TURNAROUND_SUFFIX = [
  'Create a clean four-panel prop turnaround sheet showing front, rear, left-side, and right-side views of the exact same object.',
  'Keep the shape, proportions, materials, colors, wear, and decorative details identical in every panel.',
  'Isolate the object on a pure white background with no character, hands, scene, text, labels, borders, or extra objects.',
].join(' ');

export function supportsStandardTurnaround(assetType: TurnaroundAssetType): boolean {
  return assetType === 'character' || assetType === 'prop';
}

export function standardTurnaroundLabel(assetType: TurnaroundAssetType): string {
  return assetType === 'prop' ? '道具白底四视图' : '人物白底四视图';
}

export function standardTurnaroundPrompt(assetType: TurnaroundAssetType): string {
  if (assetType === 'character') return CHARACTER_TURNAROUND_SUFFIX;
  if (assetType === 'prop') return PROP_TURNAROUND_SUFFIX;
  return '';
}

export function withStandardTurnaround(
  prompt: string,
  assetType: TurnaroundAssetType,
  enabled = true,
): string {
  const base = String(prompt || '').trim();
  if (!enabled || !supportsStandardTurnaround(assetType)) return base;
  const suffix = standardTurnaroundPrompt(assetType);
  if (!suffix || base.includes(suffix)) return base;
  return [base, suffix].filter(Boolean).join('\n');
}

export function standardTurnaroundAspectRatio(
  assetType: TurnaroundAssetType,
  requested: string,
  enabled = true,
): string {
  return enabled && supportsStandardTurnaround(assetType) ? '16:9' : requested;
}
