



import { PromptTemplate } from './scriptPrompts';






export const EXTRACT_SHOTS_FROM_SCRIPT: PromptTemplate = {
  system: `你是专业的分镜师，擅长将动画剧本拆解为关键镜头。`,
  
  user: `请将以下动画剧本拆解为一系列关键镜头。

**要求：**
1. 按照镜头逻辑拆分（每个重要动作、对话转折、场景切换都是一个独立镜头）
2. originalText必须是从剧本中直接复制的原文段落
3. scriptSegment是你提炼的简洁场景动作描述（去除对话，只保留视觉信息）
4. 严格按照JSON格式输出

**JSON结构：**
{
  "items": [
    {
      "originalText": "从剧本中复制的原始段落",
      "scriptSegment": "精炼的场景和动作描述"
    }
  ]
}

**示例：**
剧本原文：
"""
【场景：五行山下，石壁前】
（孙悟空被压在五行山下，只露出头部。画面阴沉，雷声隆隆）
孙悟空（愤怒地）："该死！放我出去！"
"""

输出JSON：
{
  "items": [
    {
      "originalText": "【场景：五行山下，石壁前】\\n（孙悟空被压在五行山下，只露出头部。画面阴沉，雷声隆隆）\\n孙悟空（愤怒地）：\\"该死！放我出去！\\"",
      "scriptSegment": "五行山下，石壁前。孙悟空被巨大的石山压住，只露出头部，周围阴云密布，雷电交加，画面压抑沉重"
    }
  ]
}

剧本内容：
{scriptText}`
};






export const GENERATE_SHOT_DETAILS: PromptTemplate = {
  system: `你是专业的镜头设计师，擅长为动画分镜设计详细的视觉和运镜方案。`,
  
  user: `请为以下场景生成详细的镜头设计信息。

**场景信息：**
原文段落：
{originalText}

场景描述：
{scriptSegment}

{userRequirements}

**请返回JSON格式：**
{
  "imagePrompt": "中文图像生成提示词，描述画面构图、光影效果、角色状态、视觉风格",
  "videoPrompt": "中文视频提示词，描述镜头运动（推拉摇移跟）、画面节奏、转场方式",
  "dialogue": "人物台词（直接从原文提取）",
  "characters": ["角色1", "角色2"],
  "scene": "场景位置",
  "props": ["道具1", "道具2"]
}

道具定义：只填写人物使用或画面需要稳定展示的物品，例如手持物、武器、关键陈设；人物衣着、服装、妆容属于人物，不要放进 props。

**示例输出：**
{
  "imagePrompt": "五行山脚下，巨大的岩石压着孙悟空，只露出头部特写，乌云密布，闪电劈下，光影对比强烈，暗黑史诗风格，广角镜头",
  "videoPrompt": "镜头从远景缓慢推进至孙悟空面部特写，雷电闪烁时快速切换明暗，营造压抑愤怒的氛围，持续5秒",
  "dialogue": "孙悟空（愤怒地）：\\"该死！放我出去！\\"",
  "characters": ["孙悟空"],
  "scene": "五行山下，石壁前",
  "props": []
}

请生成：`
};




export const GENERATE_STORYBOARDS: PromptTemplate = {
  system: `你是一位专业的分镜师，擅长将剧本拆解为具体的分镜。每个分镜应包含：画面提示词、视频提示词、台词、角色、场景、道具。`,
  
  user: `请将以下剧本拆解为分镜：

{scriptContent}

返回JSON数组格式，每个分镜包含：
- imagePrompt: 画面描述（中文，详细描述构图、光线、氛围）
- videoPrompt: 动作描述（中文，描述运镜和动态）
- dialogue: 台词（中文）
- characters: 角色列表（数组）
- scene: 场景名称（中文）
- props: 道具列表（数组；服装衣着不要作为道具）

示例格式：
[
  {
    "imagePrompt": "年轻女子坐在窗边，柔和的晨光，忧郁氛围",
    "videoPrompt": "镜头缓慢推进，风轻轻吹动窗帘",
    "dialogue": "又是一个孤独的早晨...",
    "characters": ["李娜"],
    "scene": "卧室",
    "props": []
  }
]

请只返回JSON数组，不要添加任何其他文字。`
};

