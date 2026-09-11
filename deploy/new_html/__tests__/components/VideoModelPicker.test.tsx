import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VideoModelPicker } from '../../components/video/VideoModelPicker';
import { buildVideoModelOptions, type VideoModelOption } from '../../services/videoModelService';

const options: VideoModelOption[] = [
  {
    value: 'MINI',
    label: 'MiniMax Hailuo 2.3 · 首尾帧标准视频模型',
    baseLabel: 'MiniMax Hailuo 2.3',
    runtimeLabel: 'MiniMax-Hailuo-2.3',
    available: true,
    provider: 'minimax',
  },
  {
    value: 'MiniMaxH3',
    label: 'MiniMax H3 · 本地节点模型',
    baseLabel: 'MiniMax H3',
    runtimeLabel: 'MiniMax H3',
    available: false,
    unavailableReason: '处理节点离线',
    provider: 'processing_cluster',
  },
];

describe('VideoModelPicker', () => {
  it('hides retired local profiles without silently changing historical selections', () => {
    const onChange = vi.fn();
    const createOptions = (fastAvailable: boolean) => buildVideoModelOptions([
      { key: 'MINI', available: false, provider: 'minimax' },
      { key: 'Seedance15', available: true, provider: 'seedance' },
      { key: 'WanNode2', available: true },
      { key: 'LTXNode1', available: false },
      { key: 'MiniMaxH3', available: true },
      { key: 'MiniMaxH3Fast', available: fastAvailable, unavailable_reason: '节点维护中' },
      { key: 'MiniMaxH3Mini', available: true },
    ], ['LTXNode1', 'WanNode2', 'MiniMaxH3', 'MINI', 'MiniMaxH3Fast', 'Seedance15', 'MiniMaxH3Mini']);
    const { rerender } = render(<VideoModelPicker value="WanNode2" options={createOptions(false)} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('选择视频生成模型'));
    const labels = () => screen.getAllByRole('option').map(row => row.getAttribute('aria-selected') === 'true' ? 'selected' : row.textContent);
    const rows = screen.getAllByRole('option');
    expect(screen.getByRole('button', { name: '选择视频生成模型' })).toHaveTextContent('选择可用模型');
    expect(rows).toHaveLength(5);
    ['Seedance 1.5', 'Hailuo', 'MiniMax H3', 'MiniMax H3 Mini', 'MiniMax H3 Fast'].forEach((name, index) => {
      expect(rows[index]).toHaveTextContent(name);
    });
    expect(rows[4]).toHaveAttribute('aria-selected', 'false');
    expect(rows[4]).toHaveAttribute('title', '节点维护中');
    fireEvent.click(rows[4]);
    expect(onChange).not.toHaveBeenCalled();
    rerender(<VideoModelPicker value="WanNode2" options={createOptions(true)} onChange={onChange} />);
    expect(screen.getAllByRole('option')[3]).toHaveTextContent('MiniMax H3 Fast');
    expect(labels().filter(label => label === 'selected')).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses a compact Jimeng-style picker and keeps unavailable models visible with their reason', () => {
    const onChange = vi.fn();
    render(<VideoModelPicker value="MINI" options={options} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('选择视频生成模型'));
    const modelRows = screen.getAllByRole('option');
    expect(modelRows).toHaveLength(2);
    expect(modelRows[0]).toHaveTextContent('MiniMax Hailuo 2.3');
    expect(modelRows[1]).toHaveTextContent('本地节点');
    expect(modelRows[1]).toHaveTextContent('不可用');
    expect(modelRows[1]).toHaveTextContent('处理节点离线');
    expect(modelRows[1]).toHaveAttribute('aria-disabled', 'true');
    expect(modelRows[1]).toHaveAttribute('title', '处理节点离线');
    fireEvent.click(modelRows[1]);
    expect(onChange).not.toHaveBeenCalled();
  });
});
