









export const IMAGE_QUALITY_SUFFIX = {

  highQuality: ', masterpiece, best quality, highly detailed, 8k, professional',


  anime: ', anime style, vibrant colors, clean lines, cel shading',


  realistic: ', live-action photographic image, physically realistic materials and natural photographic lighting. When people are described, show a real human subject with natural skin texture, anatomically realistic face and proportions, real fabric and hair. No anime, manga, illustration, cel shading, CGI, 3D render, game character or doll-like face',


  watercolor: ', watercolor painting, soft edges, pastel colors, artistic',


  render3d: ', 3d render, octane render, unreal engine, volumetric lighting',
} as const;

export type ImageStylePresetId = keyof typeof IMAGE_QUALITY_SUFFIX;

const LEGACY_IMAGE_STYLE_MARKERS: Array<{ id: ImageStylePresetId; fragment: string }> = [
  ...Object.entries(IMAGE_QUALITY_SUFFIX).map(([id, fragment]) => ({
    id: id as ImageStylePresetId,
    fragment,
  })),

  { id: 'realistic', fragment: ', photorealistic, cinematic lighting, depth of field, ray tracing' },
  { id: 'realistic', fragment: ', photorealistic live-action photography, cinematic lighting, depth of field, ray tracing, realistic skin texture, natural facial anatomy and body proportions, real-world materials, strictly non-illustrated, exclude anime, manga, cartoon, cel shading, CGI, 3D render, game art, and doll-like appearance; if reference images are provided, use them only for identity, clothing, and structure, never inherit an illustrated rendering style' },

  { id: 'anime', fragment: 'Style: Anime/Manga style, high detail, character sheet or environment concept art.' },
  { id: 'anime', fragment: 'Style: High quality Anime/Manga screenshot, detailed background, cinematic lighting.' },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanStylePrompt(value: string): string {
  return value
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/,\s*,+/g, ', ')
    .replace(/(?:,|，)\s*$/g, '')
    .trim();
}

function stripRealisticStyleConflicts(prompt: string): string {
  return cleanStylePrompt(prompt
    .replace(/\b(?:anime|manga|cartoon)\s+(?:art\s+)?style\b/gi, '')
    .replace(/\bcel[-\s]?shad(?:ed|ing)\b/gi, '')
    .replace(/(?:二次元|动漫|漫画|卡通)(?:画面|绘画|插画)?风格/g, ''));
}






export function stripImageStylePresets(prompt: string): string {
  let result = String(prompt || '').replace(/\n?\[IMAGE_STYLE\][\s\S]*?\[\/IMAGE_STYLE\]/gi, '');
  for (const { fragment } of LEGACY_IMAGE_STYLE_MARKERS) {
    result = result.replace(new RegExp(escapeRegExp(fragment), 'gi'), '');
  }
  return cleanStylePrompt(result);
}


export function detectImageStylePreset(prompt: string): ImageStylePresetId | '' {
  const source = String(prompt || '').toLocaleLowerCase();
  let detected: ImageStylePresetId | '' = '';
  let detectedAt = -1;
  for (const { id, fragment } of LEGACY_IMAGE_STYLE_MARKERS) {
    const index = source.lastIndexOf(fragment.toLocaleLowerCase());
    if (index > detectedAt) {
      detected = id;
      detectedAt = index;
    }
  }
  const marker = source.match(/\[image_style\]([\s\S]*?)\[\/image_style\]/i)?.[1] || '';
  for (const id of Object.keys(IMAGE_QUALITY_SUFFIX) as ImageStylePresetId[]) {
    if (marker.includes(`preset=${id}`)) return id;
  }
  return detected;
}




export function applyImageStylePreset(prompt: string, styleId?: string | null): string {
  const stripped = stripImageStylePresets(prompt);
  const base = styleId === 'realistic' ? stripRealisticStyleConflicts(stripped) : stripped;
  const suffix = styleId && styleId in IMAGE_QUALITY_SUFFIX
    ? IMAGE_QUALITY_SUFFIX[styleId as ImageStylePresetId]
    : '';
  if (!suffix || !styleId) return base;
  const realistic = styleId === 'realistic'
    ? '当前选择为真人摄影写实。将描述及参考图中的人物表现为真实演员，保留身份、年龄、发型、服饰、纹样、配饰及颜色；参考图只提供人物和服装信息，不继承动漫或插画画风。衣料上的水墨、水彩或图案只作为服饰纹样，不改变整张图的真人摄影风格。所有视图包括半身特写均使用同一真人摄影风格。'
    : '';
  return [base, `[IMAGE_STYLE]preset=${styleId}。当前选定的表现风格优先于描述中的旧画风词。${realistic}${suffix.replace(/^,\s*/, '')}[/IMAGE_STYLE]`]
    .filter(Boolean)
    .join('\n');
}

