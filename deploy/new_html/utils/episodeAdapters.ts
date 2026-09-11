




import type {
  StoryboardItemDB, EpisodeScript, AssetItem,
  ProjectFile, StoryboardItem, StoryboardData,
  FileStatus, FileVersion, GeneratedImage, GenerationReference,
} from '../types';
import { isAssetImageFileRole } from './assetImageRoles';
import { normalizePositiveIntegerSeconds } from './storyboardSegments';

const CHAR_PREFIX = 'char:';
const SCENE_PREFIX = 'scene:';
const PROP_PREFIX = 'prop:';
const SEL_PREFIX = 'sel:';
const NOSEL_PREFIX = 'nosel:';
export const BINDINGS_INITIALIZED_TAG = 'meta:bindings-initialized';
export const DEFAULT_BINDINGS_INITIALIZED_TAG = 'meta:default-bindings-initialized';
const DEFAULT_CHAR_PREFIX = 'default-char:';
const DEFAULT_SCENE_PREFIX = 'default-scene:';
const DEFAULT_PROP_PREFIX = 'default-prop:';

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
    } catch {}
  }
  return [];
}

export function parseArray<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {}
  }
  return [];
}

export function parseRecord(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return {};
}

export function normalizeStoryboardRecord(record: any): StoryboardItemDB {
  const configuredReferences = parseArray<GenerationReference>(
    record.configured_references ?? record.configuredReferences,
  );
  return {
    itemId: record.item_id ?? record.itemId ?? '',
    lineageId: record.lineage_id ?? record.lineageId ?? undefined,
    episodeId: record.episode_id ?? record.episodeId ?? '',
    sortOrder: typeof (record.sort_order ?? record.sortOrder) === 'number'
      ? (record.sort_order ?? record.sortOrder)
      : 0,
    scriptSegmentId: record.script_segment_id ?? record.scriptSegmentId ?? undefined,
    sourceVideoShotNo: record.source_video_shot_no ?? record.sourceVideoShotNo ?? undefined,
    sceneHeading: record.scene_heading ?? record.sceneHeading ?? '',
    actionText: record.action_text ?? record.actionText ?? '',
    dialogue: record.dialogue ?? '',
    cameraMovement: record.camera_movement ?? record.cameraMovement ?? '',
    imagePrompt: record.image_prompt ?? record.imagePrompt ?? '',
    videoPrompt: record.video_prompt ?? record.videoPrompt ?? '',
    generatedImageUrl: record.generated_image_url ?? record.generatedImageUrl ?? null,
    boundAssets: parseStringArray(record.bound_assets ?? record.boundAssets),
    configuredReferences,
    referenceConfigInitialized: Boolean(
      record.reference_config_initialized
      ?? record.referenceConfigInitialized
      ?? configuredReferences.length > 0
    ),
    status: record.status ?? 'draft',
    dialogueAudioUrl: record.dialogue_audio_url ?? record.dialogueAudioUrl ?? null,
    narrationAudioUrl: record.narration_audio_url ?? record.narrationAudioUrl ?? null,
    sfxAudioUrl: record.sfx_audio_url ?? record.sfxAudioUrl ?? null,
    audioDurationMs: record.audio_duration_ms ?? record.audioDurationMs ?? null,
    plannedDurationMs: record.planned_duration_ms ?? record.plannedDurationMs ?? null,
    audioSegments: parseArray(record.audio_segments ?? record.audioSegments),
    videoScriptBlock: record.video_script_block ?? record.videoScriptBlock ?? '',
  };
}

