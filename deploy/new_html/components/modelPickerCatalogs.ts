import type { AiModel } from '../types';
import type { ScriptModelOption } from '../services/scriptModelCatalogService';
import { formatScriptModelSelectLabel } from '../services/scriptModelCatalogService';
import {
  DESIGN_IMAGE_MODEL_OPTIONS,
  type DesignImageModelOption,
} from '../utils/designImageModels';
import type { StoryboardGenerationModel } from '../utils/storyboardConsistency';
import type { StoryboardGenerationModelOption } from '../utils/storyboardGenerationModels';
import type { ModelPickerOption } from './ModelPicker';
import { compactImageModelLabel } from '../utils/imageSourceDisplay';

export function buildScriptModelPickerOptions(
  options: readonly ScriptModelOption[],
  describe?: (option: ScriptModelOption) => string,
): readonly ModelPickerOption<AiModel>[] {
  return options.map(option => ({
    value: option.value,
    label: formatScriptModelSelectLabel(option),
    description: describe?.(option) || option.hint,
    runtimeLabel: option.runtime,
    group: '在线 API',
  }));
}

export function buildDesignImageModelPickerOptions(
  options: readonly DesignImageModelOption[] = DESIGN_IMAGE_MODEL_OPTIONS,
): readonly ModelPickerOption<string>[] {
  return options.map(option => ({
    value: option.id,
    label: compactImageModelLabel(option.label),
    description: option.hint,
    runtimeLabel: compactImageModelLabel(option.runtime),
    group: '在线 API',
  }));
}

export function buildStoryboardModelPickerOptions(
  options: readonly StoryboardGenerationModelOption[],
  hasUsableClusterNode: boolean,
  onlineAvailability: Partial<Record<StoryboardGenerationModel, { available: boolean; reason?: string }>> = {},
): readonly ModelPickerOption<StoryboardGenerationModel>[] {
  return options.map(option => {
    const online = onlineAvailability[option.value];
    const available = option.requiresCluster ? hasUsableClusterNode : online?.available !== false;
    return {
      value: option.value,
      label: compactImageModelLabel(option.label),
      description: option.hint,
      group: option.requiresCluster ? '本地节点' : '在线 API',
      badge: option.requiresCluster ? '本地节点' : undefined,
      available,
      unavailableReason: available
        ? undefined
        : (option.requiresCluster
          ? '当前没有可用的处理节点，请等待节点恢复或联系管理员'
          : (online?.reason || '当前模型通道不可用，请联系管理员')),
    };
  });
}
