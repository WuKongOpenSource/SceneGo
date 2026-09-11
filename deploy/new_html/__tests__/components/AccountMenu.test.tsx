import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountMenu from '../../components/AccountMenu';
import { adminPath } from '../../admin/adminRoute';
import { getCurrentAdminSession } from '../../services/adminAccessService';

vi.mock('../../services/accountStorage', () => ({
  clearAccountIdentity: vi.fn(),
  getStoredUsername: vi.fn(() => 'admin'),
}));

vi.mock('../../services/adminAccessService', () => ({
  getCurrentAdminSession: vi.fn(),
}));

describe('AccountMenu admin navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getCurrentAdminSession as any).mockResolvedValue({
      user_id: 'admin_1',
      username: 'admin',
      role: 'admin',
    });
  });

  it('opens the management shell in a new browser tab', async () => {
    render(<AccountMenu />);

    fireEvent.click(screen.getByRole('button', { name: /admin/i }));
    const adminEntry = await screen.findByRole('menuitem', { name: '管理后台' });

    expect(adminEntry).toHaveAttribute('href', adminPath());
    expect(adminEntry).toHaveAttribute('target', '_blank');
    expect(adminEntry).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
