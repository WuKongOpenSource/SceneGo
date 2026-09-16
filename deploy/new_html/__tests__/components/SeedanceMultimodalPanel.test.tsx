import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useScriptModelOptions', () => ({
  useScriptModelOptions: () => [],
}));

import { SeedanceMultimodalPanel } from '../../components/SeedanceMultimodalPanel';
import { CardDurationField } from '../../components/video/CardDurationField';
import type { SeedanceParams } from '../../services/videoModelService';

const agentPlanValue: SeedanceParams = {
  sub_model: 'agent_plan',
  prompt: '人物缓慢转身，镜头平稳推进',
  media_inputs: [
    { kind: 'image', url: '/first.png', role: 'first_frame' },
    { kind: 'audio', url: '/reference.mp3', role: 'reference_audio' },
  ],
  resolution: '720p',
  ratio: '16:9',
  duration: 5,
  seed: -1,
  watermark: false,
  generate_audio: true,
  camera_fixed: false,
};

describe('Seedance 1.5 Pro controls', () => {
  it.each(['standard', 'fast', 'mini'] as const)('keeps portrait settings in More without a nested composer scroll area for %s', sub_model => {
    const onChange = vi.fn();
    const value: SeedanceParams = {
      ...agentPlanValue, sub_model, reference_mode: 'reference',
      portrait_reference_mode: 'character_background',
      prompt: '镜头平稳推进，保留角色及画面细节。'.repeat(100),
      media_inputs: [{ kind: 'image', role: 'reference_image', url: '/original.png' }],
    };
    render(<div style={{ width: 480, height: 254 }}>
      <SeedanceMultimodalPanel value={value} onChange={onChange} candidates={[]} />
    </div>);
    const content = screen.getByTestId('seedance-composer-content');
    const body = screen.getByTestId('seedance-composer-body');
    const shelf = screen.getByTestId('seedance-reference-shelf');
    expect(content).not.toHaveClass('overflow-y-auto');
    expect(body).toHaveClass('min-h-[112px]', 'shrink-0');
    expect(body).not.toHaveClass('min-h-0');
    expect(screen.queryByTestId('portrait-reference-control')).not.toBeInTheDocument();
    expect(shelf.nextElementSibling).toBe(body);
    expect(screen.queryByTestId('seedance-reference-strip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
    const portrait = screen.getByTestId('portrait-reference-control');
    expect(portrait.closest('[role="dialog"]')).toHaveAttribute('aria-label', '高级设置');
    expect(content.contains(portrait)).toBe(false);
    expect(screen.getByLabelText('生成仿真人视频（人物四视图 + 纯背景）')).toBeChecked();
    expect(screen.getByRole('textbox')).toHaveValue(value.prompt);
    expect(onChange).not.toHaveBeenCalled();
  });
  it.each(['standard', 'fast', 'mini'] as const)('aligns the portrait control and preserves references for %s', sub_model => {
    const onChange = vi.fn();
    const value = { ...agentPlanValue, sub_model, media_inputs: [] } as SeedanceParams;
    const { rerender } = render(<SeedanceMultimodalPanel value={value} onChange={onChange} candidates={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
    const checkbox = screen.getByLabelText('生成仿真人视频（人物四视图 + 纯背景）');
    expect(checkbox).toHaveClass('m-0', 'shrink-0');
    expect(checkbox.closest('label')).toHaveClass('inline-flex', 'items-center', 'gap-2');
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      sub_model, media_inputs: [], reference_mode: 'reference', portrait_reference_mode: 'character_background',
    }));
    rerender(<SeedanceMultimodalPanel value={{ ...value, portrait_reference_mode: 'character_background' }} onChange={onChange} candidates={[]} />);
    const description = screen.getByTestId('portrait-reference-control').querySelector('p');
    expect(description).toBeInTheDocument();
    expect(description?.closest('label')).toBeNull();
  });
  it.each(['首帧', '尾帧'])('selects %s directly from the card pool without changing the other frame, prompt or audio', label => {
    const onChange = vi.fn();
    render(<SeedanceMultimodalPanel value={agentPlanValue} onChange={onChange} supportsMultimodal={false} candidates={[
      { id: 'pool', label: '画面2', kind: 'image', group: 'current_card', url: '/pool-original.png', thumbnailUrl: '/thumbnail.png' },
    ]} />);
    fireEvent.click(label === '首帧' ? screen.getByRole('button', { name: '首帧 · 替换' }) : screen.getByTitle('添加尾帧'));
    fireEvent.click(screen.getByRole('button', { name: /画面2/ }));
    fireEvent.click(screen.getByRole('button', { name: `设为${label}` }));
    const next = onChange.mock.calls[0][0];
    expect(next.prompt).toBe(agentPlanValue.prompt);
    expect(next.media_inputs).toContainEqual(agentPlanValue.media_inputs[1]);
    expect(next.media_inputs).toContainEqual({ kind: 'image', url: '/pool-original.png', role: label === '首帧' ? 'first_frame' : 'last_frame' });
    if (label === '尾帧') expect(next.media_inputs).toContainEqual(agentPlanValue.media_inputs[0]);
  });
  it('adds a project-library tail in first/last mode without replacing the first frame or prompt', () => {
    const onChange = vi.fn();
    render(<SeedanceMultimodalPanel value={agentPlanValue} onChange={onChange} supportsMultimodal={false} candidates={[
      { id: 'tail', label: '项目尾帧', kind: 'image', group: 'assets', url: '/tail-original.png', thumbnailUrl: '/thumb.png' },
    ]} />);
    fireEvent.click(screen.getByRole('button', { name: '素材管理' }));
    fireEvent.click(screen.getByRole('button', { name: '素材库' }));
    fireEvent.click(screen.getByRole('button', { name: /项目尾帧/ }));
    fireEvent.click(screen.getByRole('button', { name: '添加 1 项' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ prompt: agentPlanValue.prompt, media_inputs: [
      ...agentPlanValue.media_inputs, { kind: 'image', url: '/tail-original.png', role: 'last_frame' },
    ] }));
  });
  it('uses dedicated first/last-frame UI and retains reference dubbing without the 2.0 warning', () => {
    render(
      <SeedanceMultimodalPanel
        value={agentPlanValue}
        onChange={vi.fn()}
        candidates={[]}
        supportsMultimodal={false}
        audioReferenceNotice="参考配音会保留在卡片中，提交时不发送。"
      />,
    );

    expect(screen.getByText(/最多 2 张图片/)).toBeInTheDocument();
    expect(screen.queryByText('参考配音')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '声音与参考配音' }));
    expect(screen.getByTitle('添加尾帧')).toBeInTheDocument();
    expect(screen.getByText('参考配音')).toBeInTheDocument();
    expect(screen.getAllByText('reference.mp3').length).toBeGreaterThan(0);
    expect(screen.queryByText(/图片 .*\/9/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Seedance 2\.0 不支持直接上传/)).not.toBeInTheDocument();
    expect(screen.getByTestId('seedance15-control-row')).toHaveClass('flex-wrap');
    fireEvent.click(screen.getByRole('button', { name: '画面规格' }));
    expect(screen.getByLabelText('Seedance 1.5 画面比例')).toHaveValue('16:9');
    expect(Array.from((screen.getByLabelText('Seedance 1.5 清晰度') as HTMLSelectElement).options).map(option => option.value)).toEqual(['720p', '1080p']);
  });

  it('renders a bounded 3–12 second slider for Seedance 1.5 Pro', () => {
    render(
      <CardDurationField
        duration={5}
        userOverride={false}
        onChange={vi.fn()}
        onClear={vi.fn()}
        maxDuration={12}
        variant="seedance15"
      />,
    );

    const durationSummary = screen.getByLabelText('Seedance 1.5 Pro 时长设置');
    expect(durationSummary).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    fireEvent.click(durationSummary);
    const slider = screen.getByRole('slider', { name: 'Seedance 1.5 Pro 视频时长' });
    expect(slider).toHaveAttribute('min', '3');
    expect(slider).toHaveAttribute('max', '12');
    expect(screen.getByText('3–12 秒')).toBeInTheDocument();
  });
});

