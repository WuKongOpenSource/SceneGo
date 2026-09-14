const labels: Record<string, string> = {
  pending: '待支付', paid: '已支付', closed: '已关闭', expired: '已过期', failed: '失败',
};

export function rechargeOrderStatus(value: string) {
  const status = String(value || '').toLowerCase();
  const type = status === 'paid' ? 'success' : status === 'pending' ? 'warning' : status === 'failed' ? 'danger' : 'default';
  return { label: labels[status] || value, type } as const;
}