export function applyStoryboardRecordPatch(
  item: StoryboardItemDB,
  patch: Record<string, any>,
): StoryboardItemDB {
  return normalizeStoryboardRecord({
    ...item,
    ...patch,
    item_id: item.itemId,
    episode_id: item.episodeId,
    sort_order: patch.sort_order ?? patch.sortOrder ?? item.sortOrder,
    bound_assets: patch.bound_assets ?? patch.boundAssets ?? item.boundAssets,
    configured_references:
      patch.configured_references ?? patch.configuredReferences ?? item.configuredReferences,
    reference_config_initialized:
      patch.reference_config_initialized
      ?? patch.referenceConfigInitialized
      ?? item.referenceConfigInitialized,
    audio_segments: patch.audio_segments ?? patch.audioSegments ?? item.audioSegments,
  });
}

export function parseBoundAssetTags(boundAssets: string[]): {
  charNames: string[];
  sceneName: string;
  propNames: string[];
  defaultCharNames: string[];
  defaultSceneName: string;
  defaultPropNames: string[];
  assetIds: string[];
  selections: Record<string, string>;
  noSelections: Set<string>;
  bindingsInitialized: boolean;
  defaultBindingsInitialized: boolean;
} {
  const charNames: string[] = [];
  let sceneName = '';
  const propNames: string[] = [];
  const defaultCharNames: string[] = [];
  let defaultSceneName = '';
  const defaultPropNames: string[] = [];
  const assetIds: string[] = [];
  const selections: Record<string, string> = {};
  const noSelections = new Set<string>();
  let bindingsInitialized = false;
  let defaultBindingsInitialized = false;
  for (const entry of boundAssets) {
    if (entry === BINDINGS_INITIALIZED_TAG) {
      bindingsInitialized = true;
    } else if (entry === DEFAULT_BINDINGS_INITIALIZED_TAG) {
      defaultBindingsInitialized = true;
    } else if (entry.startsWith(DEFAULT_CHAR_PREFIX)) {
      defaultCharNames.push(entry.slice(DEFAULT_CHAR_PREFIX.length));
    } else if (entry.startsWith(DEFAULT_SCENE_PREFIX)) {
      defaultSceneName = entry.slice(DEFAULT_SCENE_PREFIX.length);
    } else if (entry.startsWith(DEFAULT_PROP_PREFIX)) {
      defaultPropNames.push(entry.slice(DEFAULT_PROP_PREFIX.length));
    } else if (entry.startsWith(CHAR_PREFIX)) {
      charNames.push(entry.slice(CHAR_PREFIX.length));
    } else if (entry.startsWith(SCENE_PREFIX)) {
      sceneName = entry.slice(SCENE_PREFIX.length);
    } else if (entry.startsWith(PROP_PREFIX)) {
      propNames.push(entry.slice(PROP_PREFIX.length));
    } else if (entry.startsWith(SEL_PREFIX)) {
      const rest = entry.slice(SEL_PREFIX.length);
      const idx = rest.indexOf(':');
      if (idx > 0) {
        selections[rest.slice(0, idx)] = rest.slice(idx + 1);
      }
    } else if (entry.startsWith(NOSEL_PREFIX)) {
      noSelections.add(entry.slice(NOSEL_PREFIX.length));
    } else {
      assetIds.push(entry);
    }
  }
  return {
    charNames,
    sceneName,
    propNames,
    defaultCharNames,
    defaultSceneName,
    defaultPropNames,
    assetIds,
    selections,
    noSelections,
    bindingsInitialized,
    defaultBindingsInitialized,
  };
}

function defaultBindingSnapshotTokens(
  characters: string[],
  scene: string,
  props: string[],
): string[] {
  return [
    DEFAULT_BINDINGS_INITIALIZED_TAG,
    ...characters.filter(Boolean).map(name => `${DEFAULT_CHAR_PREFIX}${name}`),
    ...(scene ? [`${DEFAULT_SCENE_PREFIX}${scene}`] : []),
    ...props.filter(Boolean).map(name => `${DEFAULT_PROP_PREFIX}${name}`),
  ];
}

/**
 * Capture the current imported bindings once. Material-stage edits keep these
 * tokens untouched; a fresh export from the script stage writes a new snapshot.
 */
