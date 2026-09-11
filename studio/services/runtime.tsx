import React, { createContext, useContext } from 'react';
import type {
  AppNode,
  Connection,
  Group,
  SmartSequenceItem,
  VideoGenerationMode,
  Workflow,
} from '../types';
import type { StudioCreditFeature, StudioCreditQuote } from './creditPolicy';

export interface StudioSnapshot {
  schemaVersion: 1;
  assets: Array<Record<string, unknown>>;
  workflows: Workflow[];
  nodes: AppNode[];
  connections: Connection[];
  groups: Group[];
}
export interface StudioImageOptions {
  aspectRatio?: string;
  resolution?: string;
  count?: number;
  nodeId?: string;
}

export interface StudioVideoOptions {
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  count?: number;
  nodeId?: string;
  generationMode?: VideoGenerationMode;
  inputImage?: string | null;
  referenceImages?: string[];
}

export interface StudioVideoResult {
  uri: string;
  uris?: string[];
  taskId?: string;
}

export interface StudioChatOptions {
  isThinkingMode?: boolean;
  isStoryboard?: boolean;
  isHelpMeWrite?: boolean;
}

export interface StudioRuntime {
  projectId: string;
  episodeId: string;
  returnTo: string;
  loadSnapshot(): Promise<StudioSnapshot | null>;
  saveSnapshot(snapshot: StudioSnapshot): Promise<void>;
  uploadAsset(file: File, nodeId?: string): Promise<string>;
  uploadDataUrl(dataUrl: string, fileName: string, nodeId?: string): Promise<string>;
  getCreditBalance(): Promise<number>;
  estimateCredits(
    featureKey: StudioCreditFeature,
    params: Record<string, unknown>,
  ): Promise<StudioCreditQuote>;
  sendChatMessage(
    history: Array<{ role: string; parts: Array<{ text: string }> }>,
    message: string,
    options?: StudioChatOptions,
  ): Promise<string>;
  generateImage(
    prompt: string,
    model: string,
    references?: string[],
    options?: StudioImageOptions,
  ): Promise<string[]>;
  generateVideo(
    prompt: string,
    model: string,
    options?: StudioVideoOptions,
  ): Promise<StudioVideoResult>;
  generateAudio(
    text: string,
    options?: { nodeId?: string; voiceId?: string; emotion?: string },
  ): Promise<string>;
  planStoryboard(prompt: string, context: string): Promise<string[]>;
  orchestrateVideoPrompt(images: string[], prompt: string): Promise<string>;
  editImage(image: string, prompt: string, model: string, nodeId?: string): Promise<string>;
  compileMultiFramePrompt(frames: SmartSequenceItem[]): string;
}

const RuntimeContext = createContext<StudioRuntime | null>(null);

export const StudioRuntimeProvider: React.FC<{
  runtime: StudioRuntime;
  children: React.ReactNode;
}> = ({ runtime, children }) => (
  <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>
);

export function useStudioRuntime(): StudioRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) {
    throw new Error('StudioRuntimeProvider missing');
  }
  return runtime;
}
