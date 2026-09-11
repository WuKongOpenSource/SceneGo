export const VISUAL_STYLE_REFERENCE =
  '叙事性影视画面，色彩、材质、光影和氛围严格遵循当前剧情与场景设定，整体画面质感统一。';

export const STABILITY_CONSTRAINT_REFERENCE =
  '无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换；角色五官、妆容、发型、服饰全程100%固定不变；人物肢体自然正常，无多手指、无肢体扭曲、无穿模；画面焦点始终锁定核心主体；竖屏主体居中，纵向空间充分利用。同一场景内，所有镜头的摄影机机位、人物朝向、人物与场景的相对位置、光影色调、道具位置必须保持100%一致，严禁出现跳轴、人物瞬移、道具穿帮、光影突变。';

export const COMPUTER_OPERATION_ORIENTATION_RULE =
  '电脑操作构图硬规则：当人物使用电脑、笔记本或显示器时，镜头默认位于屏幕背面一侧，观众看到的必须是屏幕背面或侧后方，屏幕正面朝向操作者，键盘位于操作者与屏幕之间。即使剧本写明“屏幕上显示某内容”，也只将其作为剧情状态，不得为了让观众读取内容而把屏幕翻转朝向镜头；只有用户明确要求“屏幕内容特写”或“屏幕正面展示给观众”时才例外。';

export function countPromptCharacters(value: string): number {
  return String(value || '').replace(/\s/g, '').length;
}

export const MIN_VISUAL_STYLE_CHARACTERS = 25;
export const MIN_STABILITY_CONSTRAINT_CHARACTERS = 200;

export function isIndependentSegmentPrompt(value: string): boolean {
  const normalized = String(value || '').replace(/\s/g, '');
  if (!normalized) return false;
  return !/^(?:同上|同前|同第一组|同前一组|沿用上组|参照上组)/.test(normalized);
}

function appendPromptClause(value: string, clause: string): string {
  const base = value.trim().replace(/[，,；;。.\s]+$/g, '');
  return base ? `${base}；${clause}` : clause;
}

export function ensureVisualStyleLength(value: string): string {
  let result = String(value || '').trim();
  if (!result) return '';
  const additions = [
    '画面质感统一，色彩与光影层次稳定',
    '构图与整体氛围始终贴合当前剧情',
  ];
  for (const addition of additions) {
    if (countPromptCharacters(result) >= MIN_VISUAL_STYLE_CHARACTERS) break;
    result = appendPromptClause(result, addition);
  }
  return /[。！？]$/.test(result) ? result : `${result}。`;
}

const STABILITY_CLAUSES = [
  { key: '无背景音乐', text: '无背景音乐，保持无字幕、不要生成Logo、不要生成水印，全程画面流畅丝滑，无跳帧、无抖动、无突兀切换' },
  { key: '角色五官', text: '角色五官、妆容、发型、服饰全程100%固定不变' },
  { key: '人物肢体', text: '人物肢体自然正常，无多手指、无肢体扭曲、无穿模' },
  { key: '画面焦点', text: '画面焦点始终锁定核心主体' },
  { key: '竖屏主体', text: '竖屏主体居中，纵向空间充分利用' },
  {
    key: '同一场景内',
    text: '同一场景内，所有镜头的摄影机机位、人物朝向、人物与场景的相对位置、光影色调、道具位置必须保持100%一致，严禁出现跳轴、人物瞬移、道具穿帮、光影突变',
  },
];

export function ensureStabilityConstraintLength(value: string): string {
  let result = String(value || '').trim();
  if (!result) return '';
  const hasCompleteProductionBaseline = STABILITY_CLAUSES.every(clause => result.includes(clause.key));
  if (
    countPromptCharacters(result) < MIN_STABILITY_CONSTRAINT_CHARACTERS
    || !hasCompleteProductionBaseline
  ) {
    result = STABILITY_CONSTRAINT_REFERENCE;
  }
  return /[。！？]$/.test(result) ? result : `${result}。`;
}

export function ensureSegmentPromptLengths(
  visualStyle: string,
  stabilityConstraint: string,
): { visualStyle: string; stabilityConstraint: string } {
  return {
    visualStyle: ensureVisualStyleLength(visualStyle),
    stabilityConstraint: ensureStabilityConstraintLength(stabilityConstraint),
  };
}