export function ensureDefaultBindingSnapshot(boundAssets: string[]): string[] {
  const parsed = parseBoundAssetTags(boundAssets);
  if (parsed.defaultBindingsInitialized) return Array.from(new Set(boundAssets));
  return Array.from(new Set([
    ...boundAssets,
    ...defaultBindingSnapshotTokens(parsed.charNames, parsed.sceneName, parsed.propNames),
  ]));
}

/** Build the latest upstream default snapshot when a script is exported. */
export function buildDefaultBindingSnapshot(
  characters: string[] = [],
  scene = '',
  props: string[] = [],
): string[] {
  return defaultBindingSnapshotTokens(characters, scene, props);
}

/** Restore role/scene/prop membership while retaining selections still valid. */
export function restoreDefaultBindingSnapshot(boundAssets: string[]): string[] {
  const parsed = parseBoundAssetTags(boundAssets);
  if (!parsed.defaultBindingsInitialized) return Array.from(new Set(boundAssets));

  const activeNames = new Set([
    ...parsed.defaultCharNames,
    ...(parsed.defaultSceneName ? [parsed.defaultSceneName] : []),
    ...parsed.defaultPropNames,
  ]);
  const preservedMetadata = boundAssets.filter(token => token.startsWith('meta:'));
  const preservedSelections = boundAssets.filter(token => {
    if (token.startsWith(NOSEL_PREFIX)) return activeNames.has(token.slice(NOSEL_PREFIX.length));
    if (!token.startsWith(SEL_PREFIX)) return false;
    const rest = token.slice(SEL_PREFIX.length);
    const separator = rest.indexOf(':');
    return separator > 0 && activeNames.has(rest.slice(0, separator));
  });

  return Array.from(new Set([
    ...preservedMetadata,
    BINDINGS_INITIALIZED_TAG,
    ...parsed.defaultCharNames.map(name => `${CHAR_PREFIX}${name}`),
    ...(parsed.defaultSceneName ? [`${SCENE_PREFIX}${parsed.defaultSceneName}`] : []),
    ...parsed.defaultPropNames.map(name => `${PROP_PREFIX}${name}`),
    ...boundAssets.filter(token => (
      token.startsWith(DEFAULT_CHAR_PREFIX)
      || token.startsWith(DEFAULT_SCENE_PREFIX)
      || token.startsWith(DEFAULT_PROP_PREFIX)
    )),
    ...preservedSelections,
  ]));
}

export function bindingMembershipDiffersFromDefault(boundAssets: string[]): boolean {
  const parsed = parseBoundAssetTags(boundAssets);
  if (!parsed.defaultBindingsInitialized) return false;
  const sameSet = (left: string[], right: string[]) => (
    left.length === right.length && left.every(name => right.includes(name))
  );
  return !sameSet(parsed.charNames, parsed.defaultCharNames)
    || parsed.sceneName !== parsed.defaultSceneName
    || !sameSet(parsed.propNames, parsed.defaultPropNames);
}

function assetHasImages(asset: AssetItem): boolean {
  const ef = (asset.entityFiles || []).filter(f => isAssetImageFileRole(f.fileRole));
  if (ef.length > 0) return true;
  const refs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
  return refs.length > 0 || !!asset.thumbnailUrl;
}

