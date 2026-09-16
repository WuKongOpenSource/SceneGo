import React, { useMemo } from 'react';

import type { VideoModel, VideoModelOption } from '../../services/videoModelService';
import { isComfyUIModel, isRetiredLocalVideoModel, sortVideoModelOptions } from '../../services/videoModelService';
import { ModelPicker, type ModelPickerOption } from '../ModelPicker';

interface VideoModelPickerProps {
  value: VideoModel;
  options: readonly VideoModelOption[];
  onChange: (model: VideoModel) => void;
  compact?: boolean;
  className?: string;
}

export const VideoModelPicker: React.FC<VideoModelPickerProps> = ({
  value,
  options,
  onChange,
  compact = false,
  className = '',
}) => {
  const pickerOptions = useMemo<readonly ModelPickerOption<VideoModel>[]>(() => (
    sortVideoModelOptions(options.filter(option => !isRetiredLocalVideoModel(option.value))).map(option => ({
      value: option.value,
      label: option.label,
      runtimeLabel: option.runtimeLabel,
      group: isComfyUIModel(option.value) || option.provider === 'processing_cluster' ? '本地节点' : '在线 API',
      badge: isComfyUIModel(option.value) || option.provider === 'processing_cluster' ? '本地节点' : undefined,
      available: option.available,
      unavailableReason: option.value === 'JimengSeedance2' && !option.available ? '未启用' : option.unavailableReason,
      unavailableLabel: option.value === 'JimengSeedance2' ? '未启用' : undefined,
    }))
  ), [options]);
  return (
    <ModelPicker
      value={value}
      options={pickerOptions}
      onChange={onChange}
      compact={compact}
      className={compact ? `max-w-[170px] ${className}` : className}
      ariaLabel="选择视频生成模型"
      title="视频模型"
      subtitle="本地节点仅提供 H3 系列；灰色项可查看暂不可用原因。旧模型请手动更换。"
      missingValueLabel="选择可用模型"
      kind="video"
    />
  );
};
