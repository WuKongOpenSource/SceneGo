import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImageUpscalePage } from '../../pages/ImageUpscalePage';
import { processMaterial, uploadImageToComfyUI } from '@runtime/comfyuiBridgeService';
import { waitForComfyUITask } from '@runtime/comfyuiTaskWaitService';
import { apiJson, apiBlob } from '../../services/httpClient';

vi.mock('react-router-dom', () => ({ useParams: () => ({}) }));
vi.mock('@runtime/comfyuiBridgeService', () => ({ processMaterial: vi.fn(), uploadImageToComfyUI: vi.fn() }));
vi.mock('@runtime/comfyuiTaskWaitService', () => ({ waitForComfyUITask: vi.fn() }));
vi.mock('../../services/creditService', () => ({ estimateCredits: vi.fn().mockResolvedValue({ enabled: true, estimated_cost: 50 }) }));
vi.mock('../../services/httpClient', () => ({ apiJson: vi.fn(), apiBlob: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Image', class { naturalWidth = 793; naturalHeight = 1722; onload = () => {}; set src(_: string) { queueMicrotask(() => this.onload()); } });
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:preview'); static revokeObjectURL = vi.fn(); });
  vi.mocked(apiJson).mockResolvedValue({ tasks: [] });
  vi.mocked(uploadImageToComfyUI).mockResolvedValue({ success: true, filename: 'original.png', file_id: 'source-id', storage_url: '/original.png' });
  vi.mocked(processMaterial).mockResolvedValue({ success: true, task_id: 'task-id' } as any);
  vi.mocked(waitForComfyUITask).mockResolvedValue('/api/node-outputs/task-id/output/download');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function select(file = new File(['original'], '海报.png', { type: 'image/png' })) {
  const { container } = render(<ImageUpscalePage />);
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
  await screen.findByAltText('待放大原图预览');
  return file;
}

describe('image upscale complete UI contract (mocked generation)', () => {
  it.each([4096, 8192, 16000, 32000, 50000].flatMap(edge => [72, 150, 300].flatMap(dpi => [false, true].map(text => [edge, dpi, text] as const))))(
    'submits original bytes with %i px / %i DPI / text %s', async (edge, dpi, text) => {
      const file = await select();
      fireEvent.click(screen.getByRole('button', { name: edge === 4096 ? '4K' : edge === 8192 ? '8K' : `${edge / 1000}K` }));
      fireEvent.click(screen.getByRole('button', { name: `${dpi} DPI` }));
      if (text) fireEvent.click(screen.getByRole('switch', { name: '文字清晰' }));
      fireEvent.click(screen.getByRole('button', { name: /加入处理队列/ }));
      await waitFor(() => expect(waitForComfyUITask).toHaveBeenCalledTimes(1));
      expect(uploadImageToComfyUI).toHaveBeenCalledExactlyOnceWith(file, { standalone: true });
      expect(processMaterial).toHaveBeenCalledExactlyOnceWith('original.png', 'image_upscale', expect.objectContaining({ targetLongEdge: edge, dpi, textClarity: text, sourceFileId: 'source-id' }));
      expect(await screen.findByRole('button', { name: /下载/ })).toBeEnabled();
    });

  it('does not submit or charge when upload fails', async () => {
    vi.mocked(uploadImageToComfyUI).mockRejectedValue(new TypeError('Failed to fetch'));
    await select();
    fireEvent.click(screen.getByRole('button', { name: /加入处理队列/ }));
    await screen.findByText(/上传图片时网络连接失败/);
    expect(processMaterial).not.toHaveBeenCalled();
  });

  it('does not auto-submit again after a lost progress response', async () => {
    vi.mocked(waitForComfyUITask).mockRejectedValue(new TypeError('Failed to fetch'));
    await select();
    fireEvent.click(screen.getByRole('button', { name: /加入处理队列/ }));
    await screen.findByText(/勿重复提交/);
    expect(processMaterial).toHaveBeenCalledTimes(1);
  });

  it('uses a download ticket rather than loading a huge output blob in memory', async () => {
    await select();
    fireEvent.click(screen.getByRole('button', { name: /加入处理队列/ }));
    const download = await screen.findByRole('button', { name: /下载/ });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.mocked(apiJson).mockImplementation(async (url: string) => url.endsWith('/ticket') ? { download_url: '/api/node-outputs/download/opaque-ticket' } as any : { tasks: [] });
    fireEvent.click(download);
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(apiBlob).not.toHaveBeenCalled();
    expect(apiJson).toHaveBeenCalledWith('/api/node-outputs/task-id/output/ticket', { method: 'POST' }, expect.any(String));
  });
});
