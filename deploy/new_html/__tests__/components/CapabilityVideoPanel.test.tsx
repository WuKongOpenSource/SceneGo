import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityVideoPanel, resolveCapabilityParamValue } from '../../components/video/CapabilityVideoPanel';
import type { VideoModelCapability } from '../../services/videoWorkflowService';

const capability: VideoModelCapability = {
  key: '大能',
  label: '大能',
  provider: 'dashscope',
  task_types: ['i2v'],
  media_inputs: ['first_frame'],
  query_mode: 'async',
  parameter_rules: {
    resolution: ['720P', '1080P'],
    duration: { type: 'integer', default: 5, options: [5, 10, 15] },
    shot_type: ['multi', 'single'],
    seed: { type: 'integer', default: -1, minimum: -1 },
    normalization_policy: 'reject_or_explain',
  },
};

describe('CapabilityVideoPanel', () => {
  it('keeps advanced controls collapsed while preserving typed option values', () => {
    const onChange = vi.fn();
    render(<CapabilityVideoPanel capability={{ ...capability, parameter_rules: {
      ...capability.parameter_rules, sampler: { type: 'string', options: ['fast', 'quality'], default: 'fast' },
    } }} value={{ seed: 7 }} prompt="镜头推进" onPromptChange={vi.fn()} onChange={onChange} />);
    expect(screen.queryByDisplayValue('7')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
    expect(screen.getByDisplayValue('7')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('fast'), { target: { value: 'quality' } });
    expect(onChange).toHaveBeenCalledWith({ seed: 7, sampler: 'quality' });
  });

  it('uses backend-declared defaults and controls', () => {
    const onChange = vi.fn();
    render(
      <CapabilityVideoPanel
        capability={capability}
        prompt="镜头推进"
        onChange={onChange}
        onPromptChange={vi.fn()}
      />,
    );

    expect(screen.getByText('清晰度')).toBeInTheDocument();
    expect(screen.getByText('镜头模式')).toBeInTheDocument();
    expect(screen.getByDisplayValue('720P')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('720P'), { target: { value: '1080P' } });
    expect(onChange).toHaveBeenCalledWith({ resolution: '1080P' });
  });

  it('resolves array and object defaults without inventing values', () => {
    expect(resolveCapabilityParamValue(['16:9', '9:16'], undefined)).toBe('16:9');
    expect(resolveCapabilityParamValue({ type: 'integer', default: 5 }, undefined)).toBe(5);
    expect(resolveCapabilityParamValue({ type: 'integer', default: 5 }, 10)).toBe(10);
  });
});
