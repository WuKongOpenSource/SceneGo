














import React, { useEffect, useState, useCallback, useRef } from 'react';
import { rechargeOrderStatus } from '../utils/rechargeOrderStatus';
import {
  Users, FolderTree, Coins, ScrollText, Image as ImageIcon,
  ShieldCheck, RefreshCw, Plus, Trash2, ToggleLeft, ToggleRight, KeyRound,
  X, Check, Building2, Settings2,
} from 'lucide-react';
import {
  adminListCreditRules, adminCreateCreditRule, adminUpdateCreditRule, adminDeleteCreditRule,
  CreditRule,
} from '../services/creditService';
import { apiJson } from '../services/httpClient';
import { getAdminRole, setAdminSession } from '@runtime/adminAuth';
import { PLATFORM_ROLE_OPTIONS, getPlatformRoleDescription } from '../utils/adminRoles';
import { formatChinaDateTime } from '../utils/dateTime';
import { getCreditTransactionReason } from '../utils/creditTransactionPresentation';
import {
  normalizeAdminCreditAdjustmentAmountInput,
  parseAdminCreditAdjustmentAmount,
} from '../utils/adminCreditAdjustment';
import AdminOrganizationsTab from '../admin/AdminOrganizationsTab';
import {
  crmMessage, crmConfirm, crmPrompt,
  CrmToolbar, CrmPrimaryButton, CrmTag, CrmActionLink, CrmActionSep, CrmPagination, CrmTable,
} from '../admin/crmUI';

// Admin requests share the main creator token and remain protected by server-side role checks.
async function apiGet<T>(url: string): Promise<T> {
  return apiJson<T>(url, { method: 'GET' }, 'Admin API');
}
async function apiPost<T>(url: string, body?: any): Promise<T> {
  return apiJson<T>(url, { method: 'POST', body: JSON.stringify(body || {}) }, 'Admin API');
}
async function apiPut<T>(url: string, body?: any): Promise<T> {
  return apiJson<T>(url, { method: 'PUT', body: JSON.stringify(body || {}) }, 'Admin API');
}
async function apiDelete<T>(url: string): Promise<T> {
  return apiJson<T>(url, { method: 'DELETE' }, 'Admin API');
}


