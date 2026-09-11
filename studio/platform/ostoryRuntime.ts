import { createStudioSnapshotStore } from './studioSnapshotStore';
export { parseStudioSnapshot, stripEmbeddedMedia } from './studioSnapshotStore';
import {
  assertEnoughCredits,
  consumeCredits,
  estimateCredits as estimateHostCredits,
  estimateTextTokens,
  getCreditBalance as getHostCreditBalance,
} from '@app/services/creditService';
import { uploadEntityFile } from '@app/services/entityFileService';
import {
  generateImageWithPreferredFallback,
  imageEngineForModel,
} from '@app/services/preferredImageGenerationService';
import { recommendDoubaoImageSize } from '@app/utils/doubaoImageSize';
import { callGeminiProxyWithRetry } from '@app/services/geminiProxyService';
import { minimaxTTSSync } from '@runtime/audioGenerationService';
import { taskRegistry } from '@app/services/taskRegistry';
import { startVideoPoll } from '@app/services/videoTaskPoller';
import {
  submitDashScopeVideoTask,
  submitSeedanceTask,
  submitTask,
} from '@runtime/videoTaskService';
import { fetchVideoCapabilities } from '@app/services/videoWorkflowService';
import {
  getModelDisplayName,
  getVideoCreditEstimateParams,
  isComfyUIModel,
  isDashScopeVideoModel,
  isMiniMaxH3Model,
  isSeedanceVideoModel,
  makeDefaultDashScopeParams,
  seedanceSubModelForVideoModel,
  type SeedanceMediaInput,
  type VideoModel,
} from '@app/services/videoModelService';
import type { TaskKind } from '@app/types';
import type {
  StudioChatOptions,
  StudioImageOptions,
  StudioRuntime,
  StudioVideoOptions,
} from '../services/runtime';
import type { StudioCreditFeature, StudioCreditQuote } from '../services/creditPolicy';
import {
  STUDIO_AUDIO_MODEL_SPEECH_HD,
  STUDIO_IMAGE_MODEL_CONFIGURED,
  STUDIO_TEXT_MODEL_CONFIGURED,
  getStudioVideoDuration,
  normalizeStudioAudioModel,
  normalizeStudioImageModel,
  normalizeStudioVideoModel,
  studioImageModelOverride,
  studioVideoCapabilityKey,
} from '../services/modelOptions';
import type { SmartSequenceItem, VideoGenerationMode } from '../types';

const DEFAULT_VOICE_ID = 'male-qn-qingse';
const STUDIO_MODEL_SCOPE = 'studio';

type JsonRecord = Record<string, any>;

export async function chargeSuccessfulResult<T>(
  run: () => Promise<T>,
  charge: (result: T) => Promise<unknown>,
): Promise<T> {
  const result = await run();
  await charge(result);
  return result;
}

export function buildSeedanceMediaInputs(
  generationMode: VideoGenerationMode,
  inputImage?: string | null,
  referenceImages: string[] = [],
): SeedanceMediaInput[] {
  const unique = Array.from(new Set(
    [inputImage, ...referenceImages].filter((value): value is string => Boolean(value?.trim())),
  ));
  if (unique.length === 0) return [];

  if (generationMode === 'FIRST_LAST_FRAME') {
    return unique.map((url, index) => ({
      kind: 'image',
      url,
      role: index === 0 ? 'first_frame' : index === 1 ? 'last_frame' : 'reference_image',
    }));
  }
  if (generationMode === 'CHARACTER_REF') {
    return unique.map(url => ({ kind: 'image', url, role: 'reference_image' }));
  }
  return unique.map((url, index) => ({
    kind: 'image',
    url,
    role: index === 0 ? 'first_frame' : 'reference_image',
  }));
}

export function extractVideoResult(status: any): string {
  const result = status?.result;
  if (typeof result === 'string') return result;
  const firstVideo = Array.isArray(result?.videos) ? result.videos[0] : null;
  return firstVideo?.url || result?.video_url || result?.file_url || result?.url || '';
}

