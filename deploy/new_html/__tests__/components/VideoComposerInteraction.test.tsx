import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SeedanceMultimodalPanel } from '../../components/SeedanceMultimodalPanel';
import { VideoControlPopover } from '../../components/video/VideoControlPopover';
import { VideoPromptField } from '../../components/video/VideoPromptField';
import { SeedanceMentionPromptEditor } from '../../components/SeedanceMentionPromptEditor';
import type { SeedanceParams } from '../../services/videoModelService';
import { uploadImage, uploadVideoFile } from '@runtime/videoMediaService';

vi.mock('../../hooks/useScriptModelOptions', () => ({ useScriptModelOptions: () => [] }));
vi.mock('@runtime/videoMediaService', () => ({
  uploadImage: vi.fn(), uploadVideoFile: vi.fn(), uploadAudio: vi.fn(),
}));

const initial: SeedanceParams = {
  sub_model: 'standard', prompt: '缓缓推进 @图片1，跟随 @图片2', duration: 5,
  media_inputs: [
    { kind: 'image', role: 'reference_image', url: '/one.png' },
    { kind: 'image', role: 'reference_image', url: '/two.png' },
  ],
};
function Composer({ value = initial }: { value?: SeedanceParams }) {
  const [params, setParams] = useState(value);
  return <><SeedanceMultimodalPanel value={params} onChange={setParams} candidates={[]} />
    <output data-testid="saved-state">{JSON.stringify(params)}</output></>;
}
const saved = () => JSON.parse(screen.getByTestId('saved-state').textContent || '{}') as SeedanceParams;

describe('compact video composer interactions', () => {
  it('renders mention choices outside the card and preserves keyboard selection', () => {
    const onChange = vi.fn();
    const { container } = render(<SeedanceMentionPromptEditor fillHeight autoOpenOnMount
      value={{ ...initial, prompt: '@', media_inputs: [] }} onChange={onChange}
      candidates={[{ id: 'frame', group: 'assets', kind: 'image', label: '山谷参考', url: '/valley.png' }]} />);
    expect(container).not.toContainElement(screen.getByRole('listbox'));
    fireEvent.keyDown(screen.getByPlaceholderText('搜索...'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      media_inputs: [expect.objectContaining({ url: '/valley.png' })],
    }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('portals controls outside clipping parents and closes on outside click and Escape', () => {
    const { container } = render(<div style={{ overflow: 'hidden' }}><VideoControlPopover title="参数" label="设置"><input aria-label="参数值" /></VideoControlPopover></div>);
    const trigger = screen.getByRole('button', { name: '参数' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(container).not.toContainElement(screen.getByRole('dialog'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps an explicitly selected empty first/last-frame mode and its parameter values', () => {
    render(<Composer value={{ ...initial, media_inputs: [], seed: 42, ratio: '9:16', resolution: '720p' }} />);
    fireEvent.change(screen.getByLabelText('Seedance 生成模式'), { target: { value: 'first_last' } });
    expect(screen.getByTitle('添加首帧')).toBeInTheDocument();
    expect(screen.getByTitle('添加尾帧')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '新的动作' } });
    expect(saved()).toMatchObject({ reference_mode: 'first_last', prompt: '新的动作', seed: 42, ratio: '9:16', resolution: '720p' });
  });

  it('shows each reference once and renumbers mentions when removed', () => {
    render(<Composer />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '移除素材 1' }));
    expect(saved().media_inputs).toEqual([initial.media_inputs[1]]);
    expect(saved().prompt).toContain('@图片1');
    expect(saved().prompt).not.toContain('@图片2');
  });

  it('retains overflow media during mode switches without blocking prompt edits', () => {
    const media = [...initial.media_inputs, { kind: 'image' as const, url: '/three.png', role: 'reference_image' as const }, { kind: 'audio' as const, url: '/voice.mp3', role: 'reference_audio' as const }];
    render(<Composer value={{ ...initial, media_inputs: media }} />);
    fireEvent.change(screen.getByLabelText('Seedance 生成模式'), { target: { value: 'first_last' } });
    expect(screen.getByRole('alert')).toHaveTextContent('最多使用 2 张图片');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '继续修改' } });
    expect(saved().prompt).toBe('继续修改');
    expect(saved().media_inputs).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('Seedance 生成模式'), { target: { value: 'reference' } });
    expect(saved().media_inputs).toEqual(media);
  });

  it('does not show a remaining tail image as the first image after deleting the first frame', () => {
    render(<Composer value={{ ...initial, reference_mode: 'first_last', media_inputs: [{ ...initial.media_inputs[0], role: 'first_frame' }, { ...initial.media_inputs[1], role: 'last_frame' }] }} />);
    fireEvent.click(screen.getByRole('button', { name: '删除首帧' }));
    expect(screen.getByTitle('添加首帧')).toBeInTheDocument();
    expect(screen.getByAltText('尾帧')).toHaveAttribute('src', '/two.png');
  });

  it.each(['image', 'video'] as const)('retains every uploaded %s in a batch and merges concurrent prompt edits', async kind => {
    let resolveFirst!: (result: any) => void;
    const upload = kind === 'image' ? vi.mocked(uploadImage) : vi.mocked(uploadVideoFile);
    upload.mockReset();
    upload.mockImplementationOnce(() => new Promise<any>(resolve => { resolveFirst = resolve; }));
    upload.mockResolvedValueOnce({ url: '/uploaded-two', duration_seconds: 5 } as any);
    render(<Composer value={{ ...initial, media_inputs: [] }} />);
    fireEvent.change(screen.getByLabelText(kind === 'image' ? '上传参考图片' : '上传参考视频'), {
      target: { files: [new File(['one'], 'one'), new File(['two'], 'two')] },
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '上传时继续编辑' } });
    resolveFirst({ url: '/uploaded-one', duration_seconds: 5 });
    await waitFor(() => expect(saved().media_inputs).toHaveLength(2));
    expect(saved().media_inputs.map(item => item.url)).toEqual(['/uploaded-one', '/uploaded-two']);
    expect(saved().prompt).toBe('上传时继续编辑');
  });

  it.each(['agent_plan', 'standard', 'fast', 'mini'] as const)('keeps %s output and audio controls available only when opened', sub_model => {
    render(<Composer value={{ ...initial, sub_model, generate_audio: true, media_inputs: [] }} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '声音与参考配音' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'AI 生成配音' }));
    expect(saved().generate_audio).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '画面规格' }));
    const dialog = screen.getByRole('dialog', { name: '画面规格' });
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(2);
    const high = within(dialog).getByRole('option', { name: '1080P' });
    expect((high as HTMLOptionElement).disabled).toBe(sub_model === 'fast' || sub_model === 'mini');
  });

  it('edits long plain prompts in the expanded editor without a second copy of state', () => {
    const onChange = vi.fn();
    render(<VideoPromptField value="原始提示词" onChange={onChange} hint="说明" />);
    fireEvent.click(screen.getByRole('button', { name: '放大编辑' }));
    fireEvent.change(screen.getByLabelText('放大编辑提示词内容'), { target: { value: '完整的新提示词' } });
    expect(onChange).toHaveBeenCalledWith('完整的新提示词');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