export function dbItemToStoryboardItem(item: StoryboardItemDB, assets?: AssetItem[]): StoryboardItem {
  const boundAssets = Array.isArray(item.boundAssets) ? item.boundAssets : [];
  const {
    charNames, sceneName, propNames, assetIds, selections, noSelections, bindingsInitialized,
  } = parseBoundAssetTags(boundAssets);
  const plannedDurationSeconds = normalizePositiveIntegerSeconds(
    item.plannedDurationMs ? item.plannedDurationMs / 1000 : null,
  );

  let characters = charNames;
  let scene = sceneName;
  let props = propNames;

  if (assets && assetIds.length > 0) {
    const boundChars = assets
      .filter(a => assetIds.includes(a.assetId) && a.assetType === 'character')
      .map(a => a.name);
    if (boundChars.length > 0) {
      const merged = new Set([...characters, ...boundChars]);
      characters = Array.from(merged);
    }
    if (!scene) {
      scene = assets.find(a => assetIds.includes(a.assetId) && a.assetType === 'scene')?.name || '';
    }
    const boundProps = assets
      .filter(a => assetIds.includes(a.assetId) && a.assetType === 'prop')
      .map(a => a.name);
    if (boundProps.length > 0) {
      const merged = new Set([...props, ...boundProps]);
      props = Array.from(merged);
    }
  }

  if (!bindingsInitialized && assets && (characters.length === 0 || !scene || props.length === 0)) {
    const searchText = [
      item.sceneHeading, item.actionText, item.dialogue,
      item.imagePrompt,
    ].filter(Boolean).join(' ');
    if (searchText && characters.length === 0) {
      characters = assets
        .filter(a => a.assetType === 'character' && a.name && searchText.includes(a.name))
        .map(a => a.name);
    }
    if (searchText && !scene) {
      scene = assets
        .find(a => a.assetType === 'scene' && a.name && searchText.includes(a.name))
        ?.name || '';
    }
    if (searchText && props.length === 0) {
      props = assets
        .filter(a => a.assetType === 'prop' && a.name && searchText.includes(a.name))
        .map(a => a.name);
    }
  }

  // Last resort: if text fields are empty (old buggy data), assign all characters
  if (!bindingsInitialized && assets && characters.length === 0) {
    const allChars = assets.filter(a => a.assetType === 'character' && a.name);
    if (allChars.length > 0) characters = allChars.map(a => a.name);
  }
  if (!bindingsInitialized && assets && !scene) {
    const allScenes = assets.filter(a => a.assetType === 'scene' && a.name);
    if (allScenes.length === 1) scene = allScenes[0].name;
  }

  const generatedImages: GeneratedImage[] = item.generatedImageUrl
    ? [{ id: `gen_${item.itemId}`, url: item.generatedImageUrl, timestamp: Date.now() }]
    : [];

  const materialSelections: Record<string, string> = {};
  if (assets) {
    for (const charName of characters) {
      if (selections[charName]) {
        materialSelections[charName] = selections[charName];
        continue;
      }
      if (noSelections.has(charName)) continue;
      const asset = assets.find(a => a.assetType === 'character' && a.name === charName);
      if (asset && assetHasImages(asset)) {
        materialSelections[charName] = `${asset.assetId}_0`;
      }
    }
    if (scene) {
      if (selections[scene]) {
        materialSelections[scene] = selections[scene];
      } else if (noSelections.has(scene)) {

      } else {
        const sceneAsset = assets.find(a => a.assetType === 'scene' && a.name === scene);
        if (sceneAsset && assetHasImages(sceneAsset)) {
          materialSelections[scene] = `${sceneAsset.assetId}_0`;
        }
      }
    }
    for (const propName of props) {
      if (selections[propName]) {
        materialSelections[propName] = selections[propName];
        continue;
      }
      if (noSelections.has(propName)) continue;
      const propAsset = assets.find(a => a.assetType === 'prop' && a.name === propName);
      if (propAsset && assetHasImages(propAsset)) {
        materialSelections[propName] = `${propAsset.assetId}_0`;
      }
    }
  }

  return {
    id: item.itemId,
    originalText: item.sceneHeading || '',
    scriptSegment: item.actionText || '',
    characters,
    scene,
    props,
    dialogue: item.dialogue || '',
    imagePrompt: item.imagePrompt || '',
    videoPrompt: item.videoPrompt || '',
    cameraMovement: item.cameraMovement,
    scriptSegmentId: item.scriptSegmentId,
    sourceVideoShotNo: item.sourceVideoShotNo,
    plannedDurationMs: plannedDurationSeconds ? plannedDurationSeconds * 1000 : null,
    duration: plannedDurationSeconds
      ? `${plannedDurationSeconds}秒`
      : undefined,
    videoScriptBlock: item.videoScriptBlock || '',
    generatedImage: item.generatedImageUrl || undefined,
    generatedImages,
    selectedImageId: generatedImages.length > 0 ? generatedImages[0].id : undefined,
    configuredReferences: Array.isArray(item.configuredReferences)
      ? item.configuredReferences
      : [],
    referenceConfigInitialized: Boolean(
      item.referenceConfigInitialized || item.configuredReferences?.length
    ),
    materialSelections,
    boundCharNames: charNames,
    boundSceneName: sceneName,
    boundPropNames: propNames,
    boundAssetTokens: boundAssets,
    bindingsInitialized,
    isLocked: item.status === 'locked',
  };
}

