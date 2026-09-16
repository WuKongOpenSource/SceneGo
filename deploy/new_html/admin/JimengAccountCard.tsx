import React, { useEffect, useState } from 'react';
import { apiJson } from '../services/httpClient';
import { getModelDisplayName } from '../services/videoModelService';

interface AccountStatus {
    available: boolean; message: string; account_id?: string; session_id?: string;
    provider_credits?: number; execution_model?: string;
}

export function JimengAccountCard() {
    const [status, setStatus] = useState<AccountStatus>();
    const [busy, setBusy] = useState(false);
    const refresh = async () => {
        setBusy(true);
        try { setStatus(await apiJson<AccountStatus>('/api/admin/jimeng/status')); }
        catch { setStatus({ available: false, message: '无法读取即梦账号状态，请使用超级管理员账号重试。' }); }
        finally { setBusy(false); }
    };
    useEffect(() => { void refresh(); }, []);
    return <section aria-label="即梦独立账号" className="rounded-xl border border-n40 bg-n0 p-4 text-xs">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-n800">即梦 · 独立账号</h2>
            <button type="button" onClick={() => void refresh()} disabled={busy} className="shrink-0 text-primary disabled:opacity-50">{busy ? '检查中…' : '刷新状态'}</button></div>
        <p className="mt-2 text-n700">{getModelDisplayName('JimengSeedance2')}</p>
        <p className={`mt-2 ${status?.available ? 'text-success' : 'text-warning'}`}>{status?.message || '正在检查独立账号授权…'}</p>
        {status?.account_id && <p className="mt-2 break-all">账号：{status.account_id} · 专用会话：{status.session_id}</p>}
        {status?.provider_credits !== undefined && <p className="mt-2">即梦账号可用点数：{status.provider_credits}（不是平台创作点数）</p>}
        <p className="mt-2 leading-5 text-n100">官方 CLI · 实际执行 seedance2.0mini · 全能参考 · 720P · 4–15 秒。平台创作点数按 Seedance 2.0 标准模型同参数的两倍计费。</p>
        <p className="mt-1 leading-5 text-n100">使用独立 OAuth 授权和新建专用会话，不复用其他平台账号。授权由管理员在专用运行环境完成，不在此页面粘贴令牌。提交后只查询原任务，未知提交结果需人工核查；供应商暂不支持已验证的取消接口。</p>
    </section>;
}
