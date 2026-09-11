












import { adminPath } from './adminRoute';

export interface MenuLeaf {
  id: string;
  label: string;
  to: string;
}

export interface MenuItem {
  id: string;
  label: string;
  to?: string;
  children?: MenuLeaf[];
}

export interface MenuSection {
  id: string;
  label: string;
  icon: string;
  children: MenuItem[];
}

export const ADMIN_MENU: MenuSection[] = [
  {
    id: 'overview',
    label: '概览',
    icon: 'LayoutDashboard',
    children: [
      { id: 'dashboard', label: '运营概览', to: adminPath() },
    ],
  },
  {
    id: 'org',
    label: '用户与组织',
    icon: 'Users',
    children: [
      { id: 'accounts', label: '账号管理', to: adminPath('features?tab=accounts') },
      { id: 'permissions', label: '用户权限', to: adminPath('operations?tab=users') },
      { id: 'groups', label: '项目分组', to: adminPath('features?tab=groups') },
      { id: 'organizations', label: '组织管理', to: adminPath('features?tab=organizations') },
    ],
  },
  {
    id: 'credits',
    label: '创作点数体系',
    icon: 'Coins',
    children: [
      { id: 'credit_rules', label: '创作点数规则', to: adminPath('features?tab=credit_rules') },
      { id: 'credit_accounts', label: '创作点数账户', to: adminPath('features?tab=credit_accounts') },
      { id: 'credit_transactions', label: '创作点数台账', to: adminPath('features?tab=credit_transactions') },
      { id: 'recharge_orders', label: '充值台账', to: adminPath('features?tab=recharge_orders') },
    ],
  },
  {
    id: 'content',
    label: '内容与审计',
    icon: 'ImageIcon',
    children: [
      { id: 'media', label: '素材库管理', to: adminPath('features?tab=media') },
      { id: 'recyclebin', label: '文件回收站', to: adminPath('settings?item=recyclebin') },
      { id: 'results', label: '生成结果审计', to: adminPath('operations?tab=results') },
      { id: 'audit', label: '审计日志', to: adminPath('features?tab=audit') },
    ],
  },
  {
    id: 'monitor',
    label: '数据监控',
    icon: 'BarChart3',
    children: [
      { id: 'tasks', label: '任务监控', to: adminPath('settings?item=dashboard') },
      { id: 'stats', label: '生成统计分析', to: adminPath('operations?tab=stats') },
      { id: 'cluster_monitor', label: '集群节点监控', to: adminPath('operations?tab=system') },
    ],
  },
  {
    id: 'settings',
    label: '系统设置',
    icon: 'Settings',
    children: [
      { id: 'apiconfig', label: 'API 厂商配置', to: adminPath('settings?item=apiconfig') },
      { id: 'cluster', label: '集群节点', to: adminPath('settings?item=cluster') },
      { id: 'workflows', label: '工作流模板', to: adminPath('settings?item=workflows') },
    ],
  },
];


export function getActiveTrail(pathname: string, search: string): string[] {
  const cur = new URLSearchParams(search);
  if (pathname === adminPath('settings') && cur.get('item') === 'legacy-apiconfig') {
    return ['系统设置', 'API 厂商配置'];
  }

  for (const sec of ADMIN_MENU) {
    for (const item of sec.children) {
      if (item.to && isToActive(item.to, pathname, search)) return [sec.label, item.label];
      for (const leaf of item.children ?? []) {
        if (isToActive(leaf.to, pathname, search)) return [sec.label, item.label, leaf.label];
      }
    }
  }
  return ['概览', '运营概览'];
}


export function isToActive(to: string, pathname: string, search: string): boolean {
  const [toPath, toQuery] = to.split('?');
  if (toPath !== pathname) return false;
  if (!toQuery) {

    return true;
  }
  const cur = new URLSearchParams(search);
  const want = new URLSearchParams(toQuery);
  for (const [k, v] of want.entries()) {
    if (cur.get(k) !== v) return false;
  }
  return true;
}
