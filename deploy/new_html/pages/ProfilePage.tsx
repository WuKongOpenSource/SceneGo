import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Coins,
  FolderOpen,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  PencilLine,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import AccountMenu from '../components/AccountMenu';
import { crmMessage } from '../admin/crmUI';
import { clearAccountIdentity } from '../services/accountStorage';
import { secureApiUrl } from '../services/httpClient';
import {
  changeMyPassword,
  getMyEmailPreferences,
  getMyProfile,
  sendMyEmailVerification,
  type EmailNotificationPreferences,
  ProfileCredits,
  ProfileProjectStats,
  ProfileRecentProject,
  type MyProfile,
  updateMyProfile,
  updateMyEmailPreferences,
  verifyMyEmail,
} from '../services/profileService';

const EMPTY_STATS: ProfileProjectStats = {
  total: 0,
  active: 0,
  archived: 0,
  owned: 0,
  shared: 0,
};

const EMPTY_CREDITS: ProfileCredits = {
  available_credits: 0,
  frozen_credits: 0,
  total_used_credits: 0,
};

const formatNumber = (value: number | null | undefined) => (value ?? 0).toLocaleString();

const formatDate = (value?: string | null) => {
  if (!value) return '暂无时间';
  return new Date(value).toLocaleDateString('zh-CN');
};

