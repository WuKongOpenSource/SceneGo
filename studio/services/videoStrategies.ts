import type { AppNode, VideoGenerationMode } from '../types';
import type { StudioRuntime } from './runtime';
import { extractLastFrame, urlToBase64 } from './mediaUtils';
import { STUDIO_IMAGE_MODEL_CONFIGURED } from './modelOptions';

export interface StrategyResult {
  finalPrompt: string;
  inputImageForGeneration: string | null;
  referenceImages: string[];
  generationMode: VideoGenerationMode;
}
function imageInputs(inputs: AppNode[]): string[] {
  return inputs
    .map(node => node.data.croppedFrame || node.data.image || '')
    .filter(Boolean);
}

async function processContinuation(inputs: AppNode[], prompt: string): Promise<StrategyResult> {
  const video = inputs.find(node => node.data.videoUri)?.data.videoUri;
  let lastFrame: string | null = null;
  if (video) {
    try {
      const source = video.startsWith('http') ? await urlToBase64(video) : video;
      lastFrame = await extractLastFrame(source);
    } catch (error) {
      console.warn('[studio] failed to extract continuation frame', error);
    }
  }
  return {
    finalPrompt: prompt,
    inputImageForGeneration: lastFrame,
    referenceImages: lastFrame ? [lastFrame] : [],
    generationMode: 'CONTINUE',
  };
}

export async function getGenerationStrategy(
  runtime: StudioRuntime,
  node: AppNode,
  inputs: AppNode[],
  prompt: string,
): Promise<StrategyResult> {
  const mode = node.data.generationMode || 'DEFAULT';
  const images = imageInputs(inputs);

  if (mode === 'CONTINUE') {
    return processContinuation(inputs, prompt);
  }

  if (mode === 'FIRST_LAST_FRAME') {
    const selected = images.slice(0, 2);
    return {
      finalPrompt: selected.length > 1
        ? await runtime.orchestrateVideoPrompt(selected, prompt)
        : prompt,
      inputImageForGeneration: selected[0] || null,
      referenceImages: selected,
      generationMode: mode,
    };
  }

  if (mode === 'CUT') {
    const source = node.data.croppedFrame || images[0] || null;
    if (!source) {
      return {
        finalPrompt: prompt,
        inputImageForGeneration: null,
        referenceImages: [],
        generationMode: mode,
      };
    }
    const [restored] = await runtime.generateImage(
      `保持原图构图、人物、机位与动作不变，仅修复清晰度和细节。补充要求：${prompt}`,
      STUDIO_IMAGE_MODEL_CONFIGURED,
      [source],
      {
        aspectRatio: node.data.aspectRatio || '16:9',
        count: 1,
        nodeId: node.id,
      },
    );
    return {
      finalPrompt: prompt,
      inputImageForGeneration: restored || source,
      referenceImages: restored ? [restored] : [source],
      generationMode: mode,
    };
  }

  if (mode === 'CHARACTER_REF') {
    return {
      finalPrompt: prompt,
      inputImageForGeneration: images[0] || null,
      referenceImages: images.slice(0, 4),
      generationMode: mode,
    };
  }

  return {
    finalPrompt: prompt,
    inputImageForGeneration: images[0] || null,
    referenceImages: images.slice(0, 1),
    generationMode: 'DEFAULT',
  };
}
