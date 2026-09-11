import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const appSource = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf-8');
const panelSource = readFileSync(resolve(__dirname, '../../components/NotificationPanel.tsx'), 'utf-8');

describe('task notification indicator', () => {
  it('does not mount delayed in-app or browser notification popups', () => {
    expect(appSource).not.toContain('GlobalToast');
    expect(appSource).not.toContain('DeferredGlobalToastWithNav');
    expect(appSource).not.toContain('Notification.requestPermission');
    expect(appSource).not.toContain('new Notification');
  });

  it('shows the unread notification count beside the bell', () => {
    expect(panelSource).toContain('任务通知，${unreadCount} 条新消息');
    expect(panelSource).toContain('{unreadCount > 0 ? (');
    expect(panelSource).toContain("{unreadCount > 99 ? '99+' : unreadCount}");
    expect(panelSource).not.toContain("{totalActive > 99 ? '99+' : totalActive}");
  });
});
