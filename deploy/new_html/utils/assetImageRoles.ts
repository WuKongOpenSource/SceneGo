export const ASSET_IMAGE_FILE_ROLES = [
  'reference_image',
  'material_image',
  'generated_image',
] as const;

export type AssetImageFileRole = typeof ASSET_IMAGE_FILE_ROLES[number];

export const DESIGN_ASSET_IMAGE_FILE_ROLES = [
  'reference_image',
  'generated_image',
] as const;

export const MATERIAL_STAGE_ASSET_IMAGE_FILE_ROLES = [
  'material_image',
] as const;

export type DesignAssetImageFileRole = typeof DESIGN_ASSET_IMAGE_FILE_ROLES[number];
export type MaterialStageAssetImageFileRole = typeof MATERIAL_STAGE_ASSET_IMAGE_FILE_ROLES[number];

const ASSET_IMAGE_FILE_ROLE_SET: ReadonlySet<string> = new Set(ASSET_IMAGE_FILE_ROLES);
const DESIGN_ASSET_IMAGE_FILE_ROLE_SET: ReadonlySet<string> = new Set(DESIGN_ASSET_IMAGE_FILE_ROLES);
const MATERIAL_STAGE_ASSET_IMAGE_FILE_ROLE_SET: ReadonlySet<string> = new Set(MATERIAL_STAGE_ASSET_IMAGE_FILE_ROLES);

export function isAssetImageFileRole(role: string | null | undefined): role is AssetImageFileRole {
  return typeof role === 'string' && ASSET_IMAGE_FILE_ROLE_SET.has(role);
}

export function isDesignAssetImageFileRole(
  role: string | null | undefined,
): role is DesignAssetImageFileRole {
  return typeof role === 'string' && DESIGN_ASSET_IMAGE_FILE_ROLE_SET.has(role);
}

export function isMaterialStageAssetImageFileRole(
  role: string | null | undefined,
): role is MaterialStageAssetImageFileRole {
  return typeof role === 'string' && MATERIAL_STAGE_ASSET_IMAGE_FILE_ROLE_SET.has(role);
}
