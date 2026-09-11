import { invokePublicLocalRuntime, type PublicLocalRuntimeOperation } from './localRuntimeAdapter';

export type ComfyUIEntityOptions = {
  entityType?: string;
  entityId?: string;
  fileRole?: string;
  projectId?: string;
  episodeId?: string;
  preferredAgentId?: string;
  preferredNodeId?: string;
  outputWidth?: number;
  outputHeight?: number;
};

type PublicLocalImageCall = (...args: unknown[]) => Promise<any>;

const invoke = (operation: PublicLocalRuntimeOperation): PublicLocalImageCall => (
  ...args: unknown[]
) => invokePublicLocalRuntime(operation, args);

export const adjustImageAngle = invoke('image.adjust-angle');
export const generateHumanMultiAngle = invoke('image.human-multi-angle');
export const generateAroundAngle = invoke('image.around-angle');
export const generateWithComfyUI = invoke('image.generate');
export const generateWithComfyUIWorkflow = invoke('image.workflow.generate');
export const processMaterialImage = invoke('image.material.process');
export const generateWithComfyUIWorkflowQueued = invoke('image.workflow.generate-and-wait');
export const generateHumanMultiAngleQueued = invoke('image.human-multi-angle-and-wait');
export const generateAroundAngleQueued = invoke('image.around-angle-and-wait');
export const adjustImageAngleQueued = invoke('image.adjust-angle-and-wait');
export const generateMatting = invoke('image.matting');
export const generateMattingQueued = invoke('image.matting-and-wait');
export const generateImageFusion = invoke('image.fusion');
export const generateImageFusionQueued = invoke('image.fusion-and-wait');
export const generatePanorama360 = invoke('image.panorama-360');
export const generatePanorama360Queued = invoke('image.panorama-360-and-wait');
export const generatePanoramaFusion = invoke('image.panorama-fusion');
export const generatePanoramaFusionQueued = invoke('image.panorama-fusion-and-wait');
export const generateAutoStoryboard = invoke('image.storyboard.auto');
export const generateAutoStoryboardQueued = invoke('image.storyboard.auto-and-wait');
export const generateMultiGridStoryboard = invoke('image.storyboard.multi-grid');
