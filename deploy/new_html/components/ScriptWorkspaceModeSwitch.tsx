import React from 'react';
import type { ScriptWorkspaceMode } from '../utils/scriptWorkspaceMode';

interface ScriptWorkspaceModeSwitchProps {
  mode: ScriptWorkspaceMode;
  onChange: (mode: ScriptWorkspaceMode) => void;
}

const OPTIONS: Array<{
  value: ScriptWorkspaceMode;
  label: string;
  title: string;
}> = [
  {
    value: 'quick',
    label: '快速版',
    title: '快速版：使用四列工作区查看同一份剧本和镜头数据',
  },
  {
    value: 'writing',
    label: '写作版',
    title: '写作版：通过对话持续生成和修改分镜脚本',
  },
  {
    value: 'reverse',
    label: '视频反推',
    title: '视频反推：上传视频并生成可导入的候选剧本',
  },
];

export const ScriptWorkspaceModeSwitch: React.FC<ScriptWorkspaceModeSwitchProps> = ({
  mode,
  onChange,
}) => (
  <div
    className="inline-flex h-9 flex-shrink-0 items-center rounded-full border border-n40 bg-n30 p-1"
    role="radiogroup"
    aria-label="分集剧本工作模式"
    data-testid="script-workspace-mode-switch"
  >
    {OPTIONS.map(option => {
      const active = mode === option.value;
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`inline-flex h-7 min-w-[68px] items-center justify-center rounded-full px-3 text-xs font-medium transition-all ${
            active
              ? 'bg-n0 text-primary shadow-sm'
              : 'text-n400 hover:bg-n0/65 hover:text-n800'
          }`}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);
