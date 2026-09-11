






import React, { useEffect, useState, useCallback } from 'react';
import { Share2, X, Trash2, Plus, Building2, FolderOpen } from 'lucide-react';

import {
  listShares, createShare, deleteShare,
  ShareResourceType, ShareTargetType, ResourceShare,
} from '../services/shareService';
import { listProjects } from '../services/projectWorkflowService';
import { useWorkspace } from '../contexts/WorkspaceContext';


export interface ShareResourceDialogProps {
  resourceType: ShareResourceType;
  resourceId: string;
  resourceName?: string;
  onClose: () => void;

  onChange?: () => void;
}


async function readErr(e: any): Promise<string> {
  const raw = String(e?.message || e || '');
  const m = raw.match(/\{.*\}$/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.detail === 'string') return j.detail;
    } catch {}
  }
  return raw;
}


export const ShareResourceDialog: React.FC<ShareResourceDialogProps> = ({
  resourceType, resourceId, resourceName, onClose, onChange,
}) => {
  const { organizations } = useWorkspace();
  const [shares, setShares] = useState<ResourceShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);


  const [targetType, setTargetType] = useState<ShareTargetType>('org');
  const [targetOrgId, setTargetOrgId] = useState<string>('');
  const [targetProjectId, setTargetProjectId] = useState<string>('');
  const [orgProjects, setOrgProjects] = useState<any[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listShares(resourceType, resourceId);
      setShares(r.shares || []);
    } catch (e) {
      console.warn('listShares failed:', e);
      setShares([]);
    } finally {
      setLoading(false);
    }
  }, [resourceType, resourceId]);

  useEffect(() => { reload(); }, [reload]);


  useEffect(() => {
    let alive = true;
    if (targetType !== 'project' || !targetOrgId) {
      setOrgProjects([]);
      setTargetProjectId('');
      return;
    }
    (async () => {
      try {
        const r = await listProjects(200, targetOrgId);
        if (alive) setOrgProjects(r.projects || []);
      } catch (e) {
        console.warn('list org projects failed:', e);
        if (alive) setOrgProjects([]);
      }
    })();
    return () => { alive = false; };
  }, [targetType, targetOrgId]);

  const handleAdd = async () => {
    if (!targetOrgId) { alert('请选择组织'); return; }
    let shareTargetId = targetOrgId;
    if (targetType === 'project') {
      if (!targetProjectId) { alert('请选择项目'); return; }
      shareTargetId = targetProjectId;
    }
    setBusy(true);
    try {
      await createShare({
        resource_type: resourceType,
        resource_id: resourceId,
        share_target_type: targetType,
        share_target_id: shareTargetId,
      });
      setTargetOrgId('');
      setTargetProjectId('');
      await reload();
      onChange?.();
    } catch (e: any) {
      alert(`共享失败：${await readErr(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (s: ResourceShare) => {
    if (!confirm(`取消共享给「${s.share_target_name || s.share_target_id}」？`)) return;
    try {
      await deleteShare(s.share_id);
      await reload();
      onChange?.();
    } catch (e: any) {
      alert(`取消失败：${await readErr(e)}`);
    }
  };

  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="共享资源" className="app-modal-surface bg-n0 border border-n40 rounded-lg w-[480px] max-h-[80vh] flex flex-col overflow-hidden shadow-bottom">
        <div className="px-4 py-3 border-b border-n40 flex items-center gap-2">
          <Share2 size={14} className="text-primary" />
          <span className="text-sm font-medium text-n700">共享资源</span>
          {resourceName && (
            <span className="ml-1 text-xs text-n100 truncate">— {resourceName}</span>
          )}
          <button onClick={onClose} className="ml-auto text-n100 hover:text-n700">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          <div>
            <div className="text-[10px] uppercase tracking-wider text-n100 mb-2">
              已共享 ({shares.length})
            </div>
            {loading ? (
              <div className="text-xs text-n100 py-2">加载中…</div>
            ) : shares.length === 0 ? (
              <div className="text-xs text-n100 py-2 px-3 bg-n30 border border-dashed border-n40 rounded">
                尚未共享给任何目标
              </div>
            ) : (
              <div className="space-y-1.5">
                {shares.map(s => (
                  <div key={s.share_id} className="flex items-center gap-2 px-3 py-2 bg-n30 border border-n40 rounded">
                    {s.share_target_type === 'org' ? (
                      <Building2 size={12} className="text-primary" />
                    ) : (
                      <FolderOpen size={12} className="text-success" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-n700 truncate">
                        {s.share_target_name || s.share_target_id}
                      </div>
                      <div className="text-[10px] text-n100">
                        {s.share_target_type === 'org' ? '整个组织' : '组织内项目'} · {new Date(s.granted_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(s)}
                      className="px-2 py-0.5 text-[10px] rounded bg-r50 hover:bg-r50 text-danger inline-flex items-center gap-1"
                    ><Trash2 size={10} />取消</button>
                  </div>
                ))}
              </div>
            )}
          </div>


          <div className="border-t border-n40 pt-3">
            <div className="text-[10px] uppercase tracking-wider text-n100 mb-2">添加共享</div>
            {organizations.length === 0 ? (
              <div className="text-xs text-n100 px-3 py-2 bg-n30 border border-dashed border-n40 rounded">
                你还没加入任何组织，无法共享资源。请联系管理员把你加入组织。
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={targetType === 'org'}
                      onChange={() => setTargetType('org')}
                    />
                    <span className="text-n700">整个组织</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer ml-3">
                    <input
                      type="radio"
                      checked={targetType === 'project'}
                      onChange={() => setTargetType('project')}
                    />
                    <span className="text-n700">组织内某项目</span>
                  </label>
                </div>

                <select
                  value={targetOrgId}
                  onChange={e => setTargetOrgId(e.target.value)}
                  className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs"
                >
                  <option value="">— 选择组织 —</option>
                  {organizations.map(o => (
                    <option key={o.org_id} value={o.org_id}>
                      {o.name}{o.my_role ? `（${o.my_role}）` : ''}
                    </option>
                  ))}
                </select>

                {targetType === 'project' && (
                  <select
                    value={targetProjectId}
                    onChange={e => setTargetProjectId(e.target.value)}
                    disabled={!targetOrgId}
                    className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs disabled:opacity-40"
                  >
                    <option value="">{targetOrgId ? '— 选择项目 —' : '— 先选组织 —'}</option>
                    {orgProjects.map(p => (
                      <option key={p.project_id} value={p.project_id}>
                        {p.project_name || p.name || p.project_id}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  onClick={handleAdd}
                  disabled={busy || !targetOrgId || (targetType === 'project' && !targetProjectId)}
                  className="w-full px-3 py-1.5 rounded bg-primary hover:bg-primary-hover text-white disabled:bg-n0 disabled:cursor-not-allowed text-xs inline-flex items-center justify-center gap-1"
                >
                  <Plus size={11} />{busy ? '共享中…' : '共享'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareResourceDialog;