const coverImageSrc = (url: string) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) return url;
  return secureApiUrl(url, { absolute: url.startsWith('/') });
};

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [credits, setCredits] = useState<ProfileCredits>(EMPTY_CREDITS);
  const [stats, setStats] = useState<ProfileProjectStats>(EMPTY_STATS);
  const [recentProjects, setRecentProjects] = useState<ProfileRecentProject[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailPreferences, setEmailPreferences] = useState<EmailNotificationPreferences>({
    task_success: true,
    task_failure: true,
    credit_alert: true,
    sharing: true,
  });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [sendingEmailCode, setSendingEmailCode] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [savingEmailPreferences, setSavingEmailPreferences] = useState(false);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const [data, emailSettings] = await Promise.all([getMyProfile(), getMyEmailPreferences()]);
      setProfile(data.profile);
      setCredits(data.credits || EMPTY_CREDITS);
      setStats(data.project_stats || EMPTY_STATS);
      setRecentProjects(data.recent_projects || []);
      setDisplayName(data.profile.username || '');
      setEmail(emailSettings.email || data.profile.email || '');
      setEmailPreferences(emailSettings.preferences);
      setEmailCode('');
    } catch (error) {
      console.error('加载个人中心失败:', error);
      crmMessage.error('加载个人中心失败，请刷新重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const profileChanged = useMemo(() => {
    if (!profile) return false;
    return (
      displayName.trim() !== (profile.username || '')
    );
  }, [displayName, profile]);

  const handleSaveProfile = useCallback(async () => {
    if (!profile || !profileChanged) return;
    const nextName = displayName.trim();
    if (!nextName) {
      crmMessage.warning('显示名称不能为空');
      return;
    }
    setSavingProfile(true);
    try {
      const payload: Parameters<typeof updateMyProfile>[0] = {};
      if (nextName !== profile.username) payload.username = nextName;
      const data = await updateMyProfile(payload);
      setProfile(data.profile);
      setDisplayName(data.profile.username || '');
      crmMessage.success('个人信息已保存');
    } catch (error: any) {
      console.error('保存个人信息失败:', error);
      crmMessage.error(error?.message || '保存个人信息失败');
    } finally {
      setSavingProfile(false);
    }
  }, [displayName, profile, profileChanged]);

  const handleSendEmailCode = useCallback(async () => {
    const nextEmail = email.trim();
    if (!nextEmail) {
      crmMessage.warning('请输入邮箱地址');
      return;
    }
    setSendingEmailCode(true);
    try {
      await sendMyEmailVerification(nextEmail);
      setProfile(current => current ? { ...current, email: nextEmail, email_verified: false } : current);
      crmMessage.success('验证邮件已发送，请查收验证码');
    } catch (error: any) {
      crmMessage.error(error?.message || '发送验证邮件失败');
    } finally {
      setSendingEmailCode(false);
    }
  }, [email]);

  const handleVerifyEmail = useCallback(async () => {
    if (!emailCode.trim()) {
      crmMessage.warning('请输入邮箱验证码');
      return;
    }
    setVerifyingEmail(true);
    try {
      const result = await verifyMyEmail(email.trim(), emailCode.trim());
      setProfile(current => current ? { ...current, email: result.email, email_verified: true } : current);
      setEmailCode('');
      crmMessage.success('邮箱验证成功');
    } catch (error: any) {
      crmMessage.error(error?.message || '邮箱验证失败');
    } finally {
      setVerifyingEmail(false);
    }
  }, [email, emailCode]);

  const handleSaveEmailPreferences = useCallback(async () => {
    setSavingEmailPreferences(true);
    try {
      const result = await updateMyEmailPreferences(emailPreferences);
      setEmailPreferences(result.preferences);
      crmMessage.success('邮件通知设置已保存');
    } catch (error: any) {
      crmMessage.error(error?.message || '保存邮件通知设置失败');
    } finally {
      setSavingEmailPreferences(false);
    }
  }, [emailPreferences]);

  const handleSavePassword = useCallback(async () => {
    if (!currentPassword || !newPassword) {
      crmMessage.warning('请输入当前密码和新密码');
      return;
    }
    if (newPassword.length < 8) {
      crmMessage.warning('新密码至少 8 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      crmMessage.warning('两次输入的新密码不一致');
      return;
    }
    setSavingPassword(true);
    try {
      await changeMyPassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      crmMessage.success('密码已修改');
    } catch (error: any) {
      console.error('修改密码失败:', error);
      crmMessage.error(error?.message || '修改密码失败');
    } finally {
      setSavingPassword(false);
    }
  }, [confirmPassword, currentPassword, newPassword]);

  const handleLogout = useCallback(() => {
    clearAccountIdentity();
    window.location.href = '/login';
  }, []);

  const initial = (profile?.username || displayName || 'U').trim().charAt(0).toUpperCase();

  return (
    <div className="layout-safe min-h-screen bg-n20 text-n800">
      <div
        data-testid="profile-page-shell"
        className="min-h-screen w-full max-w-[1680px] mx-auto bg-n0 md:border-x md:border-n40"
      >
        <header className="border-b border-n40 bg-n0">
          <div className="flex min-h-[72px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="flex min-w-0 items-center gap-4">
              <button
                type="button"
                onClick={() => navigate('/projects')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-n40 bg-n0 text-n300 transition-colors hover:border-n70 hover:text-n800"
                title="返回项目"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="flex min-w-0 items-center gap-2">
                <BrandLogo className="h-8 w-auto max-w-[170px]" alt="创剧 · AI 视频创作平台" />
              </div>
              <div className="hidden h-8 w-px shrink-0 bg-n40 sm:block" />
              <h1 className="truncate text-xl font-bold tracking-tight text-n800 sm:text-2xl">个人中心</h1>
            </div>
            <AccountMenu />
          </div>
        </header>

        <main className="px-4 py-7 sm:px-6 lg:px-8">
          {loading ? (
            <div className="flex min-h-[420px] items-center justify-center text-sm text-n300">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载个人信息...
            </div>
          ) : (
            <div data-testid="profile-page-content" className="space-y-6">
              <section className="overflow-hidden rounded-lg border border-n40 bg-n0 shadow-card">
                <div className="flex flex-col gap-5 border-l-4 border-primary px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-5">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-b75 bg-b50 text-3xl font-semibold text-primary shadow-card">
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <div className="mb-2 inline-flex rounded-full border border-b75 bg-b50 px-2 py-0.5 text-xs font-medium text-primary">
                        创作者账号
                      </div>
                      <h2 className="truncate text-2xl font-semibold tracking-tight text-n800">{profile?.username || '未命名创作者'}</h2>
                      <p className="mt-1 text-sm text-n300">{profile?.user_id || '暂无账号 ID'}</p>
                    </div>
                  </div>
                  <div className="grid min-w-[280px] grid-cols-3 overflow-hidden rounded-lg border border-n40 bg-n10">
                    <StatCell label="全部项目" value={stats.total} />
                    <StatCell label="已归档" value={stats.archived} />
                    <StatCell label="可协作" value={stats.shared} />
                  </div>
                </div>
              </section>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_336px]">
                <div className="space-y-6">
                  <section className="rounded-lg border border-n40 bg-n0 shadow-card">
                    <CardHeader
                      icon={<PencilLine className="h-5 w-5" />}
                      title="个人信息"
                      description="管理你在创剧中显示的账号信息。"
                    />
                    <div className="space-y-4 border-t border-n40 p-6">
                      <label className="block">
                        <span className="text-sm font-medium text-n700">显示名称</span>
                        <input
                          value={displayName}
                          onChange={event => setDisplayName(event.target.value)}
                          placeholder="输入显示名称"
                          className="mt-2 h-10 w-full rounded-lg border border-n40 bg-n0 px-3 text-sm text-n800 outline-none transition-all placeholder:text-n100 focus:border-primary focus:ring-2 focus:ring-primary/15"
                        />
                        <span className="mt-2 block text-xs text-n200">用于个人中心和账号入口，最多 40 个字符。</span>
                      </label>

                      <label className="block">
                        <span className="text-sm font-medium text-n700">手机号</span>
                        <div className="relative mt-2">
                          <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-n100" />
                          <input
                            value={profile?.phone_number || ''}
                            readOnly
                            className="h-10 w-full rounded-lg border border-n40 bg-n20 pl-10 pr-24 text-sm text-n500 outline-none"
                          />
                          {profile?.phone_verified && (
                            <span className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full border border-g75 bg-g50 px-2 py-0.5 text-xs text-g400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              已验证
                            </span>
                          )}
                        </div>
                        <span className="mt-2 block text-xs text-n200">手机号是登录身份，不能从个人资料直接修改。</span>
                      </label>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleSaveProfile}
                          disabled={!profileChanged || savingProfile}
                          className="inline-flex h-10 min-w-[112px] items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-card transition-all hover:bg-primary-hover hover:shadow-atlas disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingProfile ? '保存中...' : '保存更改'}
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-n40 bg-n0 shadow-card">
                    <CardHeader
                      icon={<Mail className="h-5 w-5" />}
                      title="邮箱与通知"
                      description="邮箱为可选信息，验证后可接收任务和账号通知。"
                    />
                    <div className="space-y-5 border-t border-n40 p-6">
                      <label className="block">
                        <span className="text-sm font-medium text-n700">通知邮箱</span>
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <div className="relative flex-1">
                            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-n100" />
                            <input
                              type="email"
                              value={email}
                              onChange={event => setEmail(event.target.value)}
                              placeholder="name@example.com"
                              className="h-10 w-full rounded-lg border border-n40 bg-n0 pl-10 pr-24 text-sm text-n800 outline-none transition-all placeholder:text-n100 focus:border-primary focus:ring-2 focus:ring-primary/15"
                            />
                            {profile?.email_verified && email.trim().toLowerCase() === (profile.email || '').toLowerCase() && (
                              <span className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center gap-1 rounded-full border border-g75 bg-g50 px-2 py-0.5 text-xs text-g400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                已验证
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={handleSendEmailCode}
                            disabled={sendingEmailCode}
                            className="h-10 rounded-lg border border-b75 bg-b50 px-4 text-sm font-medium text-primary disabled:opacity-50"
                          >
                            {sendingEmailCode ? '发送中...' : '发送验证码'}
                          </button>
                        </div>
                      </label>

                      {(!profile?.email_verified || email.trim().toLowerCase() !== (profile.email || '').toLowerCase()) && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            value={emailCode}
                            onChange={event => setEmailCode(event.target.value)}
                            placeholder="输入 6 位邮箱验证码"
                            className="h-10 flex-1 rounded-lg border border-n40 bg-n0 px-3 text-sm text-n800 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                          />
                          <button
                            type="button"
                            onClick={handleVerifyEmail}
                            disabled={verifyingEmail}
                            className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            {verifyingEmail ? '验证中...' : '验证邮箱'}
                          </button>
                        </div>
                      )}

                      <div>
                        <p className="text-sm font-medium text-n700">邮件通知类型</p>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {([
                            ['task_success', '任务完成'],
                            ['task_failure', '任务失败'],
                            ['credit_alert', '创作点数提醒'],
                            ['sharing', '分享与协作'],
                          ] as const).map(([key, label]) => (
                            <label key={key} className="flex items-center gap-2 rounded-lg border border-n40 px-3 py-2 text-sm text-n700">
                              <input
                                type="checkbox"
                                checked={emailPreferences[key]}
                                onChange={event => setEmailPreferences(current => ({ ...current, [key]: event.target.checked }))}
                                className="accent-primary"
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                        <div className="mt-4 flex justify-end">
                          <button
                            type="button"
                            onClick={handleSaveEmailPreferences}
                            disabled={!profile?.email_verified || savingEmailPreferences}
                            className="h-10 rounded-lg border border-n40 px-4 text-sm font-medium text-n700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {savingEmailPreferences ? '保存中...' : '保存通知设置'}
                          </button>
                        </div>
                        {!profile?.email_verified && <p className="mt-2 text-xs text-n200">验证邮箱后，邮件通知设置才会生效。</p>}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-lg border border-n40 bg-n0 shadow-card">
                    <CardHeader
                      icon={<KeyRound className="h-5 w-5" />}
                      title="账号安全"
                      description="修改登录密码，保护账号安全。"
                    />
                    <div className="space-y-4 border-t border-n40 p-6">
                      <PasswordInput label="当前密码" value={currentPassword} onChange={setCurrentPassword} />
                      <PasswordInput label="新密码" value={newPassword} onChange={setNewPassword} placeholder="至少 8 位" />
                      <PasswordInput label="确认新密码" value={confirmPassword} onChange={setConfirmPassword} />
                      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                        <button
                          type="button"
                          onClick={handleSavePassword}
                          disabled={savingPassword}
                          className="inline-flex h-10 items-center justify-center rounded-lg border border-n40 bg-n0 px-4 text-sm font-medium text-n700 transition-colors hover:border-n70 hover:text-n800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {savingPassword ? '修改中...' : '修改密码'}
                        </button>
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-r75 bg-r50 px-4 text-sm font-medium text-danger transition-colors hover:bg-r50"
                        >
                          <LogOut className="h-4 w-4" />
                          退出登录
                        </button>
                      </div>
                    </div>
                  </section>
                </div>

                <aside className="space-y-6">
                  <section className="rounded-lg border border-n40 bg-n0 shadow-card">
                    <CardHeader
                      icon={<Coins className="h-5 w-5" />}
                      title="我的创作点数"
                      description="查看当前余额和使用明细。"
                    />
                    <div className="grid grid-cols-3 border-y border-n40 bg-n10">
                      <StatCell label="可用" value={credits.available_credits} />
                      <StatCell label="账户" value={credits.account_credits || 0} />
                      <StatCell label="赠送" value={credits.gift_credits || 0} />
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/credits')}
                      className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-n700 transition-colors hover:bg-n20 hover:text-primary"
                    >
                      创作点数详情
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </section>

                  <section className="rounded-lg border border-n40 bg-n0 shadow-card">
                    <CardHeader
                      icon={<FolderOpen className="h-5 w-5" />}
                      title="最近项目"
                      description="继续最近的创作工作。"
                    />
                    <div className="divide-y divide-n40 border-t border-n40">
                      {recentProjects.length ? recentProjects.slice(0, 5).map(project => (
                        <button
                          key={project.project_id}
                          type="button"
                          onClick={() => navigate(`/projects/${project.project_id}`)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-n20"
                        >
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-b75 bg-b50">
                            {project.cover_url ? (
                              <img src={coverImageSrc(project.cover_url)} alt="" className="h-full w-full rounded object-cover object-center" />
                            ) : (
                              <BrandLogo variant="mark" className="h-5 w-5 opacity-60" alt="" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold text-n800">{project.project_name}</span>
                              {project.is_archived && (
                                <span className="shrink-0 rounded bg-n30 px-1.5 py-0.5 text-[10px] text-n300">已归档</span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-n200">{formatDate(project.last_accessed_at || project.updated_at || project.created_at)}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-n100" />
                        </button>
                      )) : (
                        <div className="px-4 py-8 text-center text-sm text-n100">暂无最近项目</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/projects')}
                      className="flex w-full items-center justify-between border-t border-n40 px-4 py-3 text-sm font-medium text-n700 transition-colors hover:bg-n20 hover:text-primary"
                    >
                      查看全部项目
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </section>

                  <section className="rounded-lg border border-n40 bg-n0 p-4 shadow-card">
                    <div className="flex items-start gap-3 text-sm text-n300">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-b75 bg-b50 text-primary">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-n800">登录保护已开启</p>
                        <p className="mt-1 text-xs leading-5 text-n200">账号通过密码与登录态访问；手机号验证用于后续安全扩展。</p>
                      </div>
                    </div>
                  </section>
                </aside>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

const CardHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="flex items-center gap-3 p-6">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-b75 bg-b50 text-primary">
      {icon}
    </div>
    <div>
      <h3 className="text-lg font-semibold text-n800">{title}</h3>
      <p className="mt-0.5 text-sm text-n300">{description}</p>
    </div>
  </div>
);

const StatCell: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="border-r border-n40 px-4 py-3 last:border-r-0">
    <div className="text-2xl font-semibold leading-none text-n800 tabular-nums">{formatNumber(value)}</div>
    <div className="mt-1 text-xs text-n300">{label}</div>
  </div>
);

const PasswordInput: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}> = ({ label, value, onChange, placeholder }) => (
  <label className="block">
    <span className="text-sm font-medium text-n700">{label}</span>
    <input
      type="password"
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      className="mt-2 h-10 w-full rounded-lg border border-n40 bg-n0 px-3 text-sm text-n800 outline-none transition-all placeholder:text-n100 focus:border-primary focus:ring-2 focus:ring-primary/15"
    />
  </label>
);

export default ProfilePage;
