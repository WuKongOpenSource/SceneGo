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
    className="ui-tabs ui-tabs--compact"
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
          className="ui-tab"
        >
          {option.label}
        </button>
      );
    })}
  </div>
);
