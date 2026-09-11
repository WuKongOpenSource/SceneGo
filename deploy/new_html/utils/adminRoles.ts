export type PlatformRole = 'user' | 'admin' | 'super_admin';

export const PLATFORM_ROLE_OPTIONS: ReadonlyArray<{
  value: PlatformRole;
  label: string;
  description: string;
}> = [
  {
    value: 'user',
    label: '创作者 · user',
    description: '使用平台开放模型并按创作点数计费，只管理自己的项目与素材。',
  },
  {
    value: 'admin',
    label: '管理员 · admin',
    description: '负责用户、任务、内容、创作点数和充值运营，不可修改平台核心配置。',
  },
  {
    value: 'super_admin',
    label: '超级管理员 · super_admin',
    description: '拥有完整后台权限，可管理管理员、模型计费、API、集群与系统配置。',
  },
];

export function normalizePlatformRole(value: unknown): PlatformRole {
  return value === 'admin' || value === 'super_admin' ? value : 'user';
}

export function getPlatformRoleLabel(value: unknown): string {
  const role = normalizePlatformRole(value);
  return PLATFORM_ROLE_OPTIONS.find(item => item.value === role)?.label ?? '创作者 · user';
}

export function getPlatformRoleDescription(value: unknown): string {
  const role = normalizePlatformRole(value);
  return PLATFORM_ROLE_OPTIONS.find(item => item.value === role)?.description ?? '';
}
