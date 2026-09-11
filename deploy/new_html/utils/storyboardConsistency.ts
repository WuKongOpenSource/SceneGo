import type {
  CharacterIdentityAnchor,
  GenerationReference,
  Material,
  MaterialLibrary,
  ProjectFile,
  StoryboardItem,
} from '../types';
import { COMPUTER_OPERATION_ORIENTATION_RULE } from './scriptPromptStandards';

export type StoryboardGenerationModel =
  | 'nanobanana'
  | 'doubao'
  | 'doubao_pro'
  | 'qwen'
  | 'qwen_lora'
  | 'kontext'
  | 'qwenN'
  | 'qwenN_lora'
  | 'gpt_image_vip'
  | 'gpt_image_official';

export interface StoryboardReferenceExclusion {
  reference: GenerationReference;
  reason: 'capacity';
  isCritical: boolean;
}

export interface StoryboardReferencePlan {
  references: GenerationReference[];
  excluded: StoryboardReferenceExclusion[];
  criticalExcluded: StoryboardReferenceExclusion[];
  maxReferences: number;
}

export interface DefaultReferenceMerge {
  references: GenerationReference[];
  exceedsLimit: boolean;
}

const COMPUTER_DEVICE_PATTERN = /(?:电脑|计算机|笔记本(?:电脑)?|台式机|工作站|显示器|键盘|鼠标|\bcomputer\b|\blaptop\b|\bdesktop\b|\bworkstation\b|\bmonitor\b|\bkeyboard\b|\bmouse\b)/i;
const COMPUTER_OPERATION_PATTERN = /(?:操作|使用|输入|打字|敲(?:击)?键盘|点击鼠标|浏览|查看|注视|看着|盯着|面向|(?:正在|埋头|低头|专注)(?:使用电脑)?(?:办公|工作)|坐在.{0,12}(?:电脑|笔记本|显示器).{0,4}(?:前|旁)|(?:电脑|笔记本|显示器).{0,4}(?:前|旁)|(?:屏幕|显示器)上?(?:显示|呈现)|\b(?:use|using|operate|operating|work|working|type|typing|click|clicking|browse|browsing|look|looking)\b)/i;
const EXPLICIT_SCREEN_FRONT_PATTERN = /(?:屏幕(?:正面)?(?:朝向|面向|正对)(?:镜头|观众)|把.{0,12}屏幕.{0,8}(?:转向|面向|展示给)(?:镜头|观众)|屏幕内容特写|屏幕正面展示给观众|(?:越过.{0,8}(?:肩膀|肩头)|过肩(?:镜头|视角)?).{0,16}(?:看到|看见|展示|读取).{0,8}(?:屏幕|显示器)(?:正面|内容)?|screen\s+(?:front\s+)?facing\s+(?:the\s+)?(?:camera|audience)|show\s+(?:the\s+)?screen\s+to\s+(?:the\s+)?(?:camera|audience)|close-up\s+of\s+(?:the\s+)?screen\s+content|over-the-shoulder.{0,24}screen)/i;

export function applyComputerOperationOrientationConstraint(
  prompt: string,
  contextValues: Array<string | null | undefined> = [],
): string {
  const basePrompt = String(prompt || '').trim();
  if (basePrompt.includes(COMPUTER_OPERATION_ORIENTATION_RULE)) return basePrompt;

  const context = [basePrompt, ...contextValues]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');
  if (
    !COMPUTER_DEVICE_PATTERN.test(context)
    || !COMPUTER_OPERATION_PATTERN.test(context)
    || EXPLICIT_SCREEN_FRONT_PATTERN.test(context)
  ) {
    return basePrompt;
  }

  return [basePrompt, COMPUTER_OPERATION_ORIENTATION_RULE].filter(Boolean).join('\n\n');
}

function normalizedAnchor(raw: unknown): CharacterIdentityAnchor {
  const anchor = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    age: String(anchor.age || '').trim(),
    face: String(anchor.face || '').trim(),
    hair: String(anchor.hair || '').trim(),
    outfit: String(anchor.outfit || '').trim(),
    distinguishingFeatures: String(anchor.distinguishing_features || anchor.distinguishingFeatures || '').trim(),
    forbiddenChanges: String(anchor.forbidden_changes || anchor.forbiddenChanges || '').trim(),
  };
}

