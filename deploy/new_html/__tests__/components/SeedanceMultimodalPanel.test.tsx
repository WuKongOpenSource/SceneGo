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