describe('Seedance 2.0 Jimeng-style controls', () => {
  it('requires explicit consent for reference-only trimming and previews proportional prefixes', () => {
    const value = { ...agentPlanValue, sub_model: 'mini' as const, reference_audio_policy: 'trim_to_15' as const, media_inputs: [
      { kind: 'audio' as const, url: '/one.wav', duration_seconds: 15.804 },
      { kind: 'audio' as const, url: '/two.wav', duration_seconds: 8.028 },
    ] };
    const onChange = vi.fn();
    render(<SeedanceMultimodalPanel value={value} onChange={onChange} candidates={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '声音与参考配音' }));
    expect(screen.getByText(/配音 1 9.947 秒；配音 2 5.052 秒/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('仅裁剪参考副本至 15 秒内'));
    expect(onChange).toHaveBeenCalledWith({ ...value, reference_audio_policy: 'preserve' });
    expect(value.media_inputs[0].duration_seconds).toBe(15.804);
  });
  it('displays per-clip and total audio duration with the budget and no silent edits', () => {
    const onChange = vi.fn();
    render(<SeedanceMultimodalPanel value={{ ...agentPlanValue, sub_model: 'mini', media_inputs: [
      { kind: 'audio', url: '/one.wav', duration_seconds: 8.028 },
      { kind: 'audio', url: '/two.wav', duration_seconds: 8.028 },
    ] }} onChange={onChange} candidates={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '声音与参考配音' }));
    expect(screen.getAllByText('8.028 秒')).toHaveLength(2);
    expect(screen.getByText('参考配音合计：16.056 秒')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('合计不超过 15 秒');
    expect(onChange).not.toHaveBeenCalled();
  });
  it.each([undefined, '720P'])('displays canonical default resolution for %s without changing saved parameters', resolution => {
    const onChange = vi.fn();
    render(<SeedanceMultimodalPanel value={{ ...agentPlanValue, sub_model: 'mini', resolution } as SeedanceParams} onChange={onChange} candidates={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '画面规格' }));
    expect(screen.getByLabelText('选择清晰度')).toHaveValue('720p');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('warns about a saved upper-case unsupported resolution', () => {
    render(<SeedanceMultimodalPanel value={{ ...agentPlanValue, sub_model: 'mini', resolution: '1080P' } as unknown as SeedanceParams} onChange={vi.fn()} candidates={[]} />);
    expect(screen.getByText(/仅支持 480P 或 720P/)).toBeInTheDocument();
  });

  it('shows all-reference and first/last-frame modes with explicit reference guidance', () => {
    const onChange = vi.fn();
    render(
      <SeedanceMultimodalPanel
        value={{
          ...agentPlanValue,
          sub_model: 'standard',
          media_inputs: [{ kind: 'image', url: '/reference.png', role: 'reference_image' }],
        }}
        onChange={onChange}
        candidates={[]}
        supportsMultimodal
      />,
    );

    expect(screen.getByTestId('seedance-jimeng-composer')).toBeInTheDocument();
    expect(screen.getAllByText(/最多输入 15 个参考素材/).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText(/输入文字描述，或输入 @ 选择参考内容/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '全能参考' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '首尾帧' })).toBeInTheDocument();
    expect(screen.getByTestId('seedance-jimeng-composer')).toHaveClass('h-full');
    expect(screen.queryByTestId('seedance-output-selectors')).not.toBeInTheDocument();
    expect(screen.getByTestId('seedance-control-row')).toHaveClass('flex-wrap');
    const body = screen.getByTestId('seedance-composer-body');
    const content = screen.getByTestId('seedance-composer-content');
    const shelf = screen.getByTestId('seedance-reference-shelf');
    expect(shelf.parentElement).toBe(content);
    expect(shelf.nextElementSibling).toBe(body);
    expect(screen.queryByTestId('seedance-reference-strip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('seedance-media-rail')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '图片1' })).toHaveClass('object-cover');
    expect(screen.getByPlaceholderText(/输入文字描述，或输入 @ 选择参考内容/)).toHaveClass('min-h-[96px]');

    expect(screen.queryByLabelText('选择比例')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '画面规格' }));
    const ratioSelect = screen.getByLabelText('选择比例') as HTMLSelectElement;
    expect(Array.from(ratioSelect.options).map(option => option.value)).toEqual([
      'adaptive', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9',
    ]);
    const resolutionSelect = screen.getByLabelText('选择清晰度') as HTMLSelectElement;
    expect(Array.from(resolutionSelect.options).map(option => option.value)).toEqual([
      '480p', '720p', '1080p',
    ]);
    expect(ratioSelect.closest('[role="dialog"]')).toHaveAttribute('aria-label', '画面规格');
    expect(resolutionSelect.closest('[role="dialog"]')).toHaveAttribute('aria-label', '画面规格');

    fireEvent.change(screen.getByLabelText('Seedance 生成模式'), { target: { value: 'first_last' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      media_inputs: [expect.objectContaining({ role: 'first_frame' })],
    }));
  });
});
