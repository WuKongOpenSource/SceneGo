import React, { useEffect } from 'react';
import { ServerOff } from 'lucide-react';
import { PUBLIC_LOCAL_CONNECTOR_MESSAGE } from './runtimeUnavailable';

export interface GpuNodeSelection {
  id: string;
  name: string;
  preferredAgentId?: string;
  preferredNodeId: string;
  usable: boolean;
}

export function toGpuNodeSelection(): GpuNodeSelection {
  return {
    id: '',
    name: '未配置本地连接器',
    preferredNodeId: '',
    usable: false,
  };
}

export const GpuNodeSelector: React.FC<{
  onSelectionChange: (selection: GpuNodeSelection | null) => void;
  disabled?: boolean;
  className?: string;
}> = ({ onSelectionChange, className = '' }) => {
  useEffect(() => onSelectionChange(null), [onSelectionChange]);
  return (
    <div
      className={`rounded-md border border-n40 bg-n20 p-3 text-xs text-n300 ${className}`}
      title={PUBLIC_LOCAL_CONNECTOR_MESSAGE}
    >
      <span className="inline-flex items-center gap-1.5">
        <ServerOff size={13} />
        本地处理节点未配置
      </span>
      <p className="mt-1 text-[10px] leading-4">{PUBLIC_LOCAL_CONNECTOR_MESSAGE}</p>
    </div>
  );
};
