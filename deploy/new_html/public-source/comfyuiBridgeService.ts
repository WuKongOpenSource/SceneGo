import { invokePublicLocalRuntime } from './localRuntimeAdapter';

export type MaterialWorkflowType = 'upscale_hd' | 'image_upscale' | 'remove_watermark' | 'three_view';

export interface MaterialEntityOptions {
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  episodeId?: string;
  projectId?: string;
  targetLongEdge?: number;
  dpi?: number;
  textClarity?: boolean;
  preferredAgentId?: string;
  preferredNodeId?: string;
  sourceFileId?: string;
}

export interface PublicLocalUploadResult {
  success: boolean;
  filename: string;
  storage_url: string;
  file_id?: string;
}

export interface PublicLocalMaterialTaskResult {
  success: boolean;
  task_id: string;
  message: string;
}

export async function uploadImageToComfyUI(
  imageUrlOrDataUrl: string | Blob,
  options?: { standalone?: boolean },
): Promise<PublicLocalUploadResult> {
  return invokePublicLocalRuntime<PublicLocalUploadResult>('media.upload', [imageUrlOrDataUrl, options]);
}

export async function processMaterial(
  imageFilename: string,
  workflowType: MaterialWorkflowType,
  entityOptions?: MaterialEntityOptions,
): Promise<PublicLocalMaterialTaskResult> {
  return invokePublicLocalRuntime<PublicLocalMaterialTaskResult>(
    'material.process',
    [imageFilename, workflowType, entityOptions],
  );
}
