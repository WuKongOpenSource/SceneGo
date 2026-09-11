import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { within } from '@testing-library/dom';

const source = readFileSync(resolve(__dirname, '../../../admin/app.js'), 'utf8');
const styles = readFileSync(resolve(__dirname, '../../../admin/style.css'), 'utf8');
const code = source.slice(source.indexOf('function escapeHtml('), source.indexOf('function normalizeProviderId('))
  + source.slice(source.indexOf('async function fetchAgents('), source.indexOf('async function renameAgent('));
let sandbox: any;
let stylesheet: HTMLStyleElement;
const rows = [
  { agent_id: 'a', name: '外部字样的自有节点', registry_kind: 'managed', status: 'busy', enabled: true },
  { agent_id: 'b', name: '服务商节点', registry_kind: 'external', status: 'offline', enabled: false },
  { agent_id: 'c', name: '<历史节点>', status: 'online', enabled: true },
];

beforeEach(() => {
  stylesheet = document.createElement('style');
  stylesheet.textContent = styles;
  document.head.append(stylesheet);
  document.body.innerHTML = '<div id="agent-list"></div>';
  sandbox = { document, location: { origin: 'http://test' }, apiCall: vi.fn().mockResolvedValue({ agents: rows }), showToast: vi.fn() };
  runInNewContext(code, sandbox);
});

afterEach(() => stylesheet.remove());

describe('independent node registry groups', () => {
  it('reserves space for the dropdown arrow in all three classification states', async () => {
    await sandbox.fetchAgents();
    const selects = Array.from(document.querySelectorAll('select'));
    expect(selects.map(select => select.value)).toEqual(['managed', '', 'external']);
    for (const select of selects) {
      const style = getComputedStyle(select);
      expect(select.style.padding).toBe('');
      expect(style.width).toBe('120px');
      expect(style.paddingRight).toBe('32px');
      expect(style.flexShrink).toBe('0');
      expect(style.minHeight).toBe('32px');
    }
  });

  it('centers the node row and allows actions and long metadata to wrap', async () => {
    await sandbox.fetchAgents();
    const card = document.querySelector('.agent-card')!;
    expect(getComputedStyle(card).alignItems).toBe('center');
    const actions = getComputedStyle(card.querySelector('.agent-actions')!);
    expect(actions.alignItems).toBe('center');
    expect(actions.flexWrap).toBe('wrap');
    expect(actions.maxWidth).toBe('100%');
    expect(getComputedStyle(card.querySelector('.agent-name')!).overflowWrap).toBe('anywhere');
    expect(getComputedStyle(card.querySelector('.agent-stats span')!).overflowWrap).toBe('anywhere');
  });

  it('shows two categories, preserves offline nodes and marks unclassified registrations', async () => {
    await sandbox.fetchAgents();
    const local = within(document.querySelector('[aria-label="本地节点"]')! as HTMLElement);
    const external = within(document.querySelector('[aria-label="外部节点"]')! as HTMLElement);
    expect(local.getByText('外部字样的自有节点')).toBeTruthy();
    expect(local.getByText('<历史节点>')).toBeTruthy();
    expect(local.getByText('归属待确认')).toBeTruthy();
    expect(external.getByText('服务商节点')).toBeTruthy();
    expect(external.getByText('offline')).toBeTruthy();
    expect(sandbox.apiCall).toHaveBeenCalledTimes(1);
  });

  it('shows both empty categories', async () => {
    sandbox.apiCall.mockResolvedValue({ agents: [] });
    await sandbox.fetchAgents();
    expect(document.body.textContent).toContain('暂无本地节点');
    expect(document.body.textContent).toContain('暂无外部节点');
  });

  it('updates only classification and reloads the matching group', async () => {
    await sandbox.fetchAgents();
    const select = document.querySelector('select')!;
    select.value = 'external';
    sandbox.apiCall.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ agents: rows.map(row => row.agent_id === 'a' ? { ...row, registry_kind: 'external' } : row) });
    await sandbox.setAgentRegistryKind('a', select);
    expect(sandbox.apiCall).toHaveBeenCalledWith('/api/admin/agents/a/registry-kind', { method: 'PUT', body: JSON.stringify({ registry_kind: 'external' }) });
    expect(within(document.querySelector('[aria-label="外部节点"]')! as HTMLElement).getByText('外部字样的自有节点')).toBeTruthy();
  });

  it('restores the saved selection when classification is denied', async () => {
    await sandbox.fetchAgents();
    const select = document.querySelector('select')!;
    select.value = 'external';
    sandbox.apiCall.mockRejectedValueOnce(new Error('Forbidden'));
    await sandbox.setAgentRegistryKind('a', select);
    expect(select.value).toBe('managed');
    expect(select.disabled).toBe(false);
    expect(sandbox.showToast).toHaveBeenCalledWith('Forbidden', 'error');
  });
});
