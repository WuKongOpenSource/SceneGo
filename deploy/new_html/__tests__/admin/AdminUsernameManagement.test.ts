import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const accountsSource = readFileSync(resolve(__dirname, '../../components/AdminFeatureTabs.tsx'), 'utf-8');
const authSource = readFileSync(resolve(__dirname, '../../public-source/adminAuth.ts'), 'utf-8');
const layoutSource = readFileSync(resolve(__dirname, '../../admin/AdminLayout.tsx'), 'utf-8');

describe('admin username management contract', () => {
  it('exposes an account rename action backed by the stable user id', () => {
    expect(accountsSource).toContain('>修改用户名</CrmActionLink>');
    expect(accountsSource).toContain('`/api/admin/users/${uid}/username`');
    expect(accountsSource).toContain('setAdminSession(result.session.username, result.session.role)');
    expect(accountsSource).not.toContain('result.session.token');
    expect(accountsSource).toContain("disabled={u.user_id === 'admin' || (!canManageRoles && u.role !== 'user')}");
  });

  it('uses the backend role gate instead of a hard-coded username whitelist', () => {
    expect(authSource).not.toContain('isAdminWhitelisted');
    expect(layoutSource).not.toContain('isAdminWhitelisted');
    expect(layoutSource).toContain("'/api/admin/session'");
    expect(layoutSource).not.toContain('getAdminToken');
    expect(layoutSource).toContain("Number(error?.status) === 403");
    expect(layoutSource).toContain('当前前台账号已登录，但没有后台访问权限');
  });

  it('shows phone numbers and accepts both normalized and raw recent-login fields', () => {
    expect(accountsSource).toContain('>手机号</th>');
    expect(accountsSource).toContain("placeholder: '搜索用户名 / 手机号 / 邮箱'");
    expect(accountsSource).toContain("{u.phone_number || '-'}");
    expect(accountsSource).toContain('u.last_login_at || u.lastLogin');
    expect(accountsSource).toContain('formatChinaDateTime(u.last_login_at || u.lastLogin)');
  });
});