function selectedMaterial(materials: Material[], selectedId?: string): Material | undefined {
  if (!selectedId) return undefined;
  return materials.find(material => material.id === selectedId);
}

function toReference(
  material: Material,
  type: GenerationReference['type'],
  name: string,
): GenerationReference {
  return {
    id: `default-reference:${material.assetId || name}:${material.id}`,
    url: material.url,
    type,
    name,
    assetId: material.assetId,
    fileId: material.fileId,
    description: material.description,
    source: 'manual',
  };
}

function normalizeIndependentReference(reference: GenerationReference): GenerationReference {
  const { isLocked: _legacyLock, ...independent } = reference;
  return {
    ...independent,
    source: 'manual',
  };
}

function resolveDefaultShotReferences(
  shot: StoryboardItem,
  materialLibrary: MaterialLibrary,
): GenerationReference[] {
  const defaults: GenerationReference[] = [];
  const add = (reference?: GenerationReference) => {
    if (!reference?.url || defaults.some(item => item.url === reference.url)) return;
    defaults.push(reference);
  };

  for (const character of shot.characters || []) {
    const materials = materialLibrary[character] || [];
    const selectedId = shot.materialSelections?.[character];
    const primary = selectedMaterial(materials, selectedId);
    if (primary) add(toReference(primary, 'character', character));
  }

  if (shot.scene) {
    const materials = materialLibrary[shot.scene] || [];
    const selectedId = shot.materialSelections?.[shot.scene];
    const primary = selectedMaterial(materials, selectedId);
    if (primary) add(toReference(primary, 'scene', shot.scene));
  }

  for (const prop of shot.props || []) {
    const materials = materialLibrary[prop] || [];
    const selectedId = shot.materialSelections?.[prop];
    const primary = selectedMaterial(materials, selectedId);
    if (primary) add(toReference(primary, 'prop', prop));
  }

  return defaults;
}

export function resolveShotReferencePlan(
  shot: StoryboardItem,
  materialLibrary: MaterialLibrary,
  existing?: GenerationReference[],
  maxReferences = 6,
): StoryboardReferencePlan {
  const submitted = existing === undefined
    ? resolveDefaultShotReferences(shot, materialLibrary)
    : existing;
  const candidates: GenerationReference[] = [];
  for (const rawReference of submitted) {
    const reference = normalizeIndependentReference(rawReference);
    if (!reference.url || candidates.some(item => item.url === reference.url)) continue;
    candidates.push(reference);
  }

  const references = candidates.slice(0, maxReferences);
  const excluded = candidates.slice(maxReferences).map(reference => ({
    reference,
    reason: 'capacity' as const,
    isCritical: false,
  }));
  return {
    references,
    excluded,
    criticalExcluded: excluded.filter(item => item.isCritical),
    maxReferences,
  };
}

export function resolveShotReferences(
  shot: StoryboardItem,
  materialLibrary: MaterialLibrary,
  existing?: GenerationReference[],
  maxReferences = 6,
): GenerationReference[] {
  return resolveShotReferencePlan(shot, materialLibrary, existing, maxReferences).references;
}

export function mergeDefaultShotReferences(
  currentReferences: GenerationReference[],
  defaultReferences: GenerationReference[],
  maxReferences = 6,
): DefaultReferenceMerge {
  const merged = [...currentReferences];
  const existingUrls = new Set(currentReferences.map(reference => reference.url).filter(Boolean));

  for (const reference of defaultReferences) {
    if (!reference.url || existingUrls.has(reference.url)) continue;
    merged.push(reference);
    existingUrls.add(reference.url);
  }

  return merged.length > maxReferences
    ? { references: [...currentReferences], exceedsLimit: true }
    : { references: merged, exceedsLimit: false };
}

export function resolveSelectedShotReferences(
  shot: StoryboardItem,
  materialLibrary: MaterialLibrary,
  activeShotId: string | null,
  currentReferences: GenerationReference[] = [],
  maxReferences = 6,
): GenerationReference[] {
  const existing = activeShotId === shot.id
    ? currentReferences
    : shot.referenceConfigInitialized || (shot.configuredReferences?.length || 0) > 0
      ? shot.configuredReferences || []
      : undefined;
  return resolveShotReferences(shot, materialLibrary, existing, maxReferences);
}

