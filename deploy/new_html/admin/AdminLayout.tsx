








import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, ChevronLeft, ChevronRight } from 'lucide-react';
import { getAdminUsername, getAdminRole, setAdminSession, clearAdminSession } from '@runtime/adminAuth';
import { getPlatformRoleLabel } from '../utils/adminRoles';
import { apiJson } from '../services/httpClient';
import { AdminSidebar } from './AdminSidebar';
import { getActiveTrail } from './adminMenu';

export const AdminLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [now, setNow] = useState(() => new Date());
    const [sessionRole, setSessionRole] = useState(() => getAdminRole());
    const [accessState, setAccessState] = useState<'checking' | 'ready' | 'forbidden'>('checking');
    const [accessError, setAccessError] = useState('');


    useEffect(() => {
        let active = true;
        setAccessState('checking');
        setAccessError('');
        apiJson<any>('/api/admin/session', { method: 'GET' }, '管理员会话校验')
            .then(session => {
                if (!active) return;
                const role = String(session?.role || 'admin');
                setAdminSession(session?.username || '—', role);
                setSessionRole(role);
                setAccessState('ready');
            })
            .catch((error: any) => {
                if (!active) return;
                clearAdminSession();
                if (Number(error?.status) === 403) {
                    setAccessError('当前前台账号已登录，但没有后台访问权限。');
                } else {
                    setAccessError('后台权限校验失败，请返回前台后重试。');
                }
                setAccessState('forbidden');
            });
        return () => { active = false; };
    }, [navigate, location.pathname, location.search, location.hash]);

    useEffect(() => {
        const t = window.setInterval(() => setNow(new Date()), 1000);
        return () => window.clearInterval(t);
    }, []);

    const adminName = getAdminUsername() || '—';
    const adminRoleLabel = getPlatformRoleLabel(sessionRole);
    const trail = getActiveTrail(location.pathname, location.search);

    const handleLogout = () => {
        if (!confirm('确认退出管理后台？（保留主站登录状态）')) return;
        clearAdminSession();
        navigate('/projects', { replace: true });
    };

    if (accessState === 'checking') {
        return (
            <div className="h-screen w-full bg-n20 flex items-center justify-center text-sm text-n300">
                正在校验后台访问权限...
            </div>
        );
    }

    if (accessState === 'forbidden') {
        return (
            <div className="h-screen w-full bg-n20 flex items-center justify-center px-6">
                <div className="w-full max-w-md rounded-xl border border-n40 bg-n0 p-8 text-center shadow-sm">
                    <h1 className="text-xl font-bold text-n800">无后台访问权限</h1>
                    <p className="mt-3 text-sm leading-6 text-n300">{accessError}</p>
                    <button
                        type="button"
                        onClick={() => navigate('/projects', { replace: true })}
                        className="mt-6 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
                    >
                        返回创作前台
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="layout-safe h-screen w-full min-w-0 bg-n20 text-n700 font-sans flex overflow-hidden">

            <AdminSidebar />


            <div className="flex-1 flex flex-col min-w-0 min-h-0">

                <header className="responsive-toolbar shrink-0 bg-n20/90 border-b border-n40 flex items-center justify-between gap-3 px-5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <button
                            onClick={() => navigate(-1)}
                            className="p-1.5 rounded-md text-n100 hover:text-n700 hover:bg-n20 transition-colors"
                            title="返回上一页"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>

                        <nav className="flex items-center gap-1.5 text-sm min-w-0">
                            {trail.map((seg, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-n70 shrink-0" />}
                                    <span className={i === trail.length - 1 ? 'font-semibold text-n800 truncate' : 'text-n200 truncate'}>
                                        {seg}
                                    </span>
                                </React.Fragment>
                            ))}
                        </nav>
                    </div>

                    <div className="flex items-center gap-4 text-xs shrink-0 min-w-0">
                        <div className="hidden md:flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                            <span className="text-n100 uppercase tracking-wider"
                                  style={{ fontFamily: 'var(--font-mono)' }}>ONLINE</span>
                        </div>
                        <div className="hidden lg:block text-n200 tabular-nums"
                            style={{ fontFamily: 'var(--font-mono)' }}>
                            {now.toLocaleTimeString('zh-CN', { hour12: false })}
                        </div>
                        <div className="flex items-center gap-2 pl-3 border-l border-n40">
                            <div className="text-right leading-tight">
                                <div className="text-[9px] uppercase tracking-widest text-n100"
                                    style={{ fontFamily: 'var(--font-mono)' }}>SIGNED IN</div>
                                <div className="text-xs font-semibold text-primary">{adminName}</div>
                                <div className="text-[9px] text-n100">{adminRoleLabel}</div>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-n300 hover:text-danger hover:bg-r50 border border-n40 hover:border-danger/30 transition-all"
                                title="退出管理后台"
                            >
                                <LogOut className="w-3.5 h-3.5" /> 退出
                            </button>
                        </div>
                    </div>
                </header>


                <main className="layout-safe flex-1 min-h-0 min-w-0 overflow-auto bg-n20">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default AdminLayout;
