/** Creator-facing model names. Stable operation keys remain unchanged. */

export const aiModelNames = {
  'deepseek': 'DeepSeek V4 Pro',
  'gemini': 'Gemini 2.5 Flash'
};

export const imageModelNames = {
  'gemini-2.5-flash-image': 'Gemini 2.5 Flash Image',
  'gemini-3.1-flash-image-preview': 'Gemini 3.1 Flash Image Preview',
  'gemini-3-pro-image-preview': 'Gemini 3.1 Flash Image Preview',
  'gemini-3.0-pro-image': 'Gemini 3.0 Pro Image',
  'nanobanana': 'Gemini 3.1 Flash Image Preview',
  'doubao': 'Doubao-Seedream-5.0-lite'
};


export const generationModelNames = {
  'qwen': 'Qwen Image Edit 2509',
  'qwenN': 'Qwen Image Edit 2509',
  'qwen_lora': 'Qwen Image Edit 2509 + Lightning LoRA',
  'qwenN_lora': 'Qwen Image Edit 2509 + Lightning LoRA',
  'kontext': 'Kontext v2',
  'nanobanana': 'Gemini 3.1 Flash Image Preview',
  'doubao': 'Doubao-Seedream-5.0-lite',
  'gpt_image_vip': 'GPT Image 2 VIP',
  'gpt_image_official': 'GPT Image 2'
};

export const videoModelNames = {
  'wan2': 'Wan 2.6',
  'sora2': 'Sora Video 2',
  'veo': 'Veo 3.1',
  'mini': 'MiniMax Hailuo 2.3',
  'kling': 'Kling V3',
  'vidu': 'Vidu Q3',
  'happyhorse': 'HappyHorse 1.0'
};


export const getModelDisplayName = (
  modelKey: string,
  category: 'ai' | 'image' | 'generation' | 'video'
): string => {
  switch (category) {
    case 'ai':
      return aiModelNames[modelKey as keyof typeof aiModelNames] || modelKey;
    case 'image':
      return imageModelNames[modelKey as keyof typeof imageModelNames] || modelKey;
    case 'generation':
      return generationModelNames[modelKey as keyof typeof generationModelNames] || modelKey;
    case 'video':
      return videoModelNames[modelKey as keyof typeof videoModelNames] || modelKey;
    default:
      return modelKey;
  }
};