export function imageRefinementConstraints(style: string, assetType: string, turnaround: boolean): string {
  const noPeople = assetType === 'scene'
    ? '这是场景素材，只描述环境；除非用户明确要求，否则不要添加人物、人体、脸或人群。'
    : assetType === 'prop'
      ? '这是道具素材，只描述物体；除非用户明确要求，否则不要添加人物、手、人体或脸。'
      : '';
  return [
    '用户明确给出的年龄、身份、性别、脸部特征、发型、服饰、纹样、颜色及配饰是硬约束，不得改写或遗漏；剧情、朝代、职业和严肃表情只作背景，不得据此增龄或擅自添加胡须、皱纹等特征。不要添加用户未要求的画风。',
    applyImageStylePreset('', style),
    turnaround && (assetType === 'character' || assetType === 'prop')
      ? '这是白底四视图素材：所有视图（包括放大的正面半身肖像）使用同一片无缝纯白背景。只描述主体，使用均匀中性棚拍光；不添加烛火、彩色轮廓光、场景、背景景深、灰蓝色肖像底板、渐变或边框。'
      : '',
    noPeople,
  ].filter(Boolean).join('\n');
}

export function validateRefinedImageAge(original: string, refined: string): void {
  const ages = (text: string) => [...String(text || '').matchAll(/(\d{1,3})(?:\s*(?:周)?岁|\s*[- ]?years?[- ]old)/gi)]
    .map(match => match[1]);
  const expected = ages(original);
  const actual = ages(refined);
  if (expected.length && (expected.some(age => !actual.includes(age)) || actual.some(age => !expected.includes(age)))) {
    throw new Error('润色未保留原定年龄，已保留原提示词，本次不扣创作点数，请重试');
  }
}




export const NEGATIVE_PROMPTS = {

  common: 'low quality, blurry, distorted, ugly, bad anatomy, bad proportions',


  anime: 'low quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',


  character: 'bad anatomy, bad hands, missing fingers, extra fingers, mutated hands, poorly drawn hands, poorly drawn face, mutation, deformed',
};




export const SCENE_TEMPLATES: Record<string, string> = {

  indoor: '{description}, indoor scene, interior lighting, comfortable atmosphere',


  outdoor: '{description}, outdoor scene, natural lighting, open space',


  city: '{description}, urban environment, city street, modern architecture',


  nature: '{description}, natural landscape, serene environment, beautiful scenery',


  battle: '{description}, dynamic action, intense atmosphere, dramatic lighting',


  emotional: '{description}, emotional moment, intimate atmosphere, soft lighting',
};




export const CAMERA_SHOTS: Record<string, string> = {

  closeup: 'extreme close-up shot, detailed view, shallow depth of field',


  medium: 'medium shot, waist-up view, balanced composition',


  full: 'full shot, entire subject visible, environmental context',


  wide: 'wide shot, establishing shot, panoramic view',


  lowAngle: 'low angle shot, looking up, powerful perspective',


  highAngle: 'high angle shot, looking down, bird\'s eye view',


  pov: 'POV shot, first person perspective, subjective view',
};




export const LIGHTING_TYPES: Record<string, string> = {

  natural: 'natural lighting, soft shadows, realistic illumination',


  dramatic: 'dramatic lighting, strong contrast, chiaroscuro',


  soft: 'soft lighting, diffused light, gentle shadows',


  neon: 'neon lighting, vibrant colors, cyberpunk aesthetic',


  golden: 'golden hour lighting, warm tones, magical atmosphere',


  night: 'night scene, moonlight, dark atmosphere, artificial lights',
};




export const MOOD_ATMOSPHERE: Record<string, string> = {

  happy: 'joyful atmosphere, bright colors, cheerful mood',


  sad: 'melancholic atmosphere, muted colors, somber mood',


  tense: 'tense atmosphere, dark colors, suspenseful mood',


  romantic: 'romantic atmosphere, soft colors, dreamy mood',


  epic: 'epic atmosphere, grand scale, heroic mood',


  mysterious: 'mysterious atmosphere, fog, enigmatic mood',
};
