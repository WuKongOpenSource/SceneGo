# 提示词配置系统

## 📝 概述

这是一个集中化的AI提示词管理系统，将提示词和代码逻辑分离，提高可维护性和可扩展性。

## 🎯 设计理念

### 问题背景
之前的实现中，每个AI功能都要写一个独立的函数，提示词硬编码在函数内部：

```typescript
// ❌ 旧方式：提示词硬编码
export const rewriteNovelToScript = async (text: string) => {
  const prompt = `你是一位专业的编剧...请将以下文本改写为剧本...`;  // 硬编码
  return await callAI(prompt);
};
```

**缺点**：
- ❌ 修改提示词需要改代码
- ❌ 提示词分散在各个文件中，难以统一管理
- ❌ 添加新功能要写新函数
- ❌ 无法轻松复用和组合提示词

### 新架构
现在提示词统一在 `prompts/` 目录管理，代码只负责调用：

```typescript
// ✅ 新方式：提示词配置化
import { REWRITE_NOVEL_TO_SCRIPT } from './prompts';
import { callAI } from './services/aiService';

export const aiRewriteNovelToScript = async (model, novelText) => {
  return await callAI(model, REWRITE_NOVEL_TO_SCRIPT, { novelText });
};
```

**优点**：
- ✅ 提示词集中管理，易于修改
- ✅ 代码简洁，职责单一
- ✅ 复用性强，可组合
- ✅ 支持自定义覆盖

---

## 📂 文件结构

```
prompts/
├── scriptPrompts.ts        # 剧本相关提示词
│   ├── REWRITE_NOVEL_TO_SCRIPT      # 改写小说为剧本
│   ├── EXTRACT_SCRIPT_METADATA      # 提取元数据（角色、场景）
│   ├── REFINE_SCRIPT_SEGMENT        # 润色剧本片段
│   ├── RESTRUCTURE_SHOT             # 重构分镜（拆分/合并）
│   └── REGENERATE_SINGLE_SHOT       # 重新生成单个分镜
│
├── storyboardPrompts.ts    # 分镜相关提示词
│   ├── EXTRACT_SHOTS_FROM_SCRIPT    # 从剧本提取分镜
│   ├── GENERATE_SHOT_DETAILS        # 生成分镜详细信息
│   └── GENERATE_STORYBOARDS         # 生成完整分镜（旧版）
│
├── imagePrompts.ts         # 图像生成辅助提示词
│   ├── IMAGE_QUALITY_SUFFIX         # 质量增强后缀
│   ├── NEGATIVE_PROMPTS             # 负面提示词
│   ├── SCENE_TEMPLATES              # 场景模板
│   ├── CAMERA_SHOTS                 # 镜头类型
│   ├── LIGHTING_TYPES               # 光照类型
│   └── MOOD_ATMOSPHERE              # 情绪/氛围
│
├── index.ts                # 统一导出 + 工具函数
│   ├── fillPrompt()                 # 替换占位符
│   ├── combinePrompts()             # 组合提示词
│   └── addSuffix()                  # 添加后缀
│
└── README.md               # 本文档
```

---

## 🔧 使用方法

### 1. 基础用法

```typescript
import { callAI } from './services/aiService';
import { REWRITE_NOVEL_TO_SCRIPT } from './prompts';
import { AiModel } from './types';

// 使用默认提示词
const result = await callAI(
  AiModel.Gemini,
  REWRITE_NOVEL_TO_SCRIPT,
  { novelText: '这里是小说内容...' }
);
```

### 2. 修改提示词

**方式1: 直接修改配置文件**（推荐）

```typescript
// prompts/scriptPrompts.ts
export const REWRITE_NOVEL_TO_SCRIPT: PromptTemplate = {
  system: `你是一位专业的编剧...`,  // 修改这里
  user: `请将以下小说改写为剧本...`  // 修改这里
};
```

**方式2: 运行时覆盖**

