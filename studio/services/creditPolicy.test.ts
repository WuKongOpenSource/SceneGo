import { describe, expect, it } from 'vitest';
import { NodeStatus, NodeType, type AppNode } from '../types';
import {
  buildStudioNodeCreditRequest,
  buildStudioTextCreditRequest,
  summarizeStudioCreditQuote,
} from './creditPolicy';

function node(type: NodeType, data: AppNode['data'] = {}): AppNode {
  return {
    id: 'node-1',
    type,
    x: 0,
    y: 0,
    title: 'test',
    status: NodeStatus.IDLE,
    data,
    inputs: [],
  };
}

describe('Studio credit policy', () => {
  it('quotes batch Seedance generation with the server-owned task shape', () => {
    const request = buildStudioNodeCreditRequest(node(NodeType.VIDEO_GENERATOR, {
      model: 'standard',
      duration: 10,
      resolution: '720p',
      videoCount: 3,
    }));

    expect(request).toEqual({
      featureKey: 'video_generation',
      params: {
        model: 'Seedance2',
        sub_model: 'standard',
        duration_seconds: 10,
        resolution: '720P',
        h3_upscale_720p: false,
      },
      quantity: 3,
      fallbackUnitCost: 210,
    });

    expect(summarizeStudioCreditQuote(request!, {
      enabled: true,
      estimatedCost: 210,
      balance: 500,
      enough: true,
    })).toMatchObject({ totalCost: 630, enough: false });
  });

  it('uses the reduced Seedance 1.5 Agent Plan fallback price', () => {
    expect(buildStudioNodeCreditRequest(node(NodeType.VIDEO_GENERATOR, {
      model: 'Seedance15',
      duration: 5,
      resolution: '720p',
    }))).toMatchObject({
      params: {
        model: 'Seedance15',
        sub_model: 'agent_plan',
        duration_seconds: 5,
        resolution: '720P',
      },
      fallbackUnitCost: 32,
    });
  });

  it('quotes node models with the shared model key and guarded 720p upscale cost', () => {
    expect(buildStudioNodeCreditRequest(node(NodeType.VIDEO_GENERATOR, {
      model: 'MiniMaxH3Mini',
      duration: 5,
      resolution: '720p',
    }))).toEqual({
      featureKey: 'video_generation',
      params: {
        model: 'MiniMaxH3Mini',
        duration_seconds: 5,
        resolution: '720P',
        h3_upscale_720p: true,
      },
      quantity: 1,
      fallbackUnitCost: 10,
    });
  });

  it('passes image count and audio character count to canonical rules', () => {
    expect(buildStudioNodeCreditRequest(node(NodeType.IMAGE_GENERATOR, {
      model: 'nanobanana',
      imageCount: 4,
      resolution: '2k',
      aspectRatio: '16:9',
    }))).toMatchObject({
      featureKey: 'image_generation',
      params: { image_count: 4, model: 'doubao-seedream-5-0-lite-260128' },
      quantity: 1,
    });

    expect(buildStudioNodeCreditRequest(node(NodeType.AUDIO_GENERATOR, {
      prompt: '你好，创剧',
    }))).toMatchObject({
      featureKey: 'audio_generation_tts',
      params: { character_count: 5, model: 'speech-hd' },
    });
  });

  it('uses the prompt rule for assistant and storyboard text calls', () => {
    expect(buildStudioTextCreditRequest('把一个想法变成好漫剧')).toMatchObject({
      featureKey: 'prompt_optimize',
      params: { model: 'gemini-2.5-flash', output_tokens: 1200 },
      quantity: 1,
      fallbackUnitCost: 2,
    });
  });
});