export function dbItemsToStoryboardData(items: StoryboardItemDB[], assets?: AssetItem[]): StoryboardData {
  return {
    items: items
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(item => dbItemToStoryboardItem(item, assets)),
  };
}

/**
 * Write-side invariant: generated_image_url must be durable. Inline data URLs
 * can exceed persistence and request limits; blob URLs expire with the browser
 * session and cannot be consumed by background workers.
 */
function isPersistentImageUrl(u: unknown): u is string {
  if (typeof u !== 'string' || !u) return false;
  if (u.startsWith('data:')) return false;
  if (u.startsWith('blob:')) return false;
  return u.startsWith('http') || u.startsWith('/');
}

export function storyboardItemToDbUpdate(updates: Partial<StoryboardItem>): Record<string, any> {
  const result: Record<string, any> = {};
  if (updates.originalText !== undefined) result.scene_heading = updates.originalText;
  if (updates.scriptSegment !== undefined) result.action_text = updates.scriptSegment;
  if (updates.dialogue !== undefined) result.dialogue = updates.dialogue;
  if (updates.imagePrompt !== undefined) result.image_prompt = updates.imagePrompt;
  if (updates.videoPrompt !== undefined) result.video_prompt = updates.videoPrompt;
  if (updates.isLocked !== undefined) result.status = updates.isLocked ? 'locked' : 'draft';
  if (updates.generatedImage !== undefined) {
    if (updates.generatedImage === null || isPersistentImageUrl(updates.generatedImage)) {
      result.generated_image_url = updates.generatedImage;
    } else {
      console.warn(
        '[episodeAdapters] storyboardItemToDbUpdate: 拒绝把非持久化 URL 写入 generated_image_url',
        { sample: String(updates.generatedImage).slice(0, 60) }
      );
    }
  }
  if ((updates as any).cameraMovement !== undefined) result.camera_movement = (updates as any).cameraMovement;
  if (updates.isConfigConfirmed !== undefined) result.is_config_confirmed = updates.isConfigConfirmed;
  if (updates.configuredReferences !== undefined) {
    result.configured_references = Array.isArray(updates.configuredReferences)
      ? updates.configuredReferences
      : [];
  }
  if (updates.referenceConfigInitialized !== undefined) {
    result.reference_config_initialized = updates.referenceConfigInitialized;
  }
  if ((updates as any).audioSegments !== undefined) {
    result.audio_segments = Array.isArray((updates as any).audioSegments)
      ? (updates as any).audioSegments
      : [];
  }
  return result;
}

export function newShotToDbFields(shot: Omit<StoryboardItem, 'id'>, sortOrder: number): Record<string, any> {
  return {
    sort_order: sortOrder,
    scene_heading: shot.originalText || '',
    action_text: shot.scriptSegment || '',
    dialogue: shot.dialogue || '',
    camera_movement: (shot as any).cameraMovement || '',
    image_prompt: shot.imagePrompt || '',
    video_prompt: shot.videoPrompt || '',
    configured_references: Array.isArray(shot.configuredReferences)
      ? shot.configuredReferences
      : [],
    reference_config_initialized: Boolean(
      shot.referenceConfigInitialized || shot.configuredReferences?.length
    ),
    bound_assets: [
      BINDINGS_INITIALIZED_TAG,
      ...(shot.characters || []).map((c: string) => `${CHAR_PREFIX}${c}`),
      ...(shot.scene ? [`${SCENE_PREFIX}${shot.scene}`] : []),
      ...((shot.props || []).map((p: string) => `${PROP_PREFIX}${p}`)),
      ...buildDefaultBindingSnapshot(shot.characters || [], shot.scene || '', shot.props || []),
    ],
  };
}

