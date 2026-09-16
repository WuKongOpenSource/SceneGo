import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { H3VideoPanel } from '../../components/video/H3VideoPanel';
import type { TaskGroup } from '../../services/videoTaskTypes';
vi.mock('../../components/AIRewritePromptModal', () => ({ AIRewritePromptModal: () => null }));
vi.mock('../../hooks/useSeedanceCandidates', () => ({ useSeedanceCandidates: () => ({ candidates: [
  { id: 'person', group: 'assets', kind: 'image', label: '人物原图', url: '/person.png', fileId: 'person-file' },
  { id: 'video', group: 'assets', kind: 'video', label: '视频不支持', url: '/v.mp4' },
] }) }));
const cardImages = [{ id: 'a', url: '/a.png', storageUrl: '/original-a.png', filename: 'a.png', uploadTime: 0 }];
function Harness() {
  const [group, setGroup] = useState<TaskGroup>({ uuid: 'g', ids: ['a'], model: 'MiniMaxH3' });
  const [prompt, setPrompt] = useState('原首尾帧提示词');
  return <><H3VideoPanel group={group} prompt={prompt} cardImages={cardImages} onPatch={patch => setGroup(previous => ({ ...previous, ...patch }))}
    onPromptChange={setPrompt} onPreview={vi.fn()} /><output data-testid="saved">{JSON.stringify(group)}</output></>;
}
describe('H3 mode editor', () => {
  it('preserves first-last prompt and images while switching modes, including reload state', () => {
    render(<Harness />);
    expect(screen.getByDisplayValue('原首尾帧提示词')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('H3 参考模式'), { target: { value: 'reference' } });
    expect(screen.getByRole('img', { name: '图片1' })).toHaveAttribute('src', '/original-a.png');
    expect(screen.getByText(/多图参考节点尚未就绪/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('添加 H3 参考图片'), { target: { value: 'person' } });
    expect(screen.getByRole('img', { name: '图片2' })).toHaveAttribute('src', '/person.png');
    expect(screen.queryByText('视频不支持')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除图片1' }));
    expect(screen.getByRole('img', { name: '图片1' })).toHaveAttribute('src', '/person.png');
    fireEvent.change(screen.getByLabelText('H3 参考模式'), { target: { value: 'first_last' } });
    expect(screen.getByDisplayValue('原首尾帧提示词')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('H3 参考模式'), { target: { value: 'reference' } });
    expect(screen.queryByRole('img', { name: '图片2' })).not.toBeInTheDocument();
    const saved = JSON.parse(screen.getByTestId('saved').textContent!);
    expect(saved.ids).toEqual(['a']);
    expect(saved.h3ReferenceContent.media_inputs[0].file_id).toBe('person-file');
  });
  it('supports @ selection in both inline and expanded editors', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('H3 参考模式'), { target: { value: 'reference' } });
    const editor = screen.getByRole('textbox');
    fireEvent.change(editor, { target: { value: '@', selectionStart: 1 } });
    fireEvent.click(screen.getByRole('button', { name: /人物原图/ }));
    expect(screen.getByRole('textbox')).toHaveValue('图片2');
    fireEvent.click(screen.getByRole('button', { name: '放大编辑' }));
    const dialog = screen.getByRole('dialog', { name: 'H3 多图参考放大编辑' });
    const large = within(dialog).getByRole('textbox');
    fireEvent.change(large, { target: { value: '图片2@', selectionStart: 4 } });
    fireEvent.click(screen.getByRole('button', { name: /人物原图/ }));
    expect(large).toHaveValue('图片2图片2');
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
