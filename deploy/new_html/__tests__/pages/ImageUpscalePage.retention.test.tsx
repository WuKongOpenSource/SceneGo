import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImageUpscalePage } from '../../pages/ImageUpscalePage';
import { apiBlob, apiJson } from '../../services/httpClient';
import { processMaterial } from '@runtime/comfyuiBridgeService';

vi.mock('react-router-dom', () => ({ useParams: () => ({}) }));
vi.mock('@runtime/comfyuiBridgeService', () => ({ processMaterial: vi.fn(), uploadImageToComfyUI: vi.fn() }));
vi.mock('@runtime/comfyuiTaskWaitService', () => ({ waitForComfyUITask: vi.fn() }));
vi.mock('../../services/creditService', () => ({ estimateCredits: vi.fn().mockResolvedValue({ enabled: true, estimated_cost: 18 }) }));
vi.mock('../../services/httpClient', () => ({ apiJson: vi.fn(), apiBlob: vi.fn() }));

const completedTask = {
  task_id: 'image-upscale-history', task_type: 'image_upscale', status: 'completed',
  completed_at: '2026-09-05T10:12:01+08:00', created_at: '2026-09-05T10:00:00+08:00',
  data: { requested_workflow_type: 'image_upscale', target_long_edge: 50000, dpi: 300 },
};

async function openHistory(overrides: Record<string, unknown> = {}) {
  vi.mocked(apiJson).mockResolvedValue({ tasks: [{ ...completedTask, ...overrides }] });
  render(<ImageUpscalePage />);
  fireEvent.click(screen.getByRole('tab', { name: '放大历史' }));
  await screen.findByText('已完成');
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('image upscale history retention', () => {
  it('shows the expiry alongside local delivery without enabling a missing download', async () => {
    await openHistory({ result: { delivery: { kind: 'local_device' } } });
    expect(screen.getByText('预计于 2026年10月05日 10时12分删除')).toBeInTheDocument();
    expect(screen.getByText('结果已保存到本机')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '本机文件' })).toBeDisabled();
    expect(apiBlob).not.toHaveBeenCalled();
    expect(processMaterial).not.toHaveBeenCalled();
  });

  it('prefers the result expiry even when local delivery is recorded', async () => {
    await openHistory({ result: { delivery: { kind: 'local_device' }, images: [{
      url: '/result.png', expires_at: '2026-10-06T03:30:00Z',
    }] } });
    expect(screen.getByText('预计于 2026年10月06日 11时30分删除')).toBeInTheDocument();
    expect(screen.getByText('结果已保存到本机')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新下载' })).toBeEnabled();
  });

  it('keeps the expiry on ordinary downloadable history', async () => {
    await openHistory({ result: { images: ['/result.png'] } });
    expect(screen.getByText('预计于 2026年10月05日 10时12分删除')).toBeInTheDocument();
    expect(screen.queryByText('结果已保存到本机')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新下载' })).toBeEnabled();
  });

  it('falls back to the creation time when completion and result times are unavailable', async () => {
    await openHistory({ completed_at: null, result: { images: [{ expires_at: 'invalid' }] } });
    expect(screen.getByText('预计于 2026年10月05日 10时00分删除')).toBeInTheDocument();
  });

  it('explains an unknown expiry instead of inventing a date or leaving it blank', async () => {
    await openHistory({ completed_at: null, created_at: 'invalid', result: { delivery: { kind: 'local_device' } } });
    expect(screen.getByText('过期时间未知（结果保留 30 天）')).toBeInTheDocument();
  });

  it.each(['running', 'failed'])('does not show completed-result expiry for %s tasks', async status => {
    vi.mocked(apiJson).mockResolvedValue({ tasks: [{ ...completedTask, status, completed_at: null }] });
    render(<ImageUpscalePage />);
    fireEvent.click(screen.getByRole('tab', { name: '放大历史' }));
    await screen.findByText(status === 'running' ? '处理中' : '失败');
    expect(screen.queryByText(/预计于.*删除|过期时间未知/)).not.toBeInTheDocument();
  });
});