export function scriptToProjectFile(
  script: EpisodeScript | null,
  items: StoryboardItemDB[],
  assets: AssetItem[],
  episodeId: string,
): ProjectFile {
  return {
    id: episodeId,
    name: '当前集',
    originalContent: script?.originalContent || '',
    scriptContent: script?.adaptedScript || null,
    storyboard: items.length > 0 ? dbItemsToStoryboardData(items, assets) : null,
    extractedCharacters: script?.metadata?.extracted_characters || [],
    extractedScenes: script?.metadata?.extracted_scenes || [],
    extractedProps: script?.metadata?.extracted_props || [],
    status: 'Idle' as FileStatus,
    lastUpdated: Date.now(),
    versions: [],
  };
}

export function assetsToMaterialLibrary(assets: AssetItem[]): Record<string, Array<{
  id: string;
  url: string;
  thumbnail?: string;
  name: string;
  source: string;
  assetId: string;
  fileId?: string;
  assetType: AssetItem['assetType'];
  description: string;
  styleParams: Record<string, any>;
  isIdentityReference: boolean;
}>> {
  const lib: ReturnType<typeof assetsToMaterialLibrary> = {};
  for (const asset of assets) {
    const key = asset.name;
    if (!lib[key]) lib[key] = [];
    const seenUrls = new Set<string>();

    const identityReferenceUrl = String(asset.styleParams?.identity_reference_url || '');
    const pushMaterial = (url: string, thumbnail: string | undefined, source: string, fileId?: string) => {
      if (!url) return;
      if (seenUrls.has(url)) {
        if (fileId) {
          const existing = lib[key].find(material => material.url === url);
          if (existing) existing.fileId = fileId;
        }
        return;
      }
      seenUrls.add(url);
      const index = lib[key].length;
      lib[key].push({
        id: `${asset.assetId}_${index}`,
        url,
        thumbnail: index === 0 ? (asset.thumbnailUrl || thumbnail || url) : (thumbnail || url),
        name: asset.name,
        source,
        assetId: asset.assetId,
        fileId,
        assetType: asset.assetType,
        description: asset.description || '',
        styleParams: asset.styleParams || {},
        isIdentityReference: Boolean(identityReferenceUrl && identityReferenceUrl === url),
      });
    };

    const efImages = (asset.entityFiles || [])
      .filter(f => isAssetImageFileRole(f.fileRole) && Boolean(f.fileUrl))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const entityFileUrls = new Set(efImages.map(file => file.fileUrl));

    const refs = Array.isArray(asset.referenceImages) ? asset.referenceImages.filter(Boolean) : [];
    const legacyUrls = refs.filter(url => !entityFileUrls.has(url));
    if (asset.thumbnailUrl && !legacyUrls.includes(asset.thumbnailUrl)) {
      if (!entityFileUrls.has(asset.thumbnailUrl)) legacyUrls.unshift(asset.thumbnailUrl);
    }
    legacyUrls.forEach((url) => {
      pushMaterial(url, url, 'asset');
    });

    efImages.forEach((f) => {
      pushMaterial(f.fileUrl, f.fileUrl, `entity_file:${f.fileRole}`, f.fileId);
    });

    if (lib[key].length === 0 && asset.thumbnailUrl) {
      pushMaterial(asset.thumbnailUrl, asset.thumbnailUrl, 'asset');
    }
  }
  return lib;
}