```typescript
import { callAI } from './services/aiService';

// 自定义提示词
const customPrompt: PromptTemplate = {
  system: '你是一位擅长动作片的编剧',
  user: '请将以下小说改写为动作片剧本：\n{novelText}'
};

const result = await callAI(
  AiModel.Gemini,
  customPrompt,  // 使用自定义提示词
  { novelText: '...' }
);
```

### 3. 添加新的AI功能

**步骤1: 在 `prompts/` 添加提示词**

```typescript
// prompts/scriptPrompts.ts
export const TRANSLATE_SCRIPT: PromptTemplate = {
  system: `你是专业翻译，擅长剧本翻译`,
  user: `请将以下剧本翻译为{targetLang}：\n{scriptText}`
};
```

**步骤2: 在 `services/aiModelService.ts` 添加业务函数**

```typescript
export const aiTranslateScript = async (
  model: AiModel,
  scriptText: string,
  targetLang: string
): Promise<string> => {
  return await callAI(
    model,
    PROMPTS.TRANSLATE_SCRIPT,
    { scriptText, targetLang }
  );
};
```

**完成！** 无需修改底层调用逻辑。

---

## 🛠️ 工具函数

### `fillPrompt` - 替换占位符

```typescript
import { fillPrompt } from './prompts';

const template = '你好，{name}！今天是{date}。';
const result = fillPrompt(template, {
  name: '张三',
  date: '2025-01-01'
});
// 结果: "你好，张三！今天是2025-01-01。"
```

### `combinePrompts` - 组合提示词

```typescript
import { combinePrompts } from './prompts';

const parts = [
  '这是第一段',
  '这是第二段',
  '这是第三段'
];

const combined = combinePrompts(parts, '\n\n');
// 结果: "这是第一段\n\n这是第二段\n\n这是第三段"
```

### `addSuffix` - 添加后缀

```typescript
import { addSuffix, IMAGE_QUALITY_SUFFIX } from './prompts';

const base = '一个美丽的女孩';
const enhanced = addSuffix(base, IMAGE_QUALITY_SUFFIX.anime);
// 结果: "一个美丽的女孩, anime style, vibrant colors, clean lines, cel shading"
```

---

## 📋 提示词模板规范

### 占位符命名

使用 `{变量名}` 格式，建议使用驼峰命名：

```typescript
{novelText}      // ✅ 好的命名
{scriptContent}  // ✅ 好的命名
{text}           // ⚠️ 太简短
{some_text}      // ❌ 不推荐（下划线）
```

### 结构化提示词

```typescript
export const MY_PROMPT: PromptTemplate = {
  // 系统提示词：定义AI的角色和能力
  system: `你是一位专业的{profession}。
你的专长是{expertise}。
你的输出风格是{style}。`,

  // 用户提示词：具体的任务描述
  user: `**任务：**
{task_description}

**输入：**
{input_data}

**要求：**
1. {requirement_1}
2. {requirement_2}

**输出格式：**
{output_format}

请开始：`
};
```

---

## 🎨 图像生成辅助

### 使用预设风格

```typescript
import { IMAGE_QUALITY_SUFFIX, LIGHTING_TYPES } from './prompts';
import { addSuffix, combinePrompts } from './prompts';

const basePrompt = '一个赛博朋克城市';
const enhanced = combinePrompts([
  basePrompt,
  LIGHTING_TYPES.neon,
  IMAGE_QUALITY_SUFFIX.highQuality
], ', ');

// 结果: "一个赛博朋克城市, neon lighting, vibrant colors, cyberpunk aesthetic, masterpiece, best quality..."
```

### 使用场景模板

```typescript
import { SCENE_TEMPLATES, fillPrompt } from './prompts';

const prompt = fillPrompt(
  SCENE_TEMPLATES.battle,
  { description: '两位武士决斗' }
);
// 结果: "两位武士决斗, dynamic action, intense atmosphere, dramatic lighting"
```

---

## 🔄 迁移指南

### 从旧代码迁移

**旧方式：**
```typescript
// deepseekService.ts
export const rewriteNovelToScript = async (text: string) => {
  const prompt = `你是一位专业的编剧...\n\n小说内容：\n${text}`;
  return await callDeepseek(prompt, 'text');
};
```

