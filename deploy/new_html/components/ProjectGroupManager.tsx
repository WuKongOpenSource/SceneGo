import React, { useState } from 'react';
import { X } from 'lucide-react';
import { crmConfirm } from '../admin/crmUI';
import { deleteProjectGroup, saveProjectGroup, type ProjectGroup } from '../services/projectGroupService';

export function ProjectGroupSelect({ groups, value, onChange, disabled, currentName }: {
  groups: ProjectGroup[]; value: string; onChange: (value: string) => void; disabled?: boolean; currentName?: string | null;
}) {
  return (
    <label className="block text-sm text-n300">
      项目所属分组
      <select value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
        className="mt-1 h-10 w-full rounded border border-n40 bg-n0 px-3 text-n800 disabled:opacity-60">
        <option value="">未分组</option>
        {value && !groups.some(group => group.group_id === value) && <option value={value}>{currentName || '当前分组'}</option>}
        {groups.map(group => <option key={group.group_id} value={group.group_id}>{group.group_name}</option>)}
      </select>
    </label>
  );
}

export default function ProjectGroupManager({ groups, onChanged, onDeleted, onClose }: {
  groups: ProjectGroup[]; onChanged: () => Promise<void>; onDeleted: (groupId: string) => void; onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await saveProjectGroup(name, editing);
      setEditing(undefined); setName('');
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { setBusy(false); }
  };
  const remove = async (group: ProjectGroup) => {
    if (!await crmConfirm({ title: '删除项目分组', message: `删除「${group.group_name}」后，项目将保留并移至“未分组”。分组共享权限也将失效。`, type: 'danger', confirmText: '删除分组，保留项目' })) return;
    setBusy(true); setError('');
    try {
      await deleteProjectGroup(group.group_id);
      onDeleted(group.group_id);
      if (editing === group.group_id) { setEditing(undefined); setName(''); }
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败，请重试'); }
    finally { setBusy(false); }
  };
  return (
    <div className="app-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="管理项目分组">
      <div className="app-modal-surface w-full max-w-xl">
        <div className="app-modal-header">
          <h2 className="text-lg font-semibold">管理项目分组</h2>
          <button type="button" aria-label="关闭分组管理" disabled={busy} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="app-modal-body space-y-4">
          <p className="text-xs text-n200">分组用于归类多个项目。这里管理你拥有的分组，与后台同步；项目数包含归档项目，不含回收站项目。</p>
          <form onSubmit={save} className="rounded-lg border border-n40 bg-n10 p-3 space-y-2">
            <label className="block text-sm">{editing ? '重命名分组' : '新建分组'}
              <input aria-label="分组名称" value={name} onChange={event => setName(event.target.value)} disabled={busy}
                placeholder="例如：品牌短片、系列短剧" className="mt-1 w-full rounded border border-n40 bg-n0 p-2" />
            </label>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !name.trim()} className="rounded bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? '保存中…' : editing ? '保存分组名称' : '创建分组'}</button>
              {editing && <button type="button" disabled={busy} onClick={() => { setEditing(undefined); setName(''); }}>取消改名</button>}
            </div>
          </form>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="max-h-[40vh] overflow-auto space-y-2">
            {groups.map(group => <div key={group.group_id} className="flex items-center justify-between gap-3 rounded-lg border border-n40 p-3">
              <div className="min-w-0"><p className="truncate text-sm">{group.group_name}</p><p className="text-xs text-n200">{group.project_count || 0} 个项目</p></div>
              <div className="flex shrink-0 gap-3 text-xs">
                <button type="button" disabled={busy} className="text-primary" onClick={() => { setEditing(group.group_id); setName(group.group_name); setError(''); }}>重命名</button>
                <button type="button" disabled={busy} className="text-danger" onClick={() => { void remove(group); }}>删除分组</button>
              </div>
            </div>)}
            {!groups.length && <p className="text-sm text-n200">还没有分组。创建后，可在新建或编辑项目时选择归属。</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