export function assertStudioBatchCredits(
  quote: { enabled: boolean; estimated_cost: number; balance: number | null },
  quantity: number,
): void {
  if (!quote.enabled) return;
  const total = Math.max(0, Number(quote.estimated_cost || 0)) * Math.max(1, Math.round(quantity || 1));
  if (quote.balance !== null && quote.balance < total) {
    throw new Error(`创作点数不足：本次预计需要 ${total} 创作点数，当前可用 ${quote.balance} 创作点数`);
  }
}

export function getStudioVideoTaskKind(model: VideoModel): TaskKind {
  if (model === 'Seedance2Fast' || model === 'Seedance2Mini') return 'seedance-fast';
  if (isSeedanceVideoModel(model)) return 'seedance';
  if (model === 'Kling') return 'kling';
  if (model === 'Vidu') return 'vidu';
  if (model === 'HappyHorse') return 'happyhorse';
  if (model === 'Sora2') return 'sora2';
  if (model === 'Veo') return 'veo';
  if (isComfyUIModel(model)) return 'video-comfy';
  return 'video-i2v';
}

function normalizeStudioVideoResolution(value?: string): '480p' | '720p' | '1080p' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === '480p') return '480p';
  if (normalized === '1080p') return '1080p';
  return '720p';
}

function makeTaskId(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `studio-${prefix}:${suffix}`;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function parseJsonArray(text: string): string[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || text;
  const start = fenced.indexOf('[');
  const end = fenced.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('模型未返回可解析的分镜列表');
  const parsed = JSON.parse(fenced.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error('模型返回的分镜格式无效');
  return parsed
    .map(item => typeof item === 'string' ? item.trim() : String(item?.prompt || item?.description || '').trim())
    .filter(Boolean);
}

function studioTaskRegistration(
  taskId: string,
  kind: 'minimax-tts' | 'prompt-rewrite',
  title: string,
  projectId: string,
  episodeId: string,
) {
  taskRegistry.register({
    taskId,
    kind,
    title,
    targetPage: 'canvas',
    initialStatus: 'running',
    targetEntityType: 'episode',
    targetEntityId: episodeId,
    targetProjectId: projectId,
    episodeId,
  });
}









export function createOstoryRuntime(input: {
  projectId: string;
  episodeId: string;
  returnTo: string;
}): StudioRuntime {
  const { projectId, episodeId, returnTo } = input;
  const { loadSnapshot, saveSnapshot } = createStudioSnapshotStore(projectId, episodeId);

  const getCreditBalance = async (): Promise<number> => {
    const result = await getHostCreditBalance();
    return Number(result.available_credits || 0);
  };

  const estimateCredits = async (
    featureKey: StudioCreditFeature,
    params: Record<string, unknown>,
  ): Promise<StudioCreditQuote> => {
    const result = await estimateHostCredits(featureKey, params);
    return {
      enabled: result.enabled,
      estimatedCost: Number(result.estimated_cost || 0),
      balance: result.balance === null ? null : Number(result.balance || 0),
      enough: result.enough,
    };
  };

  const uploadAsset = async (file: File, _nodeId?: string): Promise<string> => {
    const role = file.type.startsWith('image/')
      ? 'studio_reference'
      : file.type.startsWith('video/')
        ? 'studio_video'
        : file.type.startsWith('audio/')
          ? 'studio_audio'
          : 'studio_reference';
    const uploaded = await uploadEntityFile(file, 'episode', episodeId, role, episodeId);
    if (!uploaded.fileUrl) throw new Error('文件上传成功，但未返回访问地址');
    return uploaded.fileUrl;
  };

  const uploadDataUrl = async (dataUrl: string, fileName: string, nodeId?: string): Promise<string> => {
    if (!dataUrl.startsWith('data:')) return dataUrl;
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return uploadAsset(new File([blob], fileName, { type: blob.type || 'application/octet-stream' }), nodeId);
  };

  const normalizeMediaUrl = async (url: string, index: number): Promise<string> => (
    url.startsWith('data:') ? uploadDataUrl(url, `studio-reference-${index}.png`) : url
  );

  const runText = async (
    prompt: string,
    systemPrompt: string,
    displayName: string,
  ): Promise<string> => {
    const taskId = makeTaskId('text');
    const creditParams = {
      input_tokens: estimateTextTokens(`${systemPrompt}\n${prompt}`),
      output_tokens: 1200,
      model: STUDIO_TEXT_MODEL_CONFIGURED,
    };
    await assertEnoughCredits('prompt_optimize', creditParams);
    studioTaskRegistration(taskId, 'prompt-rewrite', displayName, projectId, episodeId);
    try {
      const content = await chargeSuccessfulResult(
        async () => {
          const result = await callGeminiProxyWithRetry(prompt, systemPrompt, 3, undefined, {
            operation: 'studio_free_creation',
            displayName,
            projectId,
            episodeId,
            sourcePage: 'canvas',
            entityType: 'episode',
            entityId: episodeId,
            modelScope: STUDIO_MODEL_SCOPE,
            suppressNotification: true,
          });
          if (!result.trim()) throw new Error('模型未返回内容');
          return result;
        },
        () => consumeCredits({
          featureKey: 'prompt_optimize',
          taskId,
          params: creditParams,
          projectId,
          metadata: { episode_id: episodeId, source_page: 'canvas' },
        }),
      );
      taskRegistry.complete(taskId);
      return content;
    } catch (error) {
      taskRegistry.fail(taskId, normalizeError(error));
      throw error;
    }
  };

  const generateImage = async (
    prompt: string,
    model: string,
    references: string[] = [],
    options: StudioImageOptions = {},
  ): Promise<string[]> => {
    const count = Math.max(1, Math.min(4, Math.round(options.count || 1)));
    const normalizedModel = normalizeStudioImageModel(model);
    const modelOverride = studioImageModelOverride(normalizedModel);
    const imageResolution = options.resolution === '4K' ? '4K' : options.resolution === '1K' ? '1K' : '2K';
    const taskId = makeTaskId('image');
    const creditParams = {
      image_count: count,
      model: modelOverride || STUDIO_IMAGE_MODEL_CONFIGURED,
      resolution: options.resolution || '2K',
      aspect_ratio: options.aspectRatio || '1:1',
    };
    await assertEnoughCredits('image_generation', creditParams);
    let actualBillingModel = modelOverride || STUDIO_IMAGE_MODEL_CONFIGURED;
    let actualModel = normalizedModel;
    let fallbackReason: string | undefined;
    try {
      const urls = await chargeSuccessfulResult(
        async () => {
          const normalizedReferences = await Promise.all(
            references.map((url, index) => normalizeMediaUrl(url, index)),
          );
          const entityOptions = {
            entityType: 'episode', entityId: episodeId, fileRole: 'studio_image',
            projectId, episodeId, sourcePage: 'canvas',
          };
          const generation = await generateImageWithPreferredFallback({
            engine: imageEngineForModel(normalizedModel),
            model: normalizedModel,
            billingModel: normalizedModel,
            count,
            doubao: {
              prompt,
              references: normalizedReferences,
              size: recommendDoubaoImageSize(options.aspectRatio || '1:1', imageResolution),
              sequential: 'disabled',
              modelScope: STUDIO_MODEL_SCOPE,
              ...entityOptions,
            },
            gemini: {
              modelScope: STUDIO_MODEL_SCOPE,
              prompt,
              references: normalizedReferences,
              aspectRatio: options.aspectRatio || '1:1',
              imageSize: imageResolution,
              ...entityOptions,
            },
          });
          actualBillingModel = generation.actualBillingModel;
          actualModel = generation.actualModel;
          fallbackReason = generation.fallbackReason;
          const generatedUrls = generation.files
            .map(file => file.fileUrl || file.url)
            .filter(Boolean);
          if (generatedUrls.length === 0) throw new Error('图片生成接口未返回图片地址');
          return generatedUrls;
        },
        generatedUrls => consumeCredits({
          featureKey: 'image_generation',
          taskId,
          params: { ...creditParams, image_count: generatedUrls.length, model: actualBillingModel },
          projectId,
          metadata: {
            episode_id: episodeId,
            source_page: 'canvas',
            requested_model: normalizedModel,
            actual_model: actualModel,
            fallback_reason: fallbackReason || null,
          },
        }),
      );
      return urls;
    } catch (error) {
      throw error;
    }
  };

  const generateVideo = async (
    prompt: string,
    model: string,
    options: StudioVideoOptions = {},
  ) => {
    const capabilities = await fetchVideoCapabilities(STUDIO_MODEL_SCOPE);
    const normalizedModel = normalizeStudioVideoModel(model);
    const wantedModelKey = studioVideoCapabilityKey(normalizedModel);
    const modelCapability = capabilities.models.find(item => item.key === wantedModelKey);
    if (capabilities.models.length > 0 && modelCapability?.available !== true) {
      throw new Error(`${getModelDisplayName(normalizedModel)}当前不可用，请联系管理员检查运行时模型配置`);
    }

    const rawReferences = options.referenceImages || [];
    const rawMedia = buildSeedanceMediaInputs(
      options.generationMode || 'DEFAULT',
      options.inputImage,
      rawReferences,
    );
    const mediaInputs = await Promise.all(rawMedia.map(async (item, index) => ({
      ...item,
      url: await normalizeMediaUrl(item.url, index),
    })));
    if (
      isSeedanceVideoModel(normalizedModel)
      && !capabilities.seedance_omni
      && mediaInputs.some(item => item.role === 'reference_image')
    ) {
      throw new Error('当前 Seedance 运行时模型不支持多参考图，请联系管理员启用 Seedance 2.0');
    }
    if (
      mediaInputs.length === 0
      && normalizedModel !== 'Kling'
      && !isSeedanceVideoModel(normalizedModel)
    ) {
      throw new Error(`${getModelDisplayName(normalizedModel)}需要至少 1 张输入图片`);
    }

    const resolution = normalizeStudioVideoResolution(options.resolution);
    const duration = getStudioVideoDuration(normalizedModel, options.duration || 5, resolution);
    const count = Math.max(1, Math.min(4, Math.round(options.count || 1)));
    const h3Upscale720p = isMiniMaxH3Model(normalizedModel) && resolution === '720p';
    const creditParams = getVideoCreditEstimateParams(normalizedModel, {
      duration_seconds: duration,
      resolution: resolution.toUpperCase(),
      h3_upscale_720p: h3Upscale720p,
      ...(normalizedModel === 'MINI' ? {
        minimax_resolution: resolution === '1080p' ? '1080P' : '768P',
      } : {}),
    });
    const videoQuote = await assertEnoughCredits('video_generation', creditParams);
    assertStudioBatchCredits(videoQuote, count);

    const urls: string[] = [];
    let lastTaskId = '';
    for (let index = 0; index < count; index += 1) {
      const entityOptions = {
        entity_type: 'episode',
        entity_id: episodeId,
        file_role: 'studio_video',
        project_id: projectId,
        episode_id: episodeId,
        preferred_agent_id: modelCapability?.preferred_agent_id || undefined,
        preferred_node_id: modelCapability?.preferred_node_id || undefined,
      };

      let submitted: { task_id: string };
      if (isSeedanceVideoModel(normalizedModel)) {
        submitted = await submitSeedanceTask({
          sub_model: seedanceSubModelForVideoModel(normalizedModel),
          model_scope: STUDIO_MODEL_SCOPE,
          prompt,
          media_inputs: mediaInputs,
          resolution,
          ratio: (options.aspectRatio || 'adaptive') as any,
          duration,
          generate_audio: true,
        }, entityOptions);
      } else if (isDashScopeVideoModel(normalizedModel)) {
        const aspectRatio = options.aspectRatio === '9:16' ? '9:16' : '16:9';
        const dashMedia = normalizedModel === 'HappyHorse'
          ? mediaInputs.map(item => ({ ...item, role: 'reference_image' as const }))
          : mediaInputs;
        const dashParams = makeDefaultDashScopeParams(
          normalizedModel,
          prompt,
          dashMedia,
          aspectRatio,
        );
        dashParams.duration = duration;
        if (normalizedModel === 'Vidu') {
          const dashResolution = resolution === '480p' ? '540P' : resolution.toUpperCase() as '720P' | '1080P';
          dashParams.resolution = dashResolution;
          dashParams.vidu_resolution = dashResolution;
          dashParams.vidu_size = aspectRatio === '9:16' ? '720*1280' : '1280*720';
        } else if (normalizedModel === 'HappyHorse') {
          dashParams.hh_resolution = resolution === '1080p' ? '1080P' : '720P';
          dashParams.hh_ratio = (options.aspectRatio || aspectRatio) as any;
          dashParams.hh_duration = duration;
        }
        submitted = await submitDashScopeVideoTask(dashParams, entityOptions);
      } else {
        const firstFrame = mediaInputs.find(item => item.role === 'first_frame') || mediaInputs[0];
        const lastFrame = mediaInputs.find(item => item.role === 'last_frame');
        submitted = await submitTask(
          firstFrame?.file_id || firstFrame?.url || '',
          lastFrame?.file_id || lastFrame?.url || null,
          prompt,
          normalizedModel,
          undefined,
          undefined,
          'multi',
          entityOptions,
          {
            duration,
            resolution: resolution.toUpperCase(),
            minimax_resolution: resolution === '1080p' ? '1080P' : '768P',
            minimax_prompt_optimizer: true,
            h3_upscale_720p: h3Upscale720p,
          },
        );
      }
      lastTaskId = submitted.task_id;
      if (!lastTaskId) throw new Error('视频生成接口未返回 task_id');

      const resultUrl = await chargeSuccessfulResult(
        () => new Promise<string>((resolve, reject) => {
          startVideoPoll(`studio-video:${lastTaskId}`, {
            taskId: lastTaskId,
            title: `自由创作 · ${getModelDisplayName(normalizedModel)}`,
            kind: getStudioVideoTaskKind(normalizedModel),
            targetPage: 'canvas',
            targetEntityType: 'episode',
            targetEntityId: episodeId,
            episodeId,
            projectId,
            callbacks: {
              onComplete: ({ status }) => {
                const url = extractVideoResult(status);
                if (!url) {
                  reject(new Error('视频任务已完成，但后端未返回视频地址'));
                  return;
                }
                resolve(url);
              },
              onFail: error => reject(new Error(error)),
            },
          });
        }),
        () => consumeCredits({
          featureKey: 'video_generation',
          taskId: lastTaskId,
          params: { ...creditParams, video_count: 1 },
          projectId,
          metadata: { episode_id: episodeId, source_page: 'canvas' },
        }),
      );
      urls.push(resultUrl);
    }

    return { uri: urls[0], uris: urls, taskId: lastTaskId };
  };

  const generateAudio = async (
    text: string,
    options: { nodeId?: string; voiceId?: string; emotion?: string } = {},
  ): Promise<string> => {
    const taskId = makeTaskId('audio');
    const audioModel = normalizeStudioAudioModel(STUDIO_AUDIO_MODEL_SPEECH_HD);
    const creditParams = {
      character_count: text.length,
      model: audioModel,
    };
    await assertEnoughCredits('audio_generation_tts', creditParams);
    studioTaskRegistration(taskId, 'minimax-tts', '自由创作语音合成', projectId, episodeId);
    try {
      const url = await chargeSuccessfulResult(
        async () => {
          const result = await minimaxTTSSync({
            text,
            voice_id: options.voiceId || DEFAULT_VOICE_ID,
            model: audioModel,
            model_scope: STUDIO_MODEL_SCOPE,
            emotion: options.emotion,
            entity_type: 'episode',
            entity_id: episodeId,
            file_role: 'studio_audio',
            project_id: projectId,
            episode_id: episodeId,
          });
          const generatedUrl = result.file_url || result.audio_url;
          if (!generatedUrl) throw new Error('语音生成接口未返回音频地址');
          return generatedUrl;
        },
        () => consumeCredits({
          featureKey: 'audio_generation_tts',
          taskId,
          params: creditParams,
          projectId,
          metadata: { episode_id: episodeId, source_page: 'canvas' },
        }),
      );
      taskRegistry.complete(taskId, { resultUrls: [url] });
      return url;
    } catch (error) {
      taskRegistry.fail(taskId, normalizeError(error));
      throw error;
    }
  };

  const sendChatMessage = async (
    history: Array<{ role: string; parts: Array<{ text: string }> }>,
    message: string,
    options: StudioChatOptions = {},
  ): Promise<string> => {
    const conversation = history
      .slice(-12)
      .map(item => `${item.role === 'user' ? '用户' : '助手'}：${item.parts.map(part => part.text).join('')}`)
      .join('\n');
    const mode = options.isStoryboard
      ? '你是影视分镜顾问，给出清晰、可执行的镜头建议。'
      : options.isHelpMeWrite
        ? '你是影视创意写作助手，帮助扩写并保留用户意图。'
        : '你是创剧自由创作助手。请用简单、明确的语言回答，并给出可以直接用于视频创作的下一步。';
    return runText(`${conversation}\n用户：${message}`.trim(), mode, '自由创作 AI 助手');
  };

  const planStoryboard = async (prompt: string, context: string): Promise<string[]> => {
    const result = await runText(
      `创作需求：${prompt}\n补充上下文：${context}\n请只返回 JSON 字符串数组，每个元素是一条独立镜头提示词。`,
      '你是影视分镜规划师。将需求拆成 3-8 个连续镜头，确保人物、场景与动作一致。',
      '自由创作分镜规划',
    );
    return parseJsonArray(result);
  };

  const orchestrateVideoPrompt = async (images: string[], prompt: string): Promise<string> => (
    runText(
      `已有 ${images.length} 张按顺序排列的参考图。用户视频要求：${prompt}`,
      '你是视频提示词导演。输出一段连续、具体的中文视频生成提示词，描述镜头运动、主体动作和首尾衔接。',
      '自由创作视频提示词编排',
    )
  );

  const compileMultiFramePrompt = (frames: SmartSequenceItem[]): string => frames
    .map((frame, index) => (
      `镜头 ${index + 1}${index < frames.length - 1
        ? `，向下一镜头过渡 ${frame.transition.duration} 秒：${frame.transition.prompt || '自然连续过渡'}`
        : '，作为结尾画面'}`
    ))
    .join('；');

  return {
    projectId,
    episodeId,
    returnTo,
    loadSnapshot,
    saveSnapshot,
    uploadAsset,
    uploadDataUrl,
    getCreditBalance,
    estimateCredits,
    sendChatMessage,
    generateImage,
    generateVideo,
    generateAudio,
    planStoryboard,
    orchestrateVideoPrompt,
    editImage: async (image, prompt, model, nodeId) => {
      const [url] = await generateImage(prompt, model, [image], { count: 1, nodeId });
      return url;
    },
    compileMultiFramePrompt,
  };
}