**新方式：**
```typescript
// 1. 在 prompts/scriptPrompts.ts 添加提示词
export const REWRITE_NOVEL_TO_SCRIPT: PromptTemplate = {
  system: `你是一位专业的编剧...`,
  user: `小说内容：\n{novelText}`
};

// 2. 在 services/aiModelService.ts 使用
export const aiRewriteNovelToScript = async (model, novelText) => {
  return await callAI(model, REWRITE_NOVEL_TO_SCRIPT, { novelText });
};
```

---

## ✅ 最佳实践

### 1. 提示词版本控制

在提示词文件中记录修改历史：

```typescript
/**
 * REWRITE_NOVEL_TO_SCRIPT
 * 
 * 版本历史：
 * - v1.0 (2025-01-01): 初始版本
 * - v1.1 (2025-01-05): 增加动画制作要求
 * - v1.2 (2025-01-10): 优化输出格式
 */
export const REWRITE_NOVEL_TO_SCRIPT: PromptTemplate = {...};
```

### 2. 提示词测试

创建测试文件验证提示词效果：

```typescript
// prompts/__tests__/scriptPrompts.test.ts
import { fillPrompt, REWRITE_NOVEL_TO_SCRIPT } from '../index';

test('REWRITE_NOVEL_TO_SCRIPT 占位符替换', () => {
  const result = fillPrompt(REWRITE_NOVEL_TO_SCRIPT.user, {
    novelText: '测试内容'
  });
  expect(result).toContain('测试内容');
});
```

### 3. 提示词复用

将通用的提示词片段抽取为常量：

```typescript
// prompts/common.ts
export const COMMON_REQUIREMENTS = `
1. 输出内容必须为中文
2. 保持专业性和准确性
3. 避免重复和冗余
`;

// prompts/scriptPrompts.ts
import { COMMON_REQUIREMENTS } from './common';

export const MY_PROMPT: PromptTemplate = {
  user: `{task}\n\n通用要求：${COMMON_REQUIREMENTS}`
};
```

---

## 🚀 高级用法

### 动态组合提示词

```typescript
import { combinePrompts, fillPrompt } from './prompts';

function buildCustomPrompt(
  baseTemplate: string,
  options: {
    style?: string;
    constraints?: string[];
    examples?: string[];
  }
): string {
  const parts = [baseTemplate];
  
  if (options.style) {
    parts.push(`风格要求：${options.style}`);
  }
  
  if (options.constraints) {
    parts.push(`约束条件：\n${options.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);
  }
  
  if (options.examples) {
    parts.push(`示例：\n${options.examples.join('\n\n')}`);
  }
  
  return combinePrompts(parts);
}
```

### 批量任务

```typescript
import { batchCallAI } from './services/aiService';
import { GENERATE_SHOT_DETAILS } from './prompts';

// 批量生成10个分镜的详细信息
const tasks = shots.map(shot => ({
  promptTemplate: GENERATE_SHOT_DETAILS,
  variables: {
    originalText: shot.originalText,
    scriptSegment: shot.scriptSegment,
    userRequirements: ''
  }
}));

const results = await batchCallAI(AiModel.Gemini, tasks, 3);  // 并发度=3
```

---

## 📌 注意事项

1. **占位符必须存在**：确保 `variables` 对象包含所有占位符，否则会保留 `{变量名}` 原样
2. **JSON格式提示词**：确保提示词要求AI返回有效的JSON
3. **提示词长度**：注意AI模型的token限制，避免提示词过长
4. **系统提示词可选**：如果不需要定义角色，可以省略 `system` 字段

---

## 🎉 总结

新的提示词配置系统带来以下好处：

✅ **可维护性**：提示词集中管理，修改方便  
✅ **可扩展性**：添加新功能只需添加提示词  
✅ **可复用性**：提示词可组合和复用  
✅ **可配置性**：支持运行时覆盖  
✅ **代码简洁**：业务逻辑更清晰  

现在，添加新的AI功能变得非常简单：
1. 在 `prompts/` 添加提示词
2. 在 `services/` 调用通用AI服务
3. 完成！

