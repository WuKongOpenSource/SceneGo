









import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, User as UserIcon, Building2, Check, RefreshCw } from 'lucide-react';
import { useWorkspace, WorkspaceId } from '../contexts/WorkspaceContext';

export const WorkspaceSwitcher: React.FC = () => {
  const { currentWorkspace, currentName, isOrgWorkspace, organizations, setWorkspace, refreshOrganizations, loading } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const handlePick = (ws: WorkspaceId) => {
    setWorkspace(ws);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-n0 hover:bg-n20 text-n700 border border-n40"
        title="切换工作区"
      >
        {isOrgWorkspace ? <Building2 size={12} className="text-primary" /> : <UserIcon size={12} className="text-n300" />}
        <span className="max-w-[120px] truncate">{currentName}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-n0 border border-n40 rounded-lg shadow-bottom z-50 overflow-hidden">
          <div className="px-3 py-2 border-b border-n40 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-n100">切换工作区</span>
            <button
              onClick={() => refreshOrganizations()}
              className="text-n100 hover:text-n700"
              title="刷新组织列表"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <button
            onClick={() => handlePick('personal')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-n20 ${
              currentWorkspace === 'personal' ? 'bg-n30' : ''
            }`}
          >
            <UserIcon size={13} className="text-n300" />
            <div className="flex-1">
              <div className="text-n700">个人空间</div>
              <div className="text-[10px] text-n100">仅我可见的项目和素材</div>
            </div>
            {currentWorkspace === 'personal' && <Check size={12} className="text-primary" />}
          </button>

          {organizations.length > 0 && (
            <div className="border-t border-n40">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-n100">我加入的组织</div>
              {organizations.map(o => (
                <button
                  key={o.org_id}
                  onClick={() => handlePick(o.org_id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-n20 ${
                    currentWorkspace === o.org_id ? 'bg-n30' : ''
                  }`}
                >
                  <Building2 size={13} className="text-primary" />
                  <div className="flex-1 min-w-0">
                    <div className="text-n700 truncate">{o.name}</div>
                    <div className="text-[10px] text-n100">
                      角色：{o.my_role || 'member'}
                    </div>
                  </div>
                  {currentWorkspace === o.org_id && <Check size={12} className="text-primary" />}
                </button>
              ))}
            </div>
          )}

          {organizations.length === 0 && !loading && (
            <div className="px-3 py-3 text-[11px] text-n100 border-t border-n40">
              你还没加入任何组织。
              <div className="mt-1 text-[10px] text-n100">联系管理员把你加入组织即可获得组织 workspace。</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkspaceSwitcher;
