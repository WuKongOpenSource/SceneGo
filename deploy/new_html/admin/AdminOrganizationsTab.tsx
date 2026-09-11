






import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2, Plus, RefreshCw, Trash2, ChevronDown, ChevronRight, UserPlus, X,
} from 'lucide-react';
import {
  crmMessage, crmConfirm,
  CrmToolbar, CrmPrimaryButton, CrmTag, CrmActionLink, CrmTable,
} from './crmUI';

import {
  adminListOrganizations,
  adminCreateOrganization,
  adminDeleteOrganization,
  adminListMembers,
  adminAddMember,
  adminRemoveMember,
  adminSetMemberRole,
  Organization,
  OrganizationMember,
} from '../services/organizationService';
import { apiJson } from '../services/httpClient';




let _adminUsersCache: any[] | null = null;
async function fetchAdminUsersOnce(): Promise<any[]> {
  if (_adminUsersCache) return _adminUsersCache;
  const data = await apiJson<{ users: any[] }>('/api/admin/users?limit=500', { method: 'GET' }, 'Admin Users');
  _adminUsersCache = data?.users || [];
  return _adminUsersCache!;
}
function useAdminUsers() {
  const [users, setUsers] = useState<any[]>(_adminUsersCache || []);
  useEffect(() => {
    let alive = true;
    fetchAdminUsersOnce().then(us => { if (alive) setUsers(us); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return users;
}


async function readApiErr(err: any): Promise<string> {
  const raw = String(err?.message || err || '');
  const m = raw.match(/\{.*\}$/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.detail === 'string') return j.detail;
    } catch {}
  }
  return raw;
}


export const AdminOrganizationsTab: React.FC = () => {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | 'active' | 'archived'>('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOwner, setNewOwner] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const users = useAdminUsers();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminListOrganizations({
        status: statusFilter || undefined,
        keyword: keyword || undefined,
        limit: 200,
      });
      setOrgs(r.organizations || []);
    } catch (e: any) {
      console.warn('adminListOrganizations 失败', e);
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, [keyword, statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  const handleCreate = async () => {
    if (!newName.trim()) { crmMessage.error('请填写组织名称'); return; }
    if (!newOwner) { crmMessage.error('请选择 owner'); return; }
    setSubmitting(true);
    try {
      await adminCreateOrganization({
        name: newName.trim(),
        owner_user_id: newOwner,
        description: newDesc,
      });
      setShowCreate(false);
      setNewName(''); setNewOwner(''); setNewDesc('');
      reload();
    } catch (e: any) {
      crmMessage.error(`创建失败：${await readApiErr(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (org: Organization) => {
    if (!await crmConfirm({ title: '删除组织', message: `删除组织「${org.name}」？此操作会级联删除所有成员关系和资源共享，不可恢复。`, type: 'danger', confirmText: '删除' })) return;
    try {
      await adminDeleteOrganization(org.org_id);
      reload();
    } catch (e: any) {
      crmMessage.error(`删除失败：${await readApiErr(e)}`);
    }
  };

  return (
    <div>
      <CrmToolbar
        title="组织管理"
        count={orgs.length}
        filters={
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
                  className="bg-n0 border border-n40 rounded px-2 py-1.5 text-xs focus:border-primary focus:outline-none">
            <option value="">全部状态</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </select>
        }
        search={{ value: keyword, onChange: setKeyword, placeholder: '搜索名称 / 描述', onSearch: reload }}
        actions={<CrmPrimaryButton onClick={() => setShowCreate(true)}><Plus size={13} /> 创建组织</CrmPrimaryButton>}
      />

      <CrmTable headers={
        <tr>
          <th className="w-6"></th>
          <th className="text-left font-medium p-2.5">组织</th>
          <th className="text-left font-medium p-2.5">Owner</th>
          <th className="text-left font-medium p-2.5">成员数</th>
          <th className="text-left font-medium p-2.5">状态</th>
          <th className="text-left font-medium p-2.5">创建时间</th>
          <th className="text-right font-medium p-2.5">操作</th>
        </tr>
      }>
        {orgs.map(o => (
          <React.Fragment key={o.org_id}>
            <tr className="hover:bg-n10">
              <td className="p-2.5">
                <button onClick={() => setExpanded(expanded === o.org_id ? null : o.org_id)}
                        className="text-n100 hover:text-n700">
                  {expanded === o.org_id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </td>
              <td className="p-2.5">
                <div className="text-n800 font-medium">{o.name}</div>
                <div className="text-[10px] text-n100 font-mono">{o.org_id}</div>
                {o.description && <div className="text-[10px] text-n100">{o.description}</div>}
              </td>
              <td className="p-2.5 text-n700">{o.owner_name || o.owner_user_id}</td>
              <td className="p-2.5 text-n700">{o.member_count ?? '-'}</td>
              <td className="p-2.5"><CrmTag type={o.status === 'active' ? 'success' : 'default'}>{o.status}</CrmTag></td>
              <td className="p-2.5 text-n100 text-[10px]">
                {o.created_at ? new Date(o.created_at).toLocaleString('zh-CN') : '-'}
              </td>
              <td className="p-2.5 text-right">
                <CrmActionLink type="danger" onClick={() => handleDelete(o)}>删除</CrmActionLink>
              </td>
            </tr>
            {expanded === o.org_id && (
              <tr className="bg-n20">
                <td colSpan={7} className="p-3">
                  <MembersPanel orgId={o.org_id} ownerUserId={o.owner_user_id} users={users} />
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
        {!orgs.length && (
          <tr><td colSpan={7} className="text-center py-8 text-n100">
            {loading ? '加载中…' : '暂无组织 — 点右上角「创建组织」'}
          </td></tr>
        )}
      </CrmTable>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-n900/40 backdrop-blur-sm flex items-center justify-center"
             onClick={e => { if (e.target === e.currentTarget) setShowCreate(false); }}>
          <div className="bg-n0 border border-n40 rounded-lg w-96 shadow-bottom animate-scaleIn">
            <div className="flex justify-between items-center px-5 pt-4 pb-1">
              <div className="text-[15px] font-semibold text-n800">创建组织</div>
              <button onClick={() => setShowCreate(false)} className="text-n100 hover:text-n700"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-3 space-y-3">
              <div>
                <label className="block text-xs text-n300 mb-1">组织名称 *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="例如：内容运营组"
                       className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none" autoFocus />
              </div>
              <div>
                <label className="block text-xs text-n300 mb-1">Owner（成员管理员）*</label>
                <select value={newOwner} onChange={e => setNewOwner(e.target.value)}
                        className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none">
                  <option value="">— 选择 owner —</option>
                  {users.map(u => (
                    <option key={u.id || u.user_id} value={u.id || u.user_id}>
                      {u.username || u.email || u.user_id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-n300 mb-1">描述（可选）</label>
                <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)}
                          className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm h-20 focus:border-primary focus:outline-none" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-4">
              <button onClick={() => setShowCreate(false)}
                      className="px-3.5 py-1.5 rounded border border-n40 text-n700 hover:bg-n20 text-sm">取消</button>
              <button onClick={handleCreate} disabled={submitting}
                      className="px-3.5 py-1.5 rounded bg-primary hover:bg-primary-hover text-white text-sm disabled:opacity-60">
                {submitting ? '创建中…' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};




const MembersPanel: React.FC<{
  orgId: string;
  ownerUserId: string;
  users: any[];
}> = ({ orgId, ownerUserId, users }) => {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminListMembers(orgId);
      setMembers(r.members || []);
    } catch (e: any) {
      console.warn(`adminListMembers ${orgId} failed`, e);
      setMembers([]);
    } finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { reload(); }, [reload]);

  const handleAdd = async () => {
    if (!newUserId) { crmMessage.error('请选择用户'); return; }
    setSubmitting(true);
    try {
      await adminAddMember(orgId, { user_id: newUserId, role: newRole });
      setNewUserId('');
      reload();
    } catch (e: any) {
      crmMessage.error(`添加成员失败：${await readApiErr(e)}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (m: OrganizationMember) => {
    if (m.user_id === ownerUserId) {
      crmMessage.error('不能删除 owner — 请先转让 owner 角色');
      return;
    }
    if (!await crmConfirm({ title: '移除成员', message: `移除成员 ${m.username || m.user_id}？`, type: 'danger', confirmText: '移除' })) return;
    try {
      await adminRemoveMember(orgId, m.user_id);
      reload();
    } catch (e: any) {
      crmMessage.error(`删除失败：${await readApiErr(e)}`);
    }
  };

  const handleSetRole = async (m: OrganizationMember, role: 'owner' | 'admin' | 'member') => {
    if (role === m.role) return;
    try {
      await adminSetMemberRole(orgId, m.user_id, role);
      reload();
    } catch (e: any) {
      crmMessage.error(`改 role 失败：${await readApiErr(e)}`);
    }
  };

  const memberUserIds = new Set(members.map(m => m.user_id));
  const candidateUsers = users.filter(u => !memberUserIds.has(u.id || u.user_id));

  return (
    <div className="bg-n0 border border-n40 rounded p-3 space-y-3 shadow-card">
      <div className="flex items-center gap-2 text-xs text-n300">
        <UserPlus size={12} />
        <span>添加成员：</span>
        <select
          value={newUserId}
          onChange={e => setNewUserId(e.target.value)}
          className="bg-n0 border border-n40 rounded px-2 py-1 text-xs w-56"
        >
          <option value="">— 选择用户 —</option>
          {candidateUsers.map(u => (
            <option key={u.id || u.user_id} value={u.id || u.user_id}>
              {u.username || u.email || u.user_id}
            </option>
          ))}
        </select>
        <select
          value={newRole}
          onChange={e => setNewRole(e.target.value as 'admin' | 'member')}
          className="bg-n0 border border-n40 rounded px-2 py-1 text-xs"
        >
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button
          onClick={handleAdd}
          disabled={submitting}
          className="px-3 py-1 rounded bg-primary hover:bg-primary-hover text-white disabled:bg-n0 text-xs"
        >{submitting ? '添加中…' : '添加'}</button>
        <button
          onClick={reload}
          className="p-1 rounded bg-n0 hover:bg-n20"
          title="刷新"
        ><RefreshCw size={11} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      <table className="w-full text-xs">
        <thead className="bg-n20 text-n100">
          <tr>
            <th className="text-left p-2">用户名</th>
            <th className="text-left p-2">邮箱</th>
            <th className="text-left p-2">角色</th>
            <th className="text-left p-2">加入时间</th>
            <th className="text-left p-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.user_id} className="border-t border-n40">
              <td className="p-2">
                <div className="text-n700">{m.username || m.user_id}</div>
                <div className="text-[10px] text-n100 font-mono">{m.user_id}</div>
              </td>
              <td className="p-2 text-n300">{m.email || '-'}</td>
              <td className="p-2">
                <select
                  value={m.role}
                  onChange={e => handleSetRole(m, e.target.value as any)}
                  className="bg-n0 border border-n40 rounded px-1 py-0.5 text-xs"
                  disabled={m.user_id === ownerUserId && m.role === 'owner'}
                  title={m.user_id === ownerUserId ? 'owner 角色不能改（请先转让 owner）' : ''}
                >
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
              </td>
              <td className="p-2 text-n100 text-[10px]">
                {m.joined_at ? new Date(m.joined_at).toLocaleString('zh-CN') : '-'}
              </td>
              <td className="p-2">
                <button
                  onClick={() => handleRemove(m)}
                  disabled={m.user_id === ownerUserId}
                  title={m.user_id === ownerUserId ? '不能删除 owner' : ''}
                  className="px-2 py-0.5 text-[10px] rounded bg-r50 hover:bg-r75 text-danger disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center gap-1"
                ><Trash2 size={10} />移除</button>
              </td>
            </tr>
          ))}
          {!members.length && (
            <tr><td colSpan={5} className="text-center py-4 text-n100">
              {loading ? '加载成员…' : '暂无成员'}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};


export default AdminOrganizationsTab;
