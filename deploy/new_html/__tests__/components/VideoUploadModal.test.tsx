import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoUploadModal } from '../../components/video/VideoUploadModal';
import { readUploadedVideoDuration } from '../../services/videoUploadService';

vi.mock('../../services/videoUploadService', async importOriginal => ({
  ...await importOriginal<typeof import('../../services/videoUploadService')>(), readUploadedVideoDuration: vi.fn(),
}));
const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
const targets = [
  { uuid: 'shot-1', label: '镜头1-1', hasResult: true, busy: false },
  { uuid: 'shot-2', label: '镜头1-2', hasResult: false, busy: false },
  { uuid: 'shot-3', label: '镜头1-3', hasResult: true, busy: true },
];
const chooseFile = () => fireEvent.change(screen.getByLabelText('选择视频文件'), { target: { files: [file] } });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(readUploadedVideoDuration).mockResolvedValue(12432); });
afterEach(cleanup);

describe('external video upload modal', () => {
  it('imports a standalone full video with measured duration and no generation charge', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<VideoUploadModal targets={targets} onImport={onImport} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('上传不扣生成点数');
    expect(screen.getByRole('button', { name: '上传并导入' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeChecked();
    chooseFile();
    await screen.findByText(/clip.mp4 ·/);
    fireEvent.click(screen.getByRole('button', { name: '上传并导入' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onImport).toHaveBeenCalledWith(file, 12432, '', true, {});
  });

  it('preserves existing selection by default and allows explicit replacement', async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    render(<VideoUploadModal targets={targets} initialTarget="shot-1" onImport={onImport} onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    chooseFile();
    await screen.findByText(/clip.mp4 ·/);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '上传并导入' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(file, 12432, 'shot-1', true, {}));
  });

  it('blocks double submits and retries with the same receipt after a save failure', async () => {
    let reject!: (error: Error) => void;
    const onImport = vi.fn().mockImplementationOnce((_file, _duration, _target, _select, draft) => {
      draft.segmentId = 'seg-1';
      return new Promise((_resolve, failure) => { reject = failure; });
    }).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<VideoUploadModal targets={targets} onImport={onImport} onClose={onClose} />);
    chooseFile();
    await screen.findByText(/clip.mp4 ·/);
    fireEvent.click(screen.getByRole('button', { name: '上传并导入' }));
    fireEvent.click(screen.getByRole('button', { name: '正在上传并保存…' }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('关闭上传')).toBeDisabled();
    expect(screen.getByLabelText('导入位置')).toBeDisabled();
    await act(async () => reject(new Error('保存失败，请重试')));
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '上传并导入' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(2));
    expect(onImport.mock.calls[1][4]).toBe(onImport.mock.calls[0][4]);
    expect(onImport.mock.calls[1][4]).toEqual({ segmentId: 'seg-1' });
  });

  it('does not submit invalid files or busy/removed target shots', async () => {
    vi.mocked(readUploadedVideoDuration).mockRejectedValueOnce(new Error('视频文件为空'));
    const onImport = vi.fn();
    const view = render(<VideoUploadModal targets={targets} initialTarget="shot-2" onImport={onImport} onClose={vi.fn()} />);
    chooseFile();
    await screen.findByText('视频文件为空');
    expect(screen.getByRole('button', { name: '上传并导入' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('选择视频文件'), { target: { files: [new File(['x'], 'second.mp4')] } });
    await screen.findByText(/second.mp4 ·/);
    view.rerender(<VideoUploadModal targets={[]} initialTarget="shot-2" onImport={onImport} onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('目标镜头正在处理或已移除');
    expect(screen.getByRole('button', { name: '上传并导入' })).toBeDisabled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('aborts old metadata reads when another file is chosen or the modal is closed', async () => {
    vi.mocked(readUploadedVideoDuration).mockReturnValue(new Promise(() => {}));
    const view = render(<VideoUploadModal targets={targets} onImport={vi.fn()} onClose={vi.fn()} />);
    chooseFile();
    const firstSignal = vi.mocked(readUploadedVideoDuration).mock.calls[0][1]!;
    fireEvent.change(screen.getByLabelText('选择视频文件'), { target: { files: [new File(['x'], 'second.mp4')] } });
    expect(firstSignal.aborted).toBe(true);
    const secondSignal = vi.mocked(readUploadedVideoDuration).mock.calls[1][1]!;
    view.unmount();
    expect(secondSignal.aborted).toBe(true);
  });
});
