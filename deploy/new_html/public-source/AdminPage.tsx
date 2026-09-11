import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react';

import { apiJson } from '../services/httpClient';

type Tab = 'providers' | 'users';
type JsonRecord = Record<string, any>;

interface ProviderConfig {
  config_id: string;
  name: string;
  provider: string;
  endpoint: string;
  model_name?: string;
  category?: string;
  enabled?: boolean;
  has_key?: boolean;
  api_key_preview?: string;
}

interface Account {
  id: string;
  username: string;
  email?: string;
  role: string;
  isActive: boolean;
}

const emptyProviderForm = {
  config_id: '',
  name: '',
  provider: '',
  endpoint: '',
  model_name: '',
  category: '',
  api_key: '',
  enabled: true,
};

const emptyAccountForm = { username: '', email: '', password: '', role: 'user' };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请检查后台日志。';
}

export const AdminPage: React.FC<JsonRecord> = () => {
  const [tab, setTab] = useState<Tab>('providers');
  const [configs, setConfigs] = useState<ProviderConfig[]>([]);
  const [users, setUsers] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [providerForm, setProviderForm] = useState<typeof emptyProviderForm | null>(null);
  const [accountForm, setAccountForm] = useState<typeof emptyAccountForm | null>(null);

  const loadProviders = useCallback(async () => {
    const data = await apiJson<JsonRecord>('/api/admin/api-configs', { method: 'GET' }, 'API 配置');
    setConfigs((data.api_configs || data.configs || []) as ProviderConfig[]);
  }, []);

  const loadUsers = useCallback(async () => {
    const data = await apiJson<JsonRecord>('/api/admin/users?limit=500', { method: 'GET' }, '用户列表');
    setUsers((data.users || []) as Account[]);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      await Promise.all([loadProviders(), loadUsers()]);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [loadProviders, loadUsers]);

  useEffect(() => { void reload(); }, [reload]);

  const saveProvider = async () => {
    if (!providerForm) return;
    if (!providerForm.name.trim() || !providerForm.provider.trim() || !providerForm.endpoint.trim()) {
      setMessage('名称、厂商标识和 Endpoint 都是必填项。');
      return;
    }
    if (!providerForm.config_id && !providerForm.api_key.trim()) {
      setMessage('新增配置必须填写 API Key。');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const body: JsonRecord = {
        name: providerForm.name.trim(),
        provider: providerForm.provider.trim(),
        endpoint: providerForm.endpoint.trim(),
        model_name: providerForm.model_name.trim(),
        category: providerForm.category.trim(),
        enabled: providerForm.enabled,
      };
      if (providerForm.api_key.trim()) body.api_key = providerForm.api_key.trim();
      const url = providerForm.config_id
        ? `/api/admin/api-configs/${providerForm.config_id}`
        : '/api/admin/api-configs';
      await apiJson(url, {
        method: providerForm.config_id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      }, '保存 API 配置');
      setProviderForm(null);
      await loadProviders();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const providerAction = async (config: ProviderConfig, action: 'toggle' | 'test' | 'delete') => {
    if (action === 'delete' && !window.confirm(`确认删除“${config.name}”？此操作不会导出或显示明文密钥。`)) return;
    setMessage('');
    try {
      if (action === 'toggle') {
        await apiJson(`/api/admin/api-configs/${config.config_id}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled: config.enabled === false }),
        }, '切换 API 配置');
      } else if (action === 'test') {
        const result = await apiJson<JsonRecord>(`/api/admin/api-configs/${config.config_id}/test`, {
          method: 'POST',
          body: JSON.stringify({}),
        }, '测试 API 配置');
        setMessage(result?.test?.ok ? '连通性测试通过。' : `测试未通过：${result?.test?.error || '请检查配置'}`);
      } else {
        await apiJson(`/api/admin/api-configs/${config.config_id}`, { method: 'DELETE' }, '删除 API 配置');
      }
      await loadProviders();
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  const saveAccount = async () => {
    if (!accountForm) return;
    setSaving(true);
    setMessage('');
    try {
      await apiJson('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(accountForm),
      }, '创建用户');
      setAccountForm(null);
      await loadUsers();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const accountAction = async (user: Account, action: 'toggle' | 'role' | 'password' | 'delete') => {
    setMessage('');
    try {
      if (action === 'toggle') {
        await apiJson(`/api/admin/users/${user.id}/${user.isActive ? 'disable' : 'enable'}`, {
          method: 'POST',
          body: JSON.stringify(user.isActive ? { reason: '管理员在公开版后台禁用' } : {}),
        }, '切换用户状态');
      } else if (action === 'role') {
        const role = window.prompt('输入新角色：user / admin / super_admin', user.role);
        if (!role) return;
        await apiJson(`/api/admin/users/${user.id}`, {
          method: 'PUT',
          body: JSON.stringify({ role }),
        }, '修改角色');
      } else if (action === 'password') {
        const password = window.prompt('输入 8-128 位新密码');
        if (!password) return;
        await apiJson(`/api/admin/users/${user.id}/reset-password`, {
          method: 'POST',
          body: JSON.stringify({ new_password: password }),
        }, '重置密码');
      } else {
        if (!window.confirm(`确认永久删除用户“${user.username}”？请先确认其项目和媒体已经妥善处理。`)) return;
        await apiJson(`/api/admin/users/${user.id}`, { method: 'DELETE' }, '删除用户');
      }
      await loadUsers();
    } catch (error) {
      setMessage(errorText(error));
    }
  };

  return (
    <div className="h-full overflow-auto bg-n20 p-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-xl border border-n40 bg-n0 p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary"><ShieldCheck className="h-4 w-4" />公开源码版管理</div>
          <h1 className="mt-2 text-xl font-bold text-n800">在线 API 与账号</h1>
          <p className="mt-2 text-sm leading-6 text-n300">这里只包含在线供应商配置和账号管理。公开源码不包含本地执行节点、私有工作流、集群运维或批量明文密钥导出。</p>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-n40">
          <div className="flex gap-1">
            <button className={`px-4 py-3 text-sm ${tab === 'providers' ? 'border-b-2 border-primary font-semibold text-primary' : 'text-n300'}`} onClick={() => setTab('providers')}><KeyRound className="mr-1 inline h-4 w-4" />API 配置</button>
            <button className={`px-4 py-3 text-sm ${tab === 'users' ? 'border-b-2 border-primary font-semibold text-primary' : 'text-n300'}`} onClick={() => setTab('users')}><Users className="mr-1 inline h-4 w-4" />用户账号</button>
          </div>
          <button className="rounded-md border border-n40 bg-n0 p-2 text-n300" onClick={() => void reload()} title="刷新"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        {message && <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-n700">{message}</div>}

        {tab === 'providers' ? (
          <section className="space-y-3">
            <div className="flex justify-end"><button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white" onClick={() => setProviderForm({ ...emptyProviderForm })}><Plus className="mr-1 inline h-4 w-4" />新增 API 配置</button></div>
            {configs.map(config => (
              <article key={config.config_id} className="rounded-xl border border-n40 bg-n0 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h2 className="font-semibold text-n800">{config.name}</h2><p className="mt-1 break-all text-xs text-n200">{config.provider} · {config.model_name || '默认模型'} · {config.endpoint}</p><p className="mt-1 text-xs text-n200">密钥：{config.api_key_preview || (config.has_key ? '已配置' : '未配置')} · {config.enabled === false ? '已停用' : '已启用'}</p></div>
                  <div className="flex flex-wrap gap-2">
                    <button className="rounded border border-n40 px-3 py-1.5 text-xs" onClick={() => setProviderForm({ ...emptyProviderForm, ...config, api_key: '' })}>编辑</button>
                    <button className="rounded border border-n40 px-3 py-1.5 text-xs" onClick={() => void providerAction(config, 'test')}>测试</button>
                    <button className="rounded border border-n40 px-3 py-1.5 text-xs" onClick={() => void providerAction(config, 'toggle')}>{config.enabled === false ? '启用' : '停用'}</button>
                    <button className="rounded border border-danger/30 px-3 py-1.5 text-xs text-danger" onClick={() => void providerAction(config, 'delete')}><Trash2 className="mr-1 inline h-3.5 w-3.5" />删除</button>
                  </div>
                </div>
              </article>
            ))}
            {!loading && configs.length === 0 && <div className="rounded-xl border border-dashed border-n40 p-10 text-center text-sm text-n200">尚未配置在线 API。</div>}
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex justify-end"><button className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white" onClick={() => setAccountForm({ ...emptyAccountForm })}><Plus className="mr-1 inline h-4 w-4" />新增用户</button></div>
            {users.map(user => (
              <article key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-n40 bg-n0 p-4">
                <div><h2 className="font-semibold text-n800">{user.username}</h2><p className="mt-1 text-xs text-n200">{user.email || '未填写邮箱'} · {user.role} · {user.isActive ? '正常' : '已禁用'}</p></div>
                <div className="flex flex-wrap gap-2"><button className="rounded border border-n40 px-3 py-1.5 text-xs" onClick={() => void accountAction(user, 'toggle')}>{user.isActive ? '禁用' : '启用'}</button><button className="rounded border border-n40 px-3 py-1.5 text-xs" onClick={() => void accountAction(user, 'role')}>角色</button><button className="rounded border border-n40 px-3 py-1.5 text-xs" onClick={() => void accountAction(user, 'password')}>重置密码</button><button className="rounded border border-danger/30 px-3 py-1.5 text-xs text-danger" onClick={() => void accountAction(user, 'delete')}>删除</button></div>
              </article>
            ))}
          </section>
        )}
      </div>

      {providerForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-xl rounded-xl bg-n0 p-5 shadow-xl"><h2 className="text-lg font-bold">{providerForm.config_id ? '编辑 API 配置' : '新增 API 配置'}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{(['name', 'provider', 'endpoint', 'model_name', 'category', 'api_key'] as const).map(field => <label key={field} className={field === 'endpoint' ? 'sm:col-span-2' : ''}><span className="mb-1 block text-xs text-n300">{{ name: '名称', provider: '厂商标识', endpoint: 'Endpoint', model_name: '模型名', category: '类别', api_key: providerForm.config_id ? '新 API Key（留空保持原值）' : 'API Key' }[field]}</span><input type={field === 'api_key' ? 'password' : 'text'} value={providerForm[field] as string} onChange={event => setProviderForm({ ...providerForm, [field]: event.target.value })} className="w-full rounded-md border border-n40 px-3 py-2 text-sm" autoComplete="off" /></label>)}</div><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={providerForm.enabled} onChange={event => setProviderForm({ ...providerForm, enabled: event.target.checked })} />启用</label><div className="mt-5 flex justify-end gap-2"><button className="rounded border border-n40 px-4 py-2 text-sm" onClick={() => setProviderForm(null)}>取消</button><button className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving} onClick={() => void saveProvider()}>{saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : '保存'}</button></div></div></div>}

      {accountForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-n0 p-5 shadow-xl">
            <h2 className="text-lg font-bold">新增用户</h2>
            <div className="mt-4 space-y-3">
              <label>
                <span className="mb-1 block text-xs text-n300">用户名</span>
                <input type="text" value={accountForm.username} onChange={event => setAccountForm({ ...accountForm, username: event.target.value })} className="w-full rounded-md border border-n40 px-3 py-2 text-sm" autoComplete="off" />
              </label>
              <label>
                <span className="mb-1 block text-xs text-n300">邮箱（可选）</span>
                <input type="text" value={accountForm.email} onChange={event => setAccountForm({ ...accountForm, email: event.target.value })} className="w-full rounded-md border border-n40 px-3 py-2 text-sm" autoComplete="off" />
              </label>
              <label>
                <span className="mb-1 block text-xs text-n300">初始密码（8-128 位）</span>
                <input type="password" value={accountForm.password} onChange={event => setAccountForm({ ...accountForm, password: event.target.value })} className="w-full rounded-md border border-n40 px-3 py-2 text-sm" autoComplete="new-password" />
              </label>
              <label>
                <span className="mb-1 block text-xs text-n300">角色</span>
                <select value={accountForm.role} onChange={event => setAccountForm({ ...accountForm, role: event.target.value })} className="w-full rounded-md border border-n40 px-3 py-2 text-sm">
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                  <option value="super_admin">super_admin</option>
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded border border-n40 px-4 py-2 text-sm" onClick={() => setAccountForm(null)}>取消</button>
              <button className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={saving} onClick={() => void saveAccount()}>{saving ? <Loader2 className="inline h-4 w-4 animate-spin" /> : '创建'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
