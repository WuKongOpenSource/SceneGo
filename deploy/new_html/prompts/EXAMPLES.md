# 提示词配置系统 - 使用示例

## 📚 目录

1. [基础用法](#基础用法)
2. [自定义提示词](#自定义提示词)
3. [添加新功能](#添加新功能)
4. [图像增强](#图像增强)
5. [批量处理](#批量处理)
6. [实际案例](#实际案例)

---

## 基础用法

### 示例1: 改写小说为剧本

```typescript
import { aiRewriteNovelToScript } from './services/aiModelService';
import { AiModel } from './types';

const novelText = `
天空阴沉，乌云密布。
孙悟空被压在五行山下，愤怒地挣扎着。
"该死！放我出去！"他咆哮道。
`;

// 使用Gemini模型
const script = await aiRewriteNovelToScript(
  AiModel.Gemini,
  novelText
);

console.log(script);
// 输出剧本格式的内容
```

### 示例2: 提取分镜

```typescript
import { aiExtractShotsFromScript } from './services/aiModelService';
import { AiModel } from './types';

const scriptText = `
【场景：五行山下，石壁前】
（孙悟空被压在五行山下，只露出头部。画面阴沉，雷声隆隆）
孙悟空（愤怒地）："该死！放我出去！"
`;

// 提取分镜
const result = await aiExtractShotsFromScript(
  AiModel.Deepseek,
  scriptText
);

console.log(result.items);
// [
//   {
//     "originalText": "...",
//     "scriptSegment": "五行山下，孙悟空被压..."
//   }
// ]
```

### 示例3: 生成分镜详情

```typescript
import { aiGenerateShotDetails } from './services/aiModelService';
import { AiModel } from './types';

const details = await aiGenerateShotDetails(
  AiModel.Gemini,
  '【场景：五行山下】孙悟空被压...',  // originalText
  '五行山下，孙悟空被巨大石山压住',    // scriptSegment
  '暗黑史诗风格，强烈光影对比'         // userRequirements (可选)
);

console.log(details);
// {
//   "imagePrompt": "五行山脚下，巨大岩石压着孙悟空...",
//   "videoPrompt": "镜头从远景推进至特写...",
//   "dialogue": "孙悟空（愤怒地）：\"该死！放我出去！\"",
//   "characters": ["孙悟空"],
//   "scene": "五行山下，石壁前"
// }
```

---

## 自定义提示词

### 示例4: 覆盖默认提示词

```typescript
import { callAI } from './services/aiService';
import { AiModel, PromptTemplate } from './types';

// 自定义提示词模板
const customPrompt: PromptTemplate = {
  system: `你是一位擅长武侠小说的编剧，风格偏向古龙。`,
  user: `请将以下现代小说改编为武侠风格剧本：\n{novelText}`
};

// 使用自定义提示词
const result = await callAI(
  AiModel.Gemini,
  customPrompt,
  { novelText: '...' }
);
```

### 示例5: 动态调整提示词

```typescript
import { fillPrompt, REWRITE_NOVEL_TO_SCRIPT } from './prompts';

// 基于用户选择的风格调整提示词
function getCustomizedPrompt(style: 'anime' | 'realistic' | 'watercolor') {
  const styleDesc = {
    anime: '动画风格，夸张表情，鲜艳色彩',
    realistic: '写实风格，真实光影，细腻情感',
    watercolor: '水彩风格，柔和线条，梦幻氛围'
  };

  return {
    ...REWRITE_NOVEL_TO_SCRIPT,
    system: REWRITE_NOVEL_TO_SCRIPT.system + `\n输出风格：${styleDesc[style]}`
  };
}

// 使用
const prompt = getCustomizedPrompt('anime');
const result = await callAI(AiModel.Gemini, prompt, { novelText: '...' });
```

---

## 添加新功能

### 示例6: 添加剧本摘要功能

**步骤1: 在 `prompts/scriptPrompts.ts` 添加提示词**

```typescript
export const SUMMARIZE_SCRIPT: PromptTemplate = {
  system: `你是一位专业的内容编辑，擅长提炼核心内容。`,
  user: `请为以下剧本生成一个简洁的摘要（不超过{maxWords}字）：

{scriptContent}

摘要应包含：
1. 主要情节
2. 核心冲突
3. 关键角色

请直接输出摘要，不要添加额外说明。`
};
```

**步骤2: 在 `prompts/index.ts` 导出**

```typescript
export { SUMMARIZE_SCRIPT } from './scriptPrompts';
```

**步骤3: 在 `services/aiModelService.ts` 添加业务函数**

```typescript
export const aiSummarizeScript = async (
  model: AiModel,
  scriptContent: string,
  maxWords: number = 200
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.SUMMARIZE_SCRIPT,
    { scriptContent, maxWords: maxWords.toString() }
  );
};
```

**步骤4: 使用**

```typescript
const summary = await aiSummarizeScript(
  AiModel.Gemini,
  '【场景1】...\n【场景2】...',
  150  // 最多150字
);
console.log(summary);
```

---

## 图像增强

### 示例7: 使用质量增强后缀

```typescript
import { addSuffix, IMAGE_QUALITY_SUFFIX } from './prompts';

const basePrompt = '一个美丽的精灵公主';

// 添加动画风格
const animePrompt = addSuffix(basePrompt, IMAGE_QUALITY_SUFFIX.anime);
// "一个美丽的精灵公主, anime style, vibrant colors, clean lines, cel shading"

// 添加写实风格
const realisticPrompt = addSuffix(basePrompt, IMAGE_QUALITY_SUFFIX.realistic);
// "一个美丽的精灵公主, photorealistic, cinematic lighting, depth of field, ray tracing"
```

### 示例8: 组合多个图像增强

```typescript
import { combinePrompts, IMAGE_QUALITY_SUFFIX, LIGHTING_TYPES, MOOD_ATMOSPHERE } from './prompts';

const basePrompt = '一个赛博朋克城市的夜景';

const enhancedPrompt = combinePrompts([
  basePrompt,
  LIGHTING_TYPES.neon,
  MOOD_ATMOSPHERE.mysterious,
  IMAGE_QUALITY_SUFFIX.highQuality
], ', ');

console.log(enhancedPrompt);
// "一个赛博朋克城市的夜景, neon lighting, vibrant colors, cyberpunk aesthetic, mysterious atmosphere, fog, enigmatic mood, masterpiece, best quality, highly detailed, 8k, professional"
```

### 示例9: 使用场景模板

```typescript
import { fillPrompt, SCENE_TEMPLATES } from './prompts';

// 战斗场景
const battlePrompt = fillPrompt(
  SCENE_TEMPLATES.battle,
  { description: '两位武士在雨中决斗' }
);
// "两位武士在雨中决斗, dynamic action, intense atmosphere, dramatic lighting"

// 情感场景
const emotionalPrompt = fillPrompt(
  SCENE_TEMPLATES.emotional,
  { description: '母亲与女儿久别重逢' }
);
// "母亲与女儿久别重逢, emotional moment, intimate atmosphere, soft lighting"
```

---

## 批量处理

### 示例10: 批量生成分镜详情

```typescript
import { batchCallAI } from './services/aiService';
import { GENERATE_SHOT_DETAILS, AiModel } from './prompts';

// 假设有10个分镜
const shots = [
  { originalText: '...', scriptSegment: '...' },
  { originalText: '...', scriptSegment: '...' },
  // ... 更多分镜
];

// 构建批量任务
const tasks = shots.map(shot => ({
  promptTemplate: GENERATE_SHOT_DETAILS,
  variables: {
    originalText: shot.originalText,
    scriptSegment: shot.scriptSegment,
    userRequirements: '史诗动画风格'
  }
}));

// 并发执行（并发度=3，避免API限流）
const results = await batchCallAI(
  AiModel.Gemini,
  tasks,
  3  // 同时处理3个
);

console.log(results);
// [
//   { imagePrompt: '...', videoPrompt: '...', ... },
//   { imagePrompt: '...', videoPrompt: '...', ... },
//   ...
// ]
```

---

## 实际案例

### 案例1: 完整的剧本分镜工作流

```typescript
import { 
  aiRewriteNovelToScript,
  aiExtractShotsFromScript,
  aiGenerateShotDetails
} from './services/aiModelService';
import { AiModel } from './types';

async function processNovelToStoryboard(novelText: string) {
  console.log('步骤1: 改写小说为剧本...');
  const script = await aiRewriteNovelToScript(
    AiModel.Gemini,
    novelText
  );
  
  console.log('步骤2: 提取分镜...');
  const { items } = await aiExtractShotsFromScript(
    AiModel.Gemini,
    script
  );
  
  console.log('步骤3: 为每个分镜生成详细信息...');
  const detailedShots = [];
  for (const shot of items) {
    const details = await aiGenerateShotDetails(
      AiModel.Gemini,
      shot.originalText,
      shot.scriptSegment,
      '暗黑史诗风格，强烈光影对比'
    );
    
    detailedShots.push({
      ...shot,
      ...details
    });
    
    // 避免API限流
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('完成！生成了', detailedShots.length, '个分镜');
  return detailedShots;
}

// 使用
const novel = `
天空阴沉，乌云密布。
孙悟空被压在五行山下，愤怒地挣扎着。
"该死！放我出去！"他咆哮道。
`;

const storyboard = await processNovelToStoryboard(novel);
```

### 案例2: 用户自定义风格系统

```typescript
import { callAI } from './services/aiService';
import { GENERATE_SHOT_DETAILS } from './prompts';
import { AiModel, PromptTemplate } from './types';

// 用户配置
interface UserStyleConfig {
  visualStyle: string;      // 视觉风格
  cameraPreference: string; // 镜头偏好
  colorTone: string;        // 色调
  mood: string;             // 情绪
}

function createStyledPrompt(
  basePrompt: PromptTemplate,
  userStyle: UserStyleConfig
): PromptTemplate {
  return {
    system: basePrompt.system,
    user: basePrompt.user + `

**用户风格偏好：**
- 视觉风格：${userStyle.visualStyle}
- 镜头偏好：${userStyle.cameraPreference}
- 色调：${userStyle.colorTone}
- 情绪：${userStyle.mood}

请在生成imagePrompt和videoPrompt时融入这些风格要求。`
  };
}

// 使用
const userConfig: UserStyleConfig = {
  visualStyle: '宫崎骏动画风格',
  cameraPreference: '多用广角和仰拍',
  colorTone: '温暖柔和的色调',
  mood: '治愈温馨'
};

const styledPrompt = createStyledPrompt(
  GENERATE_SHOT_DETAILS,
  userConfig
);

const result = await callAI(
  AiModel.Gemini,
  styledPrompt,
  {
    originalText: '...',
    scriptSegment: '...',
    userRequirements: ''
  }
);
```

### 案例3: A/B测试不同提示词

```typescript
import { callAI } from './services/aiService';
import { AiModel, PromptTemplate } from './types';

const variantA: PromptTemplate = {
  system: '你是专业编剧',
  user: '请改写：{text}'
};

const variantB: PromptTemplate = {
  system: '你是资深动画编剧，擅长戏剧冲突设计',
  user: '请将以下内容改写为充满戏剧张力的动画剧本：{text}'
};

async function abTest(text: string) {
  const [resultA, resultB] = await Promise.all([
    callAI(AiModel.Gemini, variantA, { text }),
    callAI(AiModel.Gemini, variantB, { text })
  ]);
  
  return {
    variant_a: resultA,
    variant_b: resultB
  };
}

// 对比结果，选择更好的提示词
const results = await abTest('孙悟空被压在五行山下...');
console.log('方案A:', results.variant_a);
console.log('方案B:', results.variant_b);
```

---

## 🎓 学习路径

1. **初学者**：从基础用法开始，熟悉默认提示词
2. **进阶**：尝试自定义提示词，添加新功能
3. **高级**：使用工具函数组合提示词，批量处理
4. **专家**：设计通用的提示词系统，支持多语言/多风格

---

## 💡 技巧总结

1. **提示词要具体**：详细描述需求，避免模糊表达
2. **提供示例**：在提示词中给出期望的输出示例
3. **结构化输出**：对于JSON输出，明确指定字段和格式
4. **分步骤处理**：复杂任务拆分为多个简单提示词
5. **控制长度**：注意token限制，避免提示词过长
6. **测试迭代**：多次测试，逐步优化提示词

---

## 📞 获取帮助

- 查看 [README.md](./README.md) 了解完整文档
- 查看 `prompts/*.ts` 中的实际提示词示例
- 查看 `services/aiService.ts` 了解底层实现

祝你使用愉快！🚀

