import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ScriptIterationPanel } from '../../components/ScriptIterationPanel';

describe('ScriptIterationPanel', () => {
  it('keeps generated text as a candidate until the user applies it', async () => {
    const onGenerate = vi.fn().mockResolvedValue('候选剧本第一版');
    const onApply = vi.fn();

    render(
      <ScriptIterationPanel
        fileId="script-1"
        script="原剧本"
        onGenerate={onGenerate}
        onApply={onApply}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/输入修改意见/), {
      target: { value: '加强第一场冲突' },
    });
    fireEvent.click(screen.getByRole('button', { name: '生成新版' }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
      '原剧本',
      '加强第一场冲突',
      '（首次修改，无历史意见）',
    ));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByLabelText('剧本候选稿')).toHaveValue('候选剧本第一版');

    fireEvent.click(screen.getByRole('button', { name: '应用到当前文件' }));
    expect(onApply).toHaveBeenCalledWith('候选剧本第一版');
  });

  it('uses the previous candidate and conversation when iterating again', async () => {
    const onGenerate = vi.fn()
      .mockResolvedValueOnce('候选剧本第一版')
      .mockResolvedValueOnce('候选剧本第二版');

    render(
      <ScriptIterationPanel
        fileId="script-1"
        script="原剧本"
        onGenerate={onGenerate}
        onApply={() => undefined}
        onClose={() => undefined}
      />,
    );

    const input = screen.getByPlaceholderText(/输入修改意见/);
    fireEvent.change(input, { target: { value: '加强冲突' } });
    fireEvent.click(screen.getByRole('button', { name: '生成新版' }));
    await screen.findByDisplayValue('候选剧本第一版');

    fireEvent.change(input, { target: { value: '保留原结局' } });
    fireEvent.click(screen.getByRole('button', { name: '生成新版' }));

    await waitFor(() => expect(onGenerate).toHaveBeenLastCalledWith(
      '候选剧本第一版',
      '保留原结局',
      expect.stringContaining('用户：加强冲突'),
    ));
    expect(screen.getByLabelText('剧本候选稿')).toHaveValue('候选剧本第二版');
  });
});