export function applyConfiguredReferenceDrafts(
  file: ProjectFile,
  drafts: Record<string, GenerationReference[]>,
): ProjectFile {
  if (!file.storyboard || Object.keys(drafts).length === 0) return file;

  let changed = false;
  const items = file.storyboard.items.map(item => {
    if (!Object.prototype.hasOwnProperty.call(drafts, item.id)) return item;
    changed = true;
    return {
      ...item,
      configuredReferences: [...(drafts[item.id] || [])],
      referenceConfigInitialized: true,
    };
  });

  if (!changed) return file;
  return {
    ...file,
    storyboard: {
      ...file.storyboard,
      items,
    },
  };
}

function referenceMaterial(
  reference: GenerationReference,
  materialLibrary: MaterialLibrary,
): Material | undefined {
  const namedMaterials = reference.name ? materialLibrary[reference.name] || [] : [];
  const candidates = namedMaterials.length > 0
    ? namedMaterials
    : Object.values(materialLibrary).flat();
  return candidates.find(material => (
    (reference.assetId && material.assetId === reference.assetId)
    || (reference.fileId && material.fileId === reference.fileId)
    || material.url === reference.url
  ));
}

export function buildIdentityAnchoredPrompt(
  shot: StoryboardItem,
  basePrompt: string,
  materialLibrary: MaterialLibrary,
  references: GenerationReference[] = [],
): string {
  const characterBlocks = references
    .filter(reference => reference.type === 'character')
    .map(reference => {
    const name = reference.name || '角色';
    const material = referenceMaterial(reference, materialLibrary);
    const anchor = normalizedAnchor(material?.styleParams?.identity_anchor);
    const details = [
      reference.description || material?.description
        ? `身份描述：${reference.description || material?.description}`
        : '',
      anchor.age ? `年龄感：${anchor.age}` : '',
      anchor.face ? `脸型与五官：${anchor.face}` : '',
      anchor.hair ? `发型发色：${anchor.hair}` : '',
      anchor.outfit ? `固定服装：${anchor.outfit}` : '',
      anchor.distinguishingFeatures ? `识别特征：${anchor.distinguishingFeatures}` : '',
      anchor.forbiddenChanges ? `禁止变化：${anchor.forbiddenChanges}` : '',
    ].filter(Boolean);
    return details.length ? `【${name}】${details.join('；')}` : `【${name}】严格匹配同名角色参考图。`;
  });

  const hardConstraints = characterBlocks.length > 0
    ? [
        '角色身份锚点（最高优先级硬约束）：',
        ...characterBlocks,
        '同名角色参考图用于锁定人物身份。不得改变脸型、五官比例、年龄感、发型发色、固定服装和显著识别特征；不得把不同角色的特征互相混合。',
      ].join('\n')
    : '';

  const storyRequirements = [
    shot.scriptSegment ? `脚本画面要求：${shot.scriptSegment}` : '',
    shot.scene ? `场景：${shot.scene}` : '',
    shot.characters?.length ? `画面角色：${shot.characters.join('、')}` : '',
    shot.props?.length ? `关键道具：${shot.props.join('、')}` : '',
  ].filter(Boolean).join('\n');

  const referenceTypeLabels: Record<GenerationReference['type'], string> = {
    character: '角色身份锚点（最高优先级）',
    scene: '场景参考',
    pose: '姿态/构图参考',
    prop: '道具参考',
    effect: '风格/效果参考',
  };
  const referenceMap = references.length > 0
    ? [
        '参考图职责映射（编号与上传顺序一致）：',
        ...references.map((reference, index) => (
          `参考图${index + 1} = ${referenceTypeLabels[reference.type]}【${reference.name || '未命名'}】`
          + (reference.type === 'character' ? '，必须生成该参考图中的同一人物，不得替换成相似人物' : '')
        )),
      ].join('\n')
    : '';

  return [
    basePrompt.trim(),
    hardConstraints,
    referenceMap,
    storyRequirements,
    '输出要求：角色一致性优先于装饰性变化；准确执行人物、场景、动作和构图描述；保持稳定画质，避免多余人物、错位肢体和身份漂移。',
  ].filter(Boolean).join('\n\n');
}