async function readApiError(err: any): Promise<string> {
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


let _adminUsersCache: any[] | null = null;
let _adminUsersPromise: Promise<any[]> | null = null;
async function fetchAdminUsersOnce(): Promise<any[]> {
  if (_adminUsersCache) return _adminUsersCache;
  if (_adminUsersPromise) return _adminUsersPromise;
  _adminUsersPromise = (async () => {
    const r = await apiGet<{ users: any[] }>('/api/admin/users?limit=500');
    _adminUsersCache = r.users || [];
    return _adminUsersCache;
  })();
  return _adminUsersPromise;
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

type SubTab = 'accounts' | 'groups' | 'organizations' | 'credit_rules' | 'credit_accounts' | 'credit_transactions' | 'recharge_orders' | 'media' | 'audit';

const SUB_TABS: { key: SubTab; label: string; icon: React.ReactNode }[] = [
  { key: 'accounts',            label: '账号管理',    icon: <Users size={14} /> },
  { key: 'groups',              label: '项目分组',    icon: <FolderTree size={14} /> },
  { key: 'organizations',       label: '组织管理',    icon: <Building2 size={14} /> },
  { key: 'credit_rules',        label: '创作点数规则',    icon: <Coins size={14} /> },
  { key: 'credit_accounts',     label: '创作点数账户',    icon: <Coins size={14} /> },
  { key: 'credit_transactions', label: '创作点数台账',    icon: <ScrollText size={14} /> },
  { key: 'recharge_orders',     label: '充值台账',        icon: <Coins size={14} /> },
  { key: 'media',               label: '素材库管理',  icon: <ImageIcon size={14} /> },
  { key: 'audit',               label: '审计日志',    icon: <ShieldCheck size={14} /> },
];

export const AdminFeatureTabs: React.FC<{ embedTab?: SubTab }> = ({ embedTab }) => {


  const [tab, setTab] = useState<SubTab>(embedTab ?? 'accounts');
  useEffect(() => { if (embedTab) setTab(embedTab); }, [embedTab]);

  return (
    <div className="h-full flex flex-col">
      {!embedTab && (
      <div className="ui-tabs">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="ui-tab"
            aria-pressed={tab === t.key}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'organizations' && <AdminOrganizationsTab />}
        {tab === 'credit_rules' && <CreditRulesTab />}
        {tab === 'credit_accounts' && <CreditAccountsTab />}
        {tab === 'credit_transactions' && <CreditTransactionsTab />}
        {tab === 'recharge_orders' && <RechargeOrdersTab />}
        {tab === 'media' && <MediaLibraryAdminTab />}
        {tab === 'audit' && <AuditLogsTab />}
      </div>
    </div>
  );
};



const PAGE_SIZE = 10;

const AccountsTab: React.FC = () => {
  const canManageRoles = getAdminRole() === 'super_admin';
  const [users, setUsers] = useState<any[]>([]);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cu, setCu] = useState({ username: '', password: '', email: '', role: 'user' });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (keyword) sp.set('keyword', keyword);
      if (statusFilter) sp.set('status_filter', statusFilter);
      sp.set('limit', '200');
      const r = await apiGet<{ users: any[] }>(`/api/admin/users?${sp.toString()}`);
      setUsers(r.users || []);
      setPage(1);
    } finally { setLoading(false); }
  }, [keyword, statusFilter]);

  useEffect(() => { reload(); }, [reload]);

  const handleDisable = async (uid: string) => {
    const reason = await crmPrompt({ title: '禁用用户', label: '禁用原因', placeholder: '选填，将记录到账号' });
    if (reason === null) return;
    try { await apiPost(`/api/admin/users/${uid}/disable`, { reason }); crmMessage.success('已禁用'); reload(); }
    catch (e: any) { crmMessage.error(`禁用失败：${await readApiError(e)}`); }
  };
  const handleEnable = async (uid: string) => {
    if (!await crmConfirm({ title: '启用用户', message: '确认启用该账号？', type: 'info', confirmText: '启用' })) return;
    try { await apiPost(`/api/admin/users/${uid}/enable`); crmMessage.success('已启用'); reload(); }
    catch (e: any) { crmMessage.error(`启用失败：${await readApiError(e)}`); }
  };
  const handleResetPassword = async (uid: string, uname: string) => {
    const pw = await crmPrompt({ title: `重置密码 — ${uname}`, label: '新密码（至少 8 位）', inputType: 'text', required: true });
    if (pw === null) return;
    if (pw.length < 8) { crmMessage.error('密码至少 8 位'); return; }
    try { await apiPost(`/api/admin/users/${uid}/reset-password`, { new_password: pw }); crmMessage.success('密码已重置'); }
    catch (e: any) { crmMessage.error(`重置失败：${await readApiError(e)}`); }
  };
  const handleRenameUser = async (uid: string, currentUsername: string) => {
    if (uid === 'admin') {
      crmMessage.warning('内置 admin 账号的用户名不可修改');
      return;
    }
    const value = await crmPrompt({
      title: `修改用户名 — ${currentUsername}`,
      label: '新用户名（2-40 位中文、字母、数字、下划线或连字符）',
      defaultValue: currentUsername,
      required: true,
      confirmText: '保存',
    });
    if (value === null) return;
    const nextUsername = value.trim();
    if (nextUsername === currentUsername) return;
    if (!/^[A-Za-z0-9_\-\u4e00-\u9fff]{2,40}$/.test(nextUsername)) {
      crmMessage.error('用户名需为 2-40 位中文、字母、数字、下划线或连字符');
      return;
    }
    try {
      const result = await apiPut<{
        changed: boolean;
        user: { username: string };
        session?: { username: string; role?: string };
      }>(`/api/admin/users/${uid}/username`, { username: nextUsername });
      if (result.session) {
        setAdminSession(result.session.username, result.session.role);
      }
      _adminUsersCache = null;
      _adminUsersPromise = null;
      crmMessage.success(`用户名已修改为 ${result.user.username}`);
      reload();
    } catch (e: any) {
      crmMessage.error(`修改用户名失败：${await readApiError(e)}`);
    }
  };
  const handleSetRole = async (uid: string, role: string) => {
    try { await apiPut(`/api/admin/users/${uid}`, { role }); crmMessage.success('角色已更新'); reload(); }
    catch (e: any) { crmMessage.error(`更新失败：${await readApiError(e)}`); }
  };
  const handleCreate = async () => {
    if (!cu.username.trim()) { crmMessage.error('请输入用户名'); return; }
    if (!cu.password || cu.password.length < 8) { crmMessage.error('密码至少 8 位'); return; }
    setCreating(true);
    try {
      await apiPost('/api/admin/users', {
        username: cu.username.trim(),
        password: cu.password,
        email: cu.email.trim() || undefined,
        role: cu.role,
      });
      crmMessage.success('用户已创建');
      setCreateOpen(false);
      setCu({ username: '', password: '', email: '', role: 'user' });
      reload();
    } catch (e: any) {
      crmMessage.error(`创建用户失败：${await readApiError(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const pageRows = users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <CrmToolbar
        title="账号管理"
        count={users.length}
        filters={
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                  className="bg-n0 border border-n40 rounded px-2 py-1.5 text-xs focus:border-primary focus:outline-none">
            <option value="">全部状态</option>
            <option value="active">active</option>
            <option value="disabled">disabled</option>
          </select>
        }
        search={{ value: keyword, onChange: setKeyword, placeholder: '搜索用户名 / 手机号 / 邮箱', onSearch: reload }}
        actions={<CrmPrimaryButton onClick={() => setCreateOpen(true)}><Plus size={13} /> 新建用户</CrmPrimaryButton>}
      />

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {PLATFORM_ROLE_OPTIONS.map(item => (
          <div key={item.value} className="rounded-md border border-n40 bg-n0 px-3 py-2">
            <div className="text-xs font-semibold text-n700">{item.label}</div>
            <div className="mt-1 text-[11px] leading-4 text-n200">{item.description}</div>
          </div>
        ))}
      </div>

      <CrmTable headers={
        <tr>
          <th className="text-left font-medium p-2.5">用户</th>
          <th className="text-left font-medium p-2.5">手机号</th>
          <th className="text-left font-medium p-2.5">邮箱</th>
          <th className="text-left font-medium p-2.5">角色</th>
          <th className="text-left font-medium p-2.5">状态</th>
          <th className="text-left font-medium p-2.5">最近登录</th>
          <th className="text-right font-medium p-2.5">操作</th>
        </tr>
      }>
        {pageRows.map(u => {
          const active = (u.status || 'active') === 'active';
          return (
            <tr key={u.user_id} className="hover:bg-n10">
              <td className="p-2.5">
                <div className="text-n800">{u.username}</div>
                <div className="text-[10px] text-n100 font-mono">{u.user_id}</div>
              </td>
              <td className="p-2.5 text-n300 font-mono text-xs whitespace-nowrap">{u.phone_number || '-'}</td>
              <td className="p-2.5 text-n300">{u.email || '-'}</td>
              <td className="p-2.5">
                <select value={u.role || 'user'} onChange={e => handleSetRole(u.user_id, e.target.value)}
                        disabled={!canManageRoles}
                        title={canManageRoles ? getPlatformRoleDescription(u.role) : '只有超级管理员可以调整平台角色'}
                        className="bg-n0 border border-n40 rounded px-1.5 py-1 text-xs focus:border-primary focus:outline-none disabled:bg-n20 disabled:text-n200">
                  {PLATFORM_ROLE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </td>
              <td className="p-2.5">
                <CrmTag type={active ? 'success' : 'danger'}>{u.status || 'active'}</CrmTag>
                {u.disabled_reason && <div className="text-[10px] text-danger mt-0.5">{u.disabled_reason}</div>}
              </td>
              <td className="p-2.5 text-n100 text-[11px]">
                {(u.last_login_at || u.lastLogin)
                  ? formatChinaDateTime(u.last_login_at || u.lastLogin)
                  : '-'}
              </td>
              <td className="p-2.5 text-right whitespace-nowrap">
                <CrmActionLink
                  type="default"
                  disabled={u.user_id === 'admin' || (!canManageRoles && u.role !== 'user')}
                  title={u.user_id === 'admin' ? '内置 admin 账号用户名不可修改' : (!canManageRoles && u.role !== 'user' ? '只有超级管理员可以管理管理员账号' : '修改登录用户名')}
                  onClick={() => handleRenameUser(u.user_id, u.username)}
                >修改用户名</CrmActionLink>
                <CrmActionSep />
                {active
                  ? <CrmActionLink type="danger" disabled={!canManageRoles && u.role !== 'user'} onClick={() => handleDisable(u.user_id)}>禁用</CrmActionLink>
                  : <CrmActionLink type="primary" disabled={!canManageRoles && u.role !== 'user'} onClick={() => handleEnable(u.user_id)}>启用</CrmActionLink>}
                <CrmActionSep />
                <CrmActionLink type="default" disabled={!canManageRoles && u.role !== 'user'} onClick={() => handleResetPassword(u.user_id, u.username)}>重置密码</CrmActionLink>
              </td>
            </tr>
          );
        })}
        {!pageRows.length && (
          <tr><td colSpan={7} className="text-center py-8 text-n100">{loading ? '加载中…' : '暂无数据'}</td></tr>
        )}
      </CrmTable>

      <CrmPagination total={users.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-n900/40 backdrop-blur-sm flex items-center justify-center"
             onClick={e => { if (e.target === e.currentTarget) setCreateOpen(false); }}>
          <div className="bg-n0 border border-n40 rounded-lg w-96 shadow-bottom animate-scaleIn">
            <div className="flex justify-between items-center px-5 pt-4 pb-1">
              <div className="text-[15px] font-semibold text-n800">新建用户</div>
              <button onClick={() => setCreateOpen(false)} className="text-n100 hover:text-n700"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-3 space-y-3">
              <div>
                <label className="block text-xs text-n300 mb-1">用户名 *</label>
                <input value={cu.username} onChange={e => setCu({ ...cu, username: e.target.value })} placeholder="登录用户名"
                       className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none" autoFocus />
              </div>
              <div>
                <label className="block text-xs text-n300 mb-1">密码 *</label>
                <input type="text" value={cu.password} onChange={e => setCu({ ...cu, password: e.target.value })} placeholder="至少 8 位"
                       className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-n300 mb-1">邮箱（可选）</label>
                <input value={cu.email} onChange={e => setCu({ ...cu, email: e.target.value })} placeholder="留空则自动生成 用户名@studio.com"
                       className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-n300 mb-1">角色</label>
                <select value={cu.role} onChange={e => setCu({ ...cu, role: e.target.value })}
                        disabled={!canManageRoles}
                        className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none disabled:bg-n20">
                  {PLATFORM_ROLE_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <div className="mt-1 text-[11px] text-n200">{getPlatformRoleDescription(cu.role)}</div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-4">
              <button onClick={() => setCreateOpen(false)}
                      className="px-3.5 py-1.5 rounded border border-n40 text-n700 hover:bg-n20 text-sm">取消</button>
              <button onClick={handleCreate} disabled={creating}
                      className="px-3.5 py-1.5 rounded bg-primary hover:bg-primary-hover text-white text-sm disabled:opacity-60">
                {creating ? '创建中…' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};



const GroupsTab: React.FC = () => {
  const [groups, setGroups] = useState<any[]>([]);
  const groupsRequest = useRef(0);
  const [projectView, setProjectView] = useState<{ groupId: string | null; title: string; projects: any[] } | null>(null);
  const projectViewRef = useRef(projectView);
  projectViewRef.current = projectView;
  const projectRequest = useRef(0);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUserId, setNewUserId] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const users = useAdminUsers();

  const reload = useCallback(async () => {
    const request = ++groupsRequest.current;
    setLoading(true);
    try {
      const r = await apiGet<{ groups: any[] }>('/api/admin/project-groups');
      if (request !== groupsRequest.current) return;
      setGroups(r.groups || []);
      setPage(1);
    } catch (error) {
      if (request === groupsRequest.current) crmMessage.error(`加载项目分组失败：${await readApiError(error)}`);
    } finally { if (request === groupsRequest.current) setLoading(false); }
  }, []);

  const showProjects = useCallback(async (group?: { group_id: string; group_name: string }) => {
    const request = ++projectRequest.current;
    setProjectsLoading(true);
    try {
      const result = await apiGet<{ group?: { group_name: string }; projects: any[] }>(group
        ? `/api/admin/project-groups/${encodeURIComponent(group.group_id)}/projects`
        : '/api/admin/ungrouped-projects');
      if (request !== projectRequest.current) return;
      setProjectView({ groupId: group?.group_id || null, title: result.group?.group_name || group?.group_name || '未分组', projects: result.projects || [] });
    } catch (error) {
      if (request === projectRequest.current) crmMessage.error(`加载组内项目失败：${await readApiError(error)}`);
    } finally { if (request === projectRequest.current) setProjectsLoading(false); }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => {
      void reload();
      const view = projectViewRef.current;
      if (view) void showProjects(view.groupId ? { group_id: view.groupId, group_name: view.title } : undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('focus', onFocus); projectRequest.current += 1; groupsRequest.current += 1; };
  }, [reload, showProjects]);

  const closeProjects = () => {
    projectRequest.current += 1;
    setProjectView(null);
    setProjectsLoading(false);
  };

  const handleCreate = async () => {
    if (!newUserId) { crmMessage.error('请先选择归属用户'); return; }
    if (!newName.trim()) { crmMessage.error('请输入分组名称'); return; }
    setSubmitting(true);
    try {
      await apiPost('/api/admin/project-groups', { user_id: newUserId, group_name: newName.trim(), description: newDesc });
      crmMessage.success('分组已创建');
      setNewName(''); setNewDesc(''); setNewUserId(''); setCreateOpen(false);
      reload();
    } catch (e: any) {
      crmMessage.error(`创建分组失败：${await readApiError(e)}`);
    } finally {
      setSubmitting(false);
    }
  };
  const handleDelete = async (gid: string) => {
    if (!await crmConfirm({ title: '删除分组', message: '删除后项目将保留并移至「未分组」，分组共享权限也将失效。继续？', type: 'danger', confirmText: '删除分组，保留项目' })) return;
    try {
      await apiDelete(`/api/admin/project-groups/${gid}`);
      crmMessage.success('已删除');
      reload();
    } catch (e: any) {
      crmMessage.error(`删除失败：${await readApiError(e)}`);
    }
  };

  const handleRenameGroup = async (group: any) => {
    const value = await crmPrompt({
      title: '重命名项目分组', label: '分组名称（1-255 个字符）',
      defaultValue: group.group_name, required: true, confirmText: '保存',
    });
    if (value === null) return;
    const groupName = value.trim();
    if (!groupName || Array.from(groupName).length > 255) {
      crmMessage.error('分组名称需为 1-255 个字符');
      return;
    }
    if (groupName === group.group_name) return;
    try {
      const result = await apiPut<{ group: any }>(
        `/api/admin/project-groups/${encodeURIComponent(group.group_id)}`, { group_name: groupName },
      );
      setGroups(previous => previous.map(item => item.group_id === group.group_id ? { ...item, ...result.group } : item));
      crmMessage.success('分组已重命名，关联项目保持不变');
    } catch (error) {
      crmMessage.error(`重命名失败：${await readApiError(error)}`);
    }
  };

  const pageRows = groups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <CrmToolbar
        title="项目分组"
        count={groups.length}
        actions={<>
          <CrmActionLink onClick={() => { void reload(); }}>刷新</CrmActionLink>
          <CrmActionLink disabled={projectsLoading} onClick={() => { void showProjects(); }}>查看未分组项目</CrmActionLink>
          <CrmPrimaryButton onClick={() => setCreateOpen(true)}><Plus size={13} /> 新建分组</CrmPrimaryButton>
        </>}
      />
      <p className="mb-3 text-xs text-n200">分组用于归类项目，不是单个项目。与前台「项目分组」共用名称和归属；项目数包含归档项目，不含回收站项目。</p>

      <CrmTable headers={
        <tr>
          <th className="text-left font-medium p-2.5">分组</th>
          <th className="text-left font-medium p-2.5">归属</th>
          <th className="text-left font-medium p-2.5">项目数</th>
          <th className="text-left font-medium p-2.5">创建</th>
          <th className="text-right font-medium p-2.5">操作</th>
        </tr>
      }>
        {pageRows.map(g => (
          <tr key={g.group_id} className="hover:bg-n10">
            <td className="p-2.5">
              <button type="button" className="text-left text-primary hover:underline" disabled={projectsLoading} onClick={() => { void showProjects(g); }}>{g.group_name}</button>
              <div className="text-[10px] text-n100 font-mono">{g.group_id}</div>
              {g.description && <div className="text-[10px] text-n100">{g.description}</div>}
            </td>
            <td className="p-2.5 text-n300">{g.owner_name || g.user_id || '-'}</td>
            <td className="p-2.5 text-n700">
              <button type="button" className="text-primary hover:underline" disabled={projectsLoading} onClick={() => { void showProjects(g); }}>
                {g.project_count ?? 0} 个项目 · 查看
              </button>
            </td>
            <td className="p-2.5 text-n100">{g.created_at ? new Date(g.created_at).toLocaleString('zh-CN') : '-'}</td>
            <td className="p-2.5 text-right">
              <CrmActionLink onClick={() => handleRenameGroup(g)}>重命名</CrmActionLink>
              <CrmActionSep />
              <CrmActionLink type="danger" onClick={() => handleDelete(g.group_id)}>删除</CrmActionLink>
            </td>
          </tr>
        ))}
        {!pageRows.length && <tr><td colSpan={5} className="text-center py-8 text-n100">{loading ? '加载中…' : '暂无分组'}</td></tr>}
      </CrmTable>

      <CrmPagination total={groups.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />

      {projectView && (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="分组内项目">
          <div className="app-modal-surface w-full max-w-2xl">
            <div className="app-modal-header">
              <h2 className="font-semibold">项目分组 / {projectView.title}</h2>
              <button type="button" aria-label="关闭组内项目" onClick={closeProjects}><X size={18} /></button>
            </div>
            <div className="app-modal-body max-h-[60vh] overflow-auto space-y-3">
              <p className="text-xs text-n200">共 {projectView.projects.length} 个项目。点击项目名称打开前台项目，调整归属请使用前台「编辑项目」。</p>
              {projectView.projects.map(project => (
                <div key={project.project_id} className="rounded-lg border border-n40 p-3">
                  <a className="text-primary hover:underline" href={`/projects/${encodeURIComponent(project.project_id)}`} target="_blank" rel="noopener noreferrer">{project.project_name}</a>
                  <div className="mt-1 text-xs text-n200">归属：{project.owner_name || project.user_id} · {project.is_archived ? '已归档' : '进行中'}</div>
                </div>
              ))}
              {!projectView.projects.length && <p className="py-6 text-center text-n200">该分组暂无项目</p>}
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-50 bg-n900/40 backdrop-blur-sm flex items-center justify-center"
             onClick={e => { if (e.target === e.currentTarget) setCreateOpen(false); }}>
          <div className="bg-n0 border border-n40 rounded-lg w-96 shadow-bottom animate-scaleIn">
            <div className="flex justify-between items-center px-5 pt-4 pb-1">
              <div className="text-[15px] font-semibold text-n800">新建分组</div>
              <button onClick={() => setCreateOpen(false)} className="text-n100 hover:text-n700"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-3 space-y-3">
              <div>
                <label className="block text-xs text-n300 mb-1">归属用户 *</label>
                <select value={newUserId} onChange={e => setNewUserId(e.target.value)}
                        className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none">
                  <option value="">— 选择归属用户 —</option>
                  {users.map(u => (
                    <option key={u.id || u.user_id} value={u.id || u.user_id}>
                      {u.username || u.email || u.user_id} · {(u.id || u.user_id || '').slice(0, 8)}…
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-n300 mb-1">分组名称 *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="分组名称"
                       className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-n300 mb-1">描述（可选）</label>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="描述"
                       className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-4">
              <button onClick={() => setCreateOpen(false)}
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



const CreditRulesTab: React.FC = () => {
  const [rules, setRules] = useState<CreditRule[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try { const r = await adminListCreditRules(); setRules(r.rules || []); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleToggleEnabled = async (rule: CreditRule) => {
    await adminUpdateCreditRule(rule.rule_id, { enabled: !rule.enabled });
    reload();
  };
  const handleSaveCost = async (rule: CreditRule, updates: Partial<CreditRule>) => {
    await adminUpdateCreditRule(rule.rule_id, updates);
    reload();
  };
  const handleDelete = async (rule: CreditRule) => {
    if (!await crmConfirm({ title: '删除规则', message: `确认删除规则 ${rule.feature_key}？`, type: 'danger', confirmText: '删除' })) return;
    try { await adminDeleteCreditRule(rule.rule_id); crmMessage.success('已删除'); reload(); }
    catch (e: any) { crmMessage.error(`删除失败：${await readApiError(e)}`); }
  };
  const handleCreate = async () => {
    const fk = await crmPrompt({ title: '新建规则', label: 'feature_key', defaultValue: 'image_generation', required: true });
    if (!fk) return;
    const fn = await crmPrompt({ title: '新建规则', label: '显示名称', defaultValue: fk });
    if (fn === null) return;
    const baseStr = await crmPrompt({ title: '新建规则', label: 'base_cost（创作点数）', inputType: 'number', defaultValue: '10' });
    if (baseStr === null) return;
    try {
      await adminCreateCreditRule({ feature_key: fk, feature_name: fn || fk, base_cost: Number(baseStr || 10) });
      crmMessage.success('规则已创建'); reload();
    } catch (e: any) { crmMessage.error(`创建失败：${await readApiError(e)}`); }
  };

  return (
    <div>
      <CrmToolbar
        title="创作点数规则"
        count={rules.length}
        actions={<CrmPrimaryButton onClick={handleCreate}><Plus size={13} /> 新建规则</CrmPrimaryButton>}
      />
      <CrmTable headers={
        <tr>
          <th className="text-left font-medium p-2.5">feature_key</th>
          <th className="text-left font-medium p-2.5">名称</th>
          <th className="text-left font-medium p-2.5">启用</th>
          <th className="w-24 text-center font-medium p-2.5">base</th>
          <th className="w-24 text-center font-medium p-2.5">min</th>
          <th className="w-24 text-center font-medium p-2.5">max</th>
          <th className="text-left font-medium p-2.5">version</th>
          <th className="text-right font-medium p-2.5">操作</th>
        </tr>
      }>
        {rules.map(r => (
          <CreditRuleRow key={r.rule_id} rule={r} onToggle={() => handleToggleEnabled(r)} onSave={handleSaveCost} onDelete={() => handleDelete(r)} />
        ))}
        {!rules.length && <tr><td colSpan={8} className="text-center py-8 text-n100">{loading ? '加载中…' : '暂无规则'}</td></tr>}
      </CrmTable>
    </div>
  );
};

const CreditRuleRow: React.FC<{
  rule: CreditRule;
  onToggle: () => void;
  onSave: (rule: CreditRule, updates: Partial<CreditRule>) => Promise<void>;
  onDelete: () => void;
}> = ({ rule, onToggle, onSave, onDelete }) => {
  const [base, setBase] = useState(rule.base_cost);
  const [min_, setMin] = useState(rule.min_cost);
  const [max_, setMax] = useState<number | null>(rule.max_cost);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [billingUnit, setBillingUnit] = useState(rule.billing_unit || 'task');
  const [description, setDescription] = useState(rule.description || '');
  const [factorsText, setFactorsText] = useState(JSON.stringify(rule.factors || [], null, 2));

  const saveRule = async () => {
    let factors: any[];
    try {
      const parsed = JSON.parse(factorsText || '[]');
      if (!Array.isArray(parsed)) throw new Error('动态因子必须是 JSON 数组');
      factors = parsed;
    } catch (error) {
      crmMessage.error(error instanceof Error ? error.message : '动态因子 JSON 格式错误');
      return;
    }
    try {
      await onSave(rule, {
        base_cost: base,
        min_cost: min_,
        max_cost: max_,
        billing_unit: billingUnit,
        description,
        factors,
      });
      crmMessage.success('计费规则已保存');
    } catch (error: any) {
      crmMessage.error(`保存失败：${await readApiError(error)}`);
    }
  };
  return (
    <>
      <tr className="hover:bg-n10">
        <td className="p-2.5 font-mono text-[10px] text-n700">{rule.feature_key}</td>
        <td className="p-2.5 text-n800">{rule.feature_name}</td>
        <td className="p-2.5">
          <button onClick={onToggle}>
            {rule.enabled ? <ToggleRight size={20} className="text-success" /> : <ToggleLeft size={20} className="text-n100" />}
          </button>
        </td>
        <td className="w-24 p-2.5 text-center"><input type="number" value={base} onChange={e => setBase(Number(e.target.value))} className="mx-auto block w-16 bg-n0 border border-n40 rounded px-1 py-0.5 text-center text-xs focus:border-primary focus:outline-none" /></td>
        <td className="w-24 p-2.5 text-center"><input type="number" value={min_} onChange={e => setMin(Number(e.target.value))} className="mx-auto block w-16 bg-n0 border border-n40 rounded px-1 py-0.5 text-center text-xs focus:border-primary focus:outline-none" /></td>
        <td className="w-24 p-2.5 text-center"><input type="number" value={max_ ?? ''} placeholder="∞" onChange={e => setMax(e.target.value ? Number(e.target.value) : null)} className="mx-auto block w-16 bg-n0 border border-n40 rounded px-1 py-0.5 text-center text-xs focus:border-primary focus:outline-none" /></td>
        <td className="p-2.5 text-n100 text-[10px]">{rule.rule_version}</td>
        <td className="p-2.5 text-right whitespace-nowrap">
          <button type="button" onClick={() => setAdvancedOpen(value => !value)} className="inline-flex items-center gap-1 text-[11px] text-n500 hover:text-primary">
            <Settings2 size={12} /> 计费逻辑
          </button>
          <CrmActionSep />
          <CrmActionLink type="primary" onClick={saveRule}>保存</CrmActionLink>
          <CrmActionSep />
          <CrmActionLink type="danger" onClick={onDelete}>删除</CrmActionLink>
        </td>
      </tr>
      {advancedOpen && (
        <tr className="bg-n10">
          <td colSpan={8} className="border-t border-n40 p-3">
            <div className="grid gap-3 lg:grid-cols-[160px_1fr]">
              <label className="text-xs text-n500">
                计费单位
                <input value={billingUnit} onChange={event => setBillingUnit(event.target.value)} className="mt-1 h-8 w-full rounded border border-n40 bg-n0 px-2 text-xs text-n800 focus:border-primary focus:outline-none" />
              </label>
              <label className="text-xs text-n500">
                规则说明
                <input value={description} onChange={event => setDescription(event.target.value)} className="mt-1 h-8 w-full rounded border border-n40 bg-n0 px-2 text-xs text-n800 focus:border-primary focus:outline-none" />
              </label>
            </div>
            <label className="mt-3 block text-xs text-n500">
              动态因子 JSON
              <textarea value={factorsText} onChange={event => setFactorsText(event.target.value)} rows={7} className="mt-1 w-full resize-y rounded border border-n40 bg-n0 p-2 font-mono text-[11px] leading-5 text-n800 focus:border-primary focus:outline-none" />
            </label>
            <p className="mt-1 text-[10px] leading-5 text-n300">
              支持 per_unit_add（按每千 Token 等阶梯累加）、linear_add（按镜头数线性累加）、enum/range/multiplier（倍率）。剧本规则可使用 input_tokens、output_tokens、model；镜头设计还可使用 shot_count。
            </p>
          </td>
        </tr>
      )}
    </>
  );
};



const CreditAccountsTab: React.FC = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [adjustOpen, setAdjustOpen] = useState<{ owner_id: string; owner: string } | null>(null);
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ accounts: any[] }>('/api/admin/credit-accounts');
      setAccounts(r.accounts || []);
      setPage(1);
    } catch (e: any) {
      console.warn('Slice 5 admin credit-accounts 接口或许尚未上线:', e?.message);
      setAccounts([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const openAdjustment = (account: { owner_id: string; owner_type: string }) => {
    setAmountText('');
    setReason('');
    setAdjustOpen({ owner_id: account.owner_id, owner: `${account.owner_type}/${account.owner_id}` });
  };

  const closeAdjustment = () => {
    if (submitting) return;
    setAdjustOpen(null);
    setAmountText('');
    setReason('');
  };

  const submitAdjust = async () => {
    const amount = parseAdminCreditAdjustmentAmount(amountText);
    if (!adjustOpen || amount === null || !reason.trim()) { crmMessage.error('需要金额（非 0 整数）和理由'); return; }
    setSubmitting(true);
    try {
      await apiPost(`/api/admin/credit-accounts/${adjustOpen.owner_id}/adjust`, { delta: amount, reason });
      crmMessage.success('调整成功');
      setAdjustOpen(null); setAmountText(''); setReason('');
      reload();
    } catch (e: any) {
      crmMessage.error(`调整失败：${await readApiError(e)}`);
    } finally { setSubmitting(false); }
  };

  const pageRows = accounts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <CrmToolbar title="创作点数账户" count={accounts.length} />
      <CrmTable headers={
        <tr>
          <th className="text-left font-medium p-2.5">账户</th>
          <th className="text-left font-medium p-2.5">用户名</th>
          <th className="text-left font-medium p-2.5">归属</th>
          <th className="text-right font-medium p-2.5">可用</th>
          <th className="text-right font-medium p-2.5">账户点数</th>
          <th className="text-right font-medium p-2.5">赠送点数</th>
          <th className="text-right font-medium p-2.5">冻结</th>
          <th className="text-right font-medium p-2.5">累计消耗</th>
          <th className="text-right font-medium p-2.5">操作</th>
        </tr>
      }>
        {pageRows.map(a => (
          <tr key={a.account_id} className="hover:bg-n10">
            <td className="p-2.5 font-mono text-[10px]">{a.account_id}</td>
            <td className="p-2.5 text-n800">{a.owner_type === 'user' && a.owner_username?.trim() ? a.owner_username : '—'}</td>
            <td className="p-2.5 text-n800">{a.owner_type}/{a.owner_id}</td>
            <td className="p-2.5 text-right font-mono text-success">{a.available_credits}</td>
            <td className="p-2.5 text-right font-mono text-n700">{a.account_credits ?? a.available_credits}</td>
            <td className="p-2.5 text-right font-mono text-warning">{a.gift_credits ?? 0}</td>
            <td className="p-2.5 text-right font-mono text-warning">{a.frozen_credits}</td>
            <td className="p-2.5 text-right font-mono text-n300">{a.total_used_credits}</td>
            <td className="p-2.5 text-right">
              <CrmActionLink type="primary" disabled={a.owner_type !== 'user'}
                title={a.owner_type !== 'user' ? '当前只支持调整 user 账户' : ''}
                onClick={() => openAdjustment(a)}>
                手动调整
              </CrmActionLink>
            </td>
          </tr>
        ))}
        {!pageRows.length && <tr><td colSpan={9} className="text-center py-8 text-n100">{loading ? '加载中…' : '暂无账户'}</td></tr>}
      </CrmTable>

      <CrmPagination total={accounts.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />

      {adjustOpen && (
        <div className="fixed inset-0 z-50 bg-n900/40 backdrop-blur-sm flex items-center justify-center">
          <div role="dialog" aria-modal="true" aria-labelledby="credit-adjustment-title" className="bg-n0 border border-n40 rounded-lg w-96 shadow-bottom animate-scaleIn">
            <div className="flex justify-between items-center px-5 pt-4 pb-1">
              <div id="credit-adjustment-title" className="text-[15px] font-semibold text-n800">手动调整 — {adjustOpen.owner}</div>
              <button type="button" onClick={closeAdjustment} disabled={submitting} aria-label="关闭手动调整窗口" className="text-n100 hover:text-n700 disabled:opacity-50"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-3 space-y-3">
              <div className="text-xs text-n300">正数 = 充值/赠送，负数 = 扣减。需要管理员审计理由。</div>
              <div>
                <label className="block text-xs text-n300 mb-1">金额 *</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={amountText}
                  onChange={event => {
                    if (/^-?\d*$/.test(event.target.value)) {
                      setAmountText(normalizeAdminCreditAdjustmentAmountInput(event.target.value));
                    }
                  }}
                  onFocus={event => event.currentTarget.select()}
                  placeholder="正/负整数"
                  aria-label="调整金额"
                       className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs text-n300 mb-1">调整理由 *</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="必填，用于审计"
                          className="w-full bg-n0 border border-n40 rounded px-2.5 py-1.5 text-sm h-20 focus:border-primary focus:outline-none" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 pb-4">
              <button type="button" onClick={closeAdjustment} disabled={submitting}
                      className="px-3.5 py-1.5 rounded border border-n40 text-n700 hover:bg-n20 text-sm disabled:opacity-50">取消</button>
              <button type="button" onClick={submitAdjust} disabled={submitting}
                      className="px-3.5 py-1.5 rounded bg-primary hover:bg-primary-hover text-white text-sm disabled:opacity-60">
                {submitting ? '提交中…' : '提交调整'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};



const CreditTransactionsTab: React.FC = () => {
  const [txns, setTxns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [userFilter, setUserFilter] = useState('');
  const [featureFilter, setFeatureFilter] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (userFilter) sp.set('user_id', userFilter);
      if (featureFilter) sp.set('feature_key', featureFilter);
      sp.set('limit', '300');
      const r = await apiGet<{ transactions: any[] }>(`/api/admin/credit-transactions?${sp.toString()}`);
      setTxns(r.transactions || []);
      setPage(1);
    } catch (e: any) {
      console.warn('Slice 5 admin credit-transactions 接口或许尚未上线:', e?.message);
      setTxns([]);
    } finally { setLoading(false); }
  }, [userFilter, featureFilter]);

  useEffect(() => { reload(); }, [reload]);

  const pageRows = txns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <CrmToolbar
        title="创作点数台账"
        count={txns.length}
        filters={
          <>
            <input value={userFilter} onChange={e => setUserFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') reload(); }}
                   placeholder="user_id" className="bg-n0 border border-n40 rounded px-2 py-1.5 text-xs w-36 focus:border-primary focus:outline-none" />
            <input value={featureFilter} onChange={e => setFeatureFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') reload(); }}
                   placeholder="feature_key" className="bg-n0 border border-n40 rounded px-2 py-1.5 text-xs w-36 focus:border-primary focus:outline-none" />
          </>
        }
        actions={<button onClick={reload} className="p-1.5 rounded border border-n40 bg-n0 hover:bg-n20"><RefreshCw size={13} className={loading ? 'animate-spin text-primary' : 'text-n300'} /></button>}
      />
      <CrmTable headers={
        <tr>
          <th className="text-left font-medium p-2.5">时间</th>
          <th className="text-left font-medium p-2.5">类型</th>
          <th className="text-left font-medium p-2.5">用户</th>
          <th className="text-left font-medium p-2.5">功能</th>
          <th className="text-left font-medium p-2.5">原因</th>
          <th className="text-right font-medium p-2.5">金额</th>
          <th className="text-right font-medium p-2.5">余额前</th>
          <th className="text-right font-medium p-2.5">余额后</th>
        </tr>
      }>
        {pageRows.map(t => {
          const reason = getCreditTransactionReason(t);
          return (
            <tr key={t.transaction_id} className="hover:bg-n10">
              <td className="p-2.5 text-n300 text-[10px] whitespace-nowrap">{formatChinaDateTime(t.created_at)}</td>
              <td className="p-2.5"><CrmTag type={Number(t.amount) >= 0 ? 'success' : 'warning'}>{t.change_type}</CrmTag></td>
              <td className="p-2.5 font-mono text-[10px] text-n300">{t.user_id || '-'}</td>
              <td className="p-2.5 text-n700">{t.feature_key || '-'}</td>
              <td className="min-w-48 max-w-96 p-2.5 text-n500">
                <div className="whitespace-normal break-words leading-5" title={reason}>{reason || '-'}</div>
                {reason && t.operated_by && <div className="mt-0.5 text-[10px] text-n100">操作人：{t.operated_by}</div>}
              </td>
              <td className={`p-2.5 text-right font-mono ${Number(t.amount) >= 0 ? 'text-success' : 'text-danger'}`}>{t.amount}</td>
              <td className="p-2.5 text-right font-mono text-n100">{t.balance_before}</td>
              <td className="p-2.5 text-right font-mono text-n700">{t.balance_after}</td>
            </tr>
          );
        })}
        {!pageRows.length && <tr><td colSpan={8} className="text-center py-8 text-n100">{loading ? '加载中…' : '暂无流水'}</td></tr>}
      </CrmTable>
      <CrmPagination total={txns.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
};



const RechargeOrdersTab: React.FC = () => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [userFilter, setUserFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [orderFilter, setOrderFilter] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (userFilter.trim()) sp.set('user_id', userFilter.trim());
      if (statusFilter) sp.set('status', statusFilter);
      if (orderFilter.trim()) sp.set('out_trade_no', orderFilter.trim());
      sp.set('limit', '300');
      const result = await apiGet<{ orders: any[] }>(`/api/admin/wechat-recharge-orders?${sp.toString()}`);
      setOrders(result.orders || []);
      setPage(1);
    } catch (e: any) {
      crmMessage.error(`充值台账加载失败：${await readApiError(e)}`);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [orderFilter, statusFilter, userFilter]);

  useEffect(() => { void reload(); }, [reload]);

  const formatFen = (value: number) => `¥${(Number(value || 0) / 100).toFixed(2)}`;
  const pageRows = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <CrmToolbar
        title="充值台账"
        count={orders.length}
        filters={
          <>
            <input value={userFilter} onChange={event => setUserFilter(event.target.value)} placeholder="user_id" className="w-36 rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none" />
            <input value={orderFilter} onChange={event => setOrderFilter(event.target.value)} placeholder="商户订单号" className="w-44 rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none" />
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="rounded border border-n40 bg-n0 px-2 py-1.5 text-xs focus:border-primary focus:outline-none">
              <option value="">全部状态</option>
              <option value="pending">待支付</option>
              <option value="paid">已支付</option>
              <option value="closed">已关闭</option>
              <option value="expired">已过期</option>
              <option value="failed">失败</option>
            </select>
          </>
        }
        actions={<button type="button" onClick={() => void reload()} className="rounded border border-n40 bg-n0 p-1.5 hover:bg-n20"><RefreshCw size={13} className={loading ? 'animate-spin text-primary' : 'text-n300'} /></button>}
      />
      <CrmTable scrollable headers={
        <tr>
          <th className="p-2.5 text-left font-medium">创建时间</th>
          <th className="p-2.5 text-left font-medium">商户订单号</th>
          <th className="p-2.5 text-left font-medium">用户</th>
          <th className="p-2.5 text-right font-medium">点数</th>
          <th className="p-2.5 text-right font-medium">原价</th>
          <th className="p-2.5 text-right font-medium">实付</th>
          <th className="p-2.5 text-right font-medium">折扣</th>
          <th className="p-2.5 text-left font-medium">状态</th>
          <th className="p-2.5 text-left font-medium">微信交易号</th>
          <th className="p-2.5 text-left font-medium">支付时间</th>
        </tr>
      }>
        {pageRows.map(order => (
          <tr key={order.payment_order_id} className="hover:bg-n10">
            <td className="p-2.5 text-[10px] text-n300">{new Date(order.created_at).toLocaleString('zh-CN')}</td>
            <td className="p-2.5 font-mono text-[10px] text-n700">{order.out_trade_no}</td>
            <td className="p-2.5 text-xs text-n700">{order.username || order.phone_number || order.user_id}</td>
            <td className="p-2.5 text-right font-mono text-n800">{Number(order.point_amount).toLocaleString()}</td>
            <td className="p-2.5 text-right font-mono text-n300">{formatFen(order.base_amount_fen)}</td>
            <td className="p-2.5 text-right font-mono text-success">{formatFen(order.amount_fen)}</td>
            <td className="p-2.5 text-right font-mono text-n700">{Number(order.discount_bps) / 100}%</td>
            <td className="p-2.5">
              <div className="inline-flex items-center gap-2 whitespace-nowrap">
                <CrmTag type={rechargeOrderStatus(order.status).type}>{rechargeOrderStatus(order.status).label}</CrmTag>
                {order.failure_reason && <span className="text-[10px] text-n300" title={order.failure_reason}>{order.failure_reason}</span>}
              </div>
            </td>
            <td className="max-w-40 truncate p-2.5 font-mono text-[10px] text-n300" title={order.transaction_id || ''}>{order.transaction_id || '-'}</td>
            <td className="p-2.5 text-[10px] text-n300">{order.paid_at ? new Date(order.paid_at).toLocaleString('zh-CN') : '-'}</td>
          </tr>
        ))}
        {!pageRows.length && <tr><td colSpan={10} className="py-8 text-center text-n100">{loading ? '加载中…' : '暂无充值订单'}</td></tr>}
      </CrmTable>
      <CrmPagination total={orders.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
};



const MediaLibraryAdminTab: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);


  const [filterUserId, setFilterUserId] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterKeyword, setFilterKeyword] = useState('');
  const users = useAdminUsers();

  const [page, setPage] = useState(1);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (filterUserId) sp.set('user_id', filterUserId);
      if (filterType) sp.set('item_type', filterType);
      if (filterKeyword.trim()) sp.set('keyword', filterKeyword.trim());
      sp.set('limit', '300');
      const r = await apiGet<{ items: any[] }>(`/api/admin/media-library/items?${sp.toString()}`);
      setItems(r.items || []);
      setPage(1);
    } catch (e: any) {
      console.warn('Slice 5 admin media-library 接口或许尚未上线:', e?.message);
      setItems([]);
    } finally { setLoading(false); }
  }, [filterUserId, filterType, filterKeyword]);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (lid: string) => {
    const reason = await crmPrompt({ title: '删除素材', label: '删除原因', placeholder: '选填' });
    if (reason === null) return;
    const sp = new URLSearchParams({ reason });
    try {
      await apiDelete(`/api/admin/media-library/items/${lid}?${sp.toString()}`);
      crmMessage.success('已删除');
      reload();
    } catch (e: any) {
      crmMessage.error(`删除失败：${await readApiError(e)}`);
    }
  };

  const pageRows = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <CrmToolbar
        title="素材库管理"
        count={items.length}
        filters={
          <>
            <select value={filterUserId} onChange={e => setFilterUserId(e.target.value)}
                    className="bg-n0 border border-n40 rounded px-2 py-1.5 text-xs w-44 focus:border-primary focus:outline-none">
              <option value="">所有用户</option>
              {users.map(u => (
                <option key={u.id || u.user_id} value={u.id || u.user_id}>
                  {u.username || u.email || u.user_id} · {(u.id || u.user_id || '').slice(0, 8)}…
                </option>
              ))}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
                    className="bg-n0 border border-n40 rounded px-2 py-1.5 text-xs w-28 focus:border-primary focus:outline-none">
              <option value="">所有类型</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
              <option value="audio">音频</option>
              <option value="frame">抽帧</option>
              <option value="text">文本</option>
              <option value="other">其他</option>
            </select>
          </>
        }
        search={{ value: filterKeyword, onChange: setFilterKeyword, placeholder: '搜索标题 / 文件名', onSearch: reload }}
      />
      <CrmTable headers={
        <tr>
          <th className="text-left font-medium p-2.5">素材</th>
          <th className="text-left font-medium p-2.5">类型</th>
          <th className="text-left font-medium p-2.5">所有者</th>
          <th className="text-left font-medium p-2.5">项目</th>
          <th className="text-left font-medium p-2.5">权限</th>
          <th className="text-right font-medium p-2.5">操作</th>
        </tr>
      }>
        {pageRows.map(it => (
          <tr key={it.library_item_id} className="hover:bg-n10">
            <td className="p-2.5">
              <div className="text-n800 truncate max-w-[300px]">{it.title || it.file_name}</div>
              <div className="text-[10px] text-n100 font-mono">{it.library_item_id}</div>
            </td>
            <td className="p-2.5"><CrmTag type="info">{it.item_type}</CrmTag></td>
            <td className="p-2.5 text-[11px] text-n700">
              {(() => {
                const u = users.find(x => (x.id || x.user_id) === it.user_id);
                return u
                  ? (<><span className="text-n700">{u.username || u.email}</span><span className="ml-1 text-[9px] text-n100 font-mono">{(it.user_id || '').slice(0, 8)}…</span></>)
                  : (<span className="font-mono text-n300">{it.user_id}</span>);
              })()}
            </td>
            <td className="p-2.5 font-mono text-[10px] text-n300">{it.project_id || '-'}</td>
            <td className="p-2.5 text-n700">{it.permission_scope}</td>
            <td className="p-2.5 text-right">
              <CrmActionLink type="danger" onClick={() => handleDelete(it.library_item_id)}>删除</CrmActionLink>
            </td>
          </tr>
        ))}
        {!pageRows.length && <tr><td colSpan={6} className="text-center py-8 text-n100">{loading ? '加载中…' : '暂无素材'}</td></tr>}
      </CrmTable>
      <CrmPagination total={items.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
};



const AuditLogsTab: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adminFilter, setAdminFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  const [page, setPage] = useState(1);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (adminFilter) sp.set('admin_user_id', adminFilter);
      if (actionFilter) sp.set('action', actionFilter);
      sp.set('limit', '300');
      const r = await apiGet<{ logs: any[] }>(`/api/admin/audit-logs?${sp.toString()}`);
      setLogs(r.logs || []);
      setPage(1);
    } catch (e: any) {
      console.warn('Slice 5 admin audit-logs 接口或许尚未上线:', e?.message);
      setLogs([]);
    } finally { setLoading(false); }
  }, [adminFilter, actionFilter]);

  useEffect(() => { reload(); }, [reload]);

  const pageRows = logs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <CrmToolbar
        title="审计日志"
        count={logs.length}
        filters={
          <>
            <input value={adminFilter} onChange={e => setAdminFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') reload(); }}
                   placeholder="admin_user_id" className="bg-n0 border border-n40 rounded px-2 py-1.5 text-xs w-36 focus:border-primary focus:outline-none" />
            <input value={actionFilter} onChange={e => setActionFilter(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') reload(); }}
                   placeholder="action" className="bg-n0 border border-n40 rounded px-2 py-1.5 text-xs w-32 focus:border-primary focus:outline-none" />
          </>
        }
        actions={<button onClick={reload} className="p-1.5 rounded border border-n40 bg-n0 hover:bg-n20"><RefreshCw size={13} className={loading ? 'animate-spin text-primary' : 'text-n300'} /></button>}
      />
      <CrmTable headers={
        <tr>
          <th className="text-left font-medium p-2.5">时间</th>
          <th className="text-left font-medium p-2.5">管理员</th>
          <th className="text-left font-medium p-2.5">操作</th>
          <th className="text-left font-medium p-2.5">目标</th>
          <th className="text-left font-medium p-2.5">IP</th>
          <th className="text-left font-medium p-2.5">User-Agent</th>
        </tr>
      }>
        {pageRows.map(l => (
          <tr key={l.audit_id} className="hover:bg-n10">
            <td className="p-2.5 text-n300 text-[10px]">{new Date(l.created_at).toLocaleString('zh-CN')}</td>
            <td className="p-2.5 font-mono text-[10px]">{l.admin_user_id}</td>
            <td className="p-2.5"><CrmTag type="info">{l.action}</CrmTag></td>
            <td className="p-2.5 font-mono text-[10px] text-n300">{l.target_type}/{l.target_id}</td>
            <td className="p-2.5 text-n100 text-[10px]">{l.ip || '-'}</td>
            <td className="p-2.5 text-n100 text-[10px] truncate max-w-[200px]">{l.user_agent || '-'}</td>
          </tr>
        ))}
        {!pageRows.length && <tr><td colSpan={6} className="text-center py-8 text-n100">{loading ? '加载中…' : '暂无审计日志'}</td></tr>}
      </CrmTable>
      <CrmPagination total={logs.length} page={page} pageSize={PAGE_SIZE} onChange={setPage} />
    </div>
  );
};


export default AdminFeatureTabs;
