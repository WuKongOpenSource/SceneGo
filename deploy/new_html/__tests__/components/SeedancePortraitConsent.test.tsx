import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedanceMultimodalPanel } from '../../components/SeedanceMultimodalPanel';
import { checkPortraitReferenceInputs } from '../../services/portraitReferenceService';
import type { SeedanceParams } from '../../services/videoModelService';

vi.mock('../../hooks/useScriptModelOptions', () => ({ useScriptModelOptions: () => [] }));
vi.mock('../../components/SeedreamSourceBadge', () => ({ SeedreamSourceBadge: () => null }));
vi.mock('../../services/portraitReferenceService', async original => ({
  ...await original<typeof import('../../services/portraitReferenceService')>(), checkPortraitReferenceInputs: vi.fn(),
}));
const checkboxLabel = '生成仿真人视频（人物四视图 + 纯背景）';
function portraitCheckbox() {
  if (!screen.queryByLabelText(checkboxLabel)) fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
  return screen.getByLabelText(checkboxLabel);
}
const initial: SeedanceParams = {
  sub_model: 'mini', reference_mode: 'reference', duration: 12,
  prompt: '保留正文：图片1 人物；图片2 不支持；图片3 背景；图片4 图生图；视频1；音频1。',
  media_inputs: [
    { kind: 'image', url: '/hero', file_id: 'file_hero' },
    { kind: 'image', url: '/gemini' },
    { kind: 'audio', url: '/voice', duration_seconds: 5 },
    { kind: 'image', url: '/background', file_id: 'file_background' },
    { kind: 'image', url: '/image-to-image' },
    { kind: 'video', url: '/clip' },
  ],
};
const changed = vi.fn();
function Harness({ start = initial }: { start?: SeedanceParams }) {
  const [value, setValue] = useState(start);
  return <><SeedanceMultimodalPanel value={value} onChange={next => { changed(next); setValue(next); }} candidates={[]} />
    <output data-testid="saved-params">{JSON.stringify(value)}</output></>;
}
const saved = () => JSON.parse(screen.getByTestId('saved-params').textContent!);
const result = (unsupportedIndices = [1, 4, 5]) => ({ unsupportedIndices, expiresAt: Date.now() + 60000 });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(checkPortraitReferenceInputs).mockResolvedValue(result()); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('portrait reference removal consent', () => {
  it.each(['checking', 'confirmation'] as const)('cancels portrait %s on switching to Jimeng without changing media', async phase => {
    let finish!: (value: ReturnType<typeof result>) => void;
    if (phase === 'checking') vi.mocked(checkPortraitReferenceInputs).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const onChange = vi.fn();
    const view = render(<SeedanceMultimodalPanel value={initial} onChange={onChange} candidates={[]} />);
    fireEvent.click(portraitCheckbox());
    if (phase === 'confirmation') await screen.findByRole('dialog', { name: '移除不支持的参考素材？' });
    const signal = vi.mocked(checkPortraitReferenceInputs).mock.calls[0][1];
    view.rerender(<SeedanceMultimodalPanel value={{ ...initial, sub_model: 'jimeng_mini' }} onChange={onChange} candidates={[]} />);
    if (phase === 'checking') {
      expect(signal.aborted).toBe(true);
      await act(async () => finish(result()));
    }
    expect(screen.queryByLabelText(checkboxLabel)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '移除不支持的参考素材？' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    view.rerender(<SeedanceMultimodalPanel value={initial} onChange={onChange} candidates={[]} />);
    expect(portraitCheckbox()).not.toBeChecked();
    expect(portraitCheckbox()).not.toBeDisabled();
  });

  it.each(['standard', 'fast', 'mini'] as const)('requires confirmation before removing unsupported media for %s', async sub_model => {
    render(<Harness start={{ ...initial, sub_model }} />);
    fireEvent.click(portraitCheckbox());
    const dialog = await screen.findByRole('dialog', { name: '移除不支持的参考素材？' });
    expect(portraitCheckbox()).not.toBeChecked();
    expect(changed).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('图片2、图片4、视频1');
    expect(dialog).toHaveTextContent('不删除素材库原图');
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    expect(portraitCheckbox()).toBeChecked();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(saved()).toEqual({ ...initial, sub_model, portrait_reference_mode: 'character_background',
      media_inputs: [initial.media_inputs[0], initial.media_inputs[2], initial.media_inputs[3]],
      prompt: '保留正文：图片1 人物； 不支持；图片2 背景； 图生图；；音频1。',
    });
    expect(initial.media_inputs).toHaveLength(6);
  });

  it.each(['cancel', 'escape', 'backdrop'])('keeps the checkbox off and all original data on %s', async action => {
    render(<Harness />);
    fireEvent.click(portraitCheckbox());
    const dialog = await screen.findByRole('dialog', { name: '移除不支持的参考素材？' });
    if (action === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    else if (action === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.click(dialog.parentElement!);
    expect(screen.queryByRole('dialog', { name: '移除不支持的参考素材？' })).not.toBeInTheDocument();
    expect(portraitCheckbox()).not.toBeChecked();
    expect(saved()).toEqual(initial);
    expect(changed).not.toHaveBeenCalled();
  });

  it('enables directly when all references pass, and disabling never restores removed inputs', async () => {
    vi.mocked(checkPortraitReferenceInputs).mockResolvedValue(result([]));
    render(<Harness start={{ ...initial, media_inputs: [initial.media_inputs[0], initial.media_inputs[3]] }} />);
    fireEvent.click(portraitCheckbox());
    await waitFor(() => expect(portraitCheckbox()).toBeChecked());
    expect(screen.queryByRole('dialog', { name: '移除不支持的参考素材？' })).not.toBeInTheDocument();
    const beforeOff = saved();
    fireEvent.click(portraitCheckbox());
    expect(saved()).toEqual({ ...beforeOff, portrait_reference_mode: undefined });
    expect(checkPortraitReferenceInputs).toHaveBeenCalledTimes(1);
  });

  it('never offers to clear every image, preserving audio, prompt and the unchecked mode', async () => {
    vi.mocked(checkPortraitReferenceInputs).mockResolvedValue(result([0, 1, 3, 4, 5]));
    render(<Harness />);
    fireEvent.click(portraitCheckbox());
    expect(await screen.findByRole('alert')).toHaveTextContent('所有素材和提示词保持不变');
    expect(screen.queryByRole('dialog', { name: '移除不支持的参考素材？' })).not.toBeInTheDocument();
    expect(saved()).toEqual(initial);
    expect(changed).not.toHaveBeenCalled();
    expect(portraitCheckbox()).not.toBeChecked();
  });

  it('leaves everything unchanged if the server check fails', async () => {
    vi.mocked(checkPortraitReferenceInputs).mockRejectedValue(new Error('offline'));
    render(<Harness />);
    fireEvent.click(portraitCheckbox());
    expect(await screen.findByRole('alert')).toHaveTextContent('参考素材检查失败');
    expect(portraitCheckbox()).not.toBeChecked();
    expect(saved()).toEqual(initial);
    expect(changed).not.toHaveBeenCalled();
  });

  it('does not delete when only one image would remain', async () => {
    vi.mocked(checkPortraitReferenceInputs).mockResolvedValue(result([1, 3, 4, 5]));
    render(<Harness />);
    fireEvent.click(portraitCheckbox());
    expect(await screen.findByRole('alert')).toHaveTextContent('不足 2 张');
    expect(saved()).toEqual(initial);
    expect(screen.queryByRole('dialog', { name: '移除不支持的参考素材？' })).not.toBeInTheDocument();
  });

  it('preserves all five historical originals and applies only resolved file identities', async () => {
    const start: SeedanceParams = { ...initial, prompt: '场景图片1 图片2；人物图片3 图片4 图片5',
      media_inputs: Array.from({ length: 5 }, (_, i) => ({ kind: 'image', url: `/original-${i + 1}` })) };
    const normalizedInputs = start.media_inputs.map((item, i) => ({ ...item, file_id: `file_original_${i + 1}` }));
    vi.mocked(checkPortraitReferenceInputs).mockResolvedValue({ ...result([]), normalizedInputs });
    render(<Harness start={start} />);
    fireEvent.click(portraitCheckbox());
    await waitFor(() => expect(portraitCheckbox()).toBeChecked());
    expect(screen.queryByRole('dialog', { name: '移除不支持的参考素材？' })).not.toBeInTheDocument();
    expect(saved().media_inputs).toEqual(normalizedInputs);
    expect(saved().prompt).toBe(start.prompt);
  });

  it('prevents duplicate checks and rejects a result for references changed while checking', async () => {
    let finish!: (value: ReturnType<typeof result>) => void;
    vi.mocked(checkPortraitReferenceInputs).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const onChange = vi.fn();
    const view = render(<SeedanceMultimodalPanel value={initial} onChange={onChange} candidates={[]} />);
    fireEvent.click(portraitCheckbox());
    expect(portraitCheckbox()).toBeDisabled();
    fireEvent.click(portraitCheckbox());
    expect(checkPortraitReferenceInputs).toHaveBeenCalledTimes(1);
    view.rerender(<SeedanceMultimodalPanel value={{ ...initial, media_inputs: initial.media_inputs.slice(1) }} onChange={onChange} candidates={[]} />);
    await act(async () => finish(result()));
    expect(screen.getByRole('alert')).toHaveTextContent('素材或模式已变化');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves prompt edits made during checking when applying confirmed removal', async () => {
    render(<Harness />);
    fireEvent.click(portraitCheckbox());
    const dialog = await screen.findByRole('dialog', { name: '移除不支持的参考素材？' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '最新正文 图片1 图片2 图片3 音频1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    expect(saved().prompt).toBe('最新正文 图片1  图片2 音频1');
  });

  it.each(['references', 'model', 'expired', 'disabled'])('rejects stale confirmation after %s changes', async change => {
    const onChange = vi.fn();
    const check = result();
    vi.mocked(checkPortraitReferenceInputs).mockResolvedValue(check);
    const view = render(<SeedanceMultimodalPanel value={initial} onChange={onChange} candidates={[]} />);
    fireEvent.click(portraitCheckbox());
    const dialog = await screen.findByRole('dialog', { name: '移除不支持的参考素材？' });
    if (change === 'expired') vi.spyOn(Date, 'now').mockReturnValue(check.expiresAt + 1);
    else view.rerender(<SeedanceMultimodalPanel value={change === 'model' ? { ...initial, sub_model: 'fast' }
      : change === 'references' ? { ...initial, media_inputs: [] } : initial} onChange={onChange} candidates={[]} disabled={change === 'disabled'} />);
    fireEvent.click(within(dialog).getByRole('button', { name: '确定' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请重新勾选并检查');
    expect(onChange).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('aborts on unmount without applying delayed data', async () => {
    let finish!: (value: ReturnType<typeof result>) => void;
    vi.mocked(checkPortraitReferenceInputs).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<Harness />);
    fireEvent.click(portraitCheckbox());
    const signal = vi.mocked(checkPortraitReferenceInputs).mock.calls[0][1];
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(result()));
    expect(changed).not.toHaveBeenCalled();
  });
});
