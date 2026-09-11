import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModelPicker } from '../../components/ModelPicker';

describe('ModelPicker', () => {
  it('groups models, selects an available option, and keeps unavailable options visible', () => {
    const onChange = vi.fn();
    render(
      <ModelPicker
        value="online"
        options={[
          { value: 'online', label: '在线模型 · 快速', description: '在线调用', group: '在线 API' },
          { value: 'local', label: '本地模型 · 高质量', group: '本地节点', available: false, unavailableReason: '处理节点离线' },
          { value: 'other', label: '备用模型 · 全能', group: '在线 API' },
        ]}
        onChange={onChange}
        ariaLabel="选择测试模型"
      />,
    );

    fireEvent.click(screen.getByLabelText('选择测试模型'));
    expect(screen.getByText('在线 API')).toBeInTheDocument();
    expect(screen.getByText('本地节点')).toBeInTheDocument();
    const unavailable = screen.getByRole('option', { name: /本地模型/ });
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    expect(unavailable).toHaveTextContent('处理节点离线');
    fireEvent.click(unavailable);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('option', { name: /备用模型/ }));
    expect(onChange).toHaveBeenCalledWith('other');
  });
});
