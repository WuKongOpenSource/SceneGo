import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminFeatureTabs } from '../../components/AdminFeatureTabs';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../../services/httpClient', () => ({ apiJson: mocks.api }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const account = { account_id: 'acct-example', owner_id: 'user-example', owner_type: 'user',
  owner_username: '测试创作者', available_credits: 214, account_credits: 200,
  gift_credits: 14, frozen_credits: 0, total_used_credits: 0 };

it('shows the existing owner username alongside the unchanged account and balances', async () => {
  mocks.api.mockResolvedValue({ accounts: [account] });
  render(<AdminFeatureTabs embedTab="credit_accounts" />);
  const row = (await screen.findByText('acct-example')).closest('tr')!;
  expect(screen.getByRole('columnheader', { name: '用户名' })).toBeVisible();
  expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual([
    'acct-example', '测试创作者', 'user/user-example', '214', '200', '14', '0', '0', '手动调整',
  ]);
  expect(mocks.api).toHaveBeenCalledTimes(1);
  expect(mocks.api).toHaveBeenCalledWith('/api/admin/credit-accounts', { method: 'GET' }, 'Admin API');
});

it.each([
  { owner_username: null }, { owner_username: '' }, { owner_username: '  ' },
  { owner_type: 'team', owner_username: 'Not a user account' },
])('does not invent a username when unavailable or not a user: %j', async overrides => {
  mocks.api.mockResolvedValue({ accounts: [{ ...account, ...overrides }] });
  render(<AdminFeatureTabs embedTab="credit_accounts" />);
  const row = (await screen.findByText('acct-example')).closest('tr')!;
  expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('—');
  expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('user-example');
});

it('spans all columns for an empty ledger', async () => {
  mocks.api.mockResolvedValue({ accounts: [] });
  render(<AdminFeatureTabs embedTab="credit_accounts" />);
  expect(await screen.findByText('暂无账户')).toHaveAttribute('colspan', '9');
});
