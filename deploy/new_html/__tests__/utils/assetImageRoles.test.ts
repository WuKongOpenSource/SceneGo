import { describe, expect, it } from 'vitest';

import {
  ASSET_IMAGE_FILE_ROLES,
  DESIGN_ASSET_IMAGE_FILE_ROLES,
  MATERIAL_STAGE_ASSET_IMAGE_FILE_ROLES,
  isAssetImageFileRole,
  isDesignAssetImageFileRole,
  isMaterialStageAssetImageFileRole,
} from '../../utils/assetImageRoles';

describe('asset image file roles', () => {
  it('accepts every asset image role shared by design and materials', () => {
    expect(ASSET_IMAGE_FILE_ROLES).toEqual([
      'reference_image',
      'material_image',
      'generated_image',
    ]);

    expect(isAssetImageFileRole('reference_image')).toBe(true);
    expect(isAssetImageFileRole('material_image')).toBe(true);
    expect(isAssetImageFileRole('generated_image')).toBe(true);
  });

  it('rejects non-asset roles', () => {
    expect(isAssetImageFileRole('video')).toBe(false);
    expect(isAssetImageFileRole('character_ref')).toBe(false);
    expect(isAssetImageFileRole(undefined)).toBe(false);
  });

  it('separates design images from material-stage variants', () => {
    expect(DESIGN_ASSET_IMAGE_FILE_ROLES).toEqual(['reference_image', 'generated_image']);
    expect(MATERIAL_STAGE_ASSET_IMAGE_FILE_ROLES).toEqual(['material_image']);

    expect(isDesignAssetImageFileRole('reference_image')).toBe(true);
    expect(isDesignAssetImageFileRole('generated_image')).toBe(true);
    expect(isDesignAssetImageFileRole('material_image')).toBe(false);

    expect(isMaterialStageAssetImageFileRole('material_image')).toBe(true);
    expect(isMaterialStageAssetImageFileRole('reference_image')).toBe(false);
  });
});
