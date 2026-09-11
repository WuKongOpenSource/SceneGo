import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { apiFetch } from '../services/httpClient';
import { clearAccountIdentity, getStoredUsername } from '../services/accountStorage';
import { getCurrentAdminSession } from '../services/adminAccessService';
import { adminPath } from '../admin/adminRoute';

interface AccountMenuProps {
  className?: string;
  compact?: boolean;
  labelFallback?: string;
}

export const AccountMenu: React.FC<AccountMenuProps> = ({
  className = '',
  compact = false,
  labelFallback = '未登录',
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(() => getStoredUsername(labelFallback));
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let active = true;
    void getCurrentAdminSession().then(session => {
      if (active) setCanManage(Boolean(session));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const syncUsername = () => setUsername(getStoredUsername(labelFallback));
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener('account:updated', syncUsername);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('account:updated', syncUsername);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [labelFallback]);

  const handleProfile = useCallback(() => {
    setOpen(false);
    window.location.href = '/profile';
  }, []);

  const handleLogout = useCallback(async () => {
    setOpen(false);
    try {
      await apiFetch('/api/logout', { method: 'POST' }, { apiName: 'logout' });
    } catch (error) {
      console.warn('退出登录请求失败:', error);
    }
    clearAccountIdentity();
    window.location.href = '/login';
  }, []);

  const initial = (username.trim().charAt(0) || 'U').toUpperCase();
  const buttonSizeClass = compact
    ? 'h-8 max-w-[156px] gap-1.5 px-2 text-xs'
    : 'h-10 max-w-[190px] gap-2 px-3 text-sm';
  const avatarSizeClass = compact ? 'h-6 min-w-6 text-[11px]' : 'h-7 min-w-7 text-xs';

  return (
    <div
      ref={rootRef}
      className={`relative shrink-0 ${className}`}
      onClick={event => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={`inline-flex items-center rounded-full border border-b75 bg-b50/70 text-n700 transition-all hover:border-primary hover:bg-b50 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${buttonSizeClass}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={username}
      >
        <span className={`inline-flex items-center justify-center rounded-full bg-primary-light font-semibold text-primary ${avatarSizeClass}`}>
          {initial}
        </span>
        <span className="truncate">{username}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-n300 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-[168px] rounded-lg border border-n40 bg-n0 p-1.5 shadow-bottom"
          role="menu"
        >
          <button
            type="button"
            onClick={handleProfile}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-n700 transition-colors hover:bg-n20 hover:text-primary"
            role="menuitem"
          >
            <UserRound className="h-4 w-4" />
            个人中心
          </button>
          {canManage && (
            <a
              href={adminPath()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-n700 transition-colors hover:bg-n20 hover:text-primary"
              role="menuitem"
            >
              <ShieldCheck className="h-4 w-4" />
              管理后台
            </a>
          )}
          <div className="my-1 border-t border-n40" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-r50"
            role="menuitem"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
};

export default AccountMenu;
