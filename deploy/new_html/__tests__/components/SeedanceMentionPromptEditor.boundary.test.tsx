import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SeedanceMentionPromptEditor } from '../../components/SeedanceMentionPromptEditor';
import { SeedanceMultimodalPanel } from '../../components/SeedanceMultimodalPanel';
import type { SeedanceParams } from '../../services/videoModelService';
import type { SeedanceAssetCandidate } from '../../utils/seedanceMedia';
import { baseParams } from '../utils/_fixtures/seedance';

vi.mock('../../hooks/useScriptModelOptions', () => ({ useScriptModelOptions: () => [] }));

const candidates: SeedanceAssetCandidate[] = [
  { id: 'existing', group: 'assets', kind: 'image', label: '原图', url: '/original.png' },
  { id: 'new', group: 'assets', kind: 'image', label: '背景原图', url: '/background.png', thumbnailUrl: '/thumbnail.png' },
];
const initialValue = (prompt: string) => baseParams({ prompt, sub_model: 'mini', reference_mode: 'reference',
  media_inputs: [{ kind: 'image', url: '/original.png', role: 'reference_image' }],
});

function Harness({ prompt, expanded = false, panel = false }: { prompt: string; expanded?: boolean; panel?: boolean }) {
  const [value, setValue] = useState(initialValue(prompt));
  return <>
    {panel ? <SeedanceMultimodalPanel value={value} onChange={setValue} candidates={candidates} />
      : <SeedanceMentionPromptEditor value={value} onChange={setValue} candidates={candidates}
          fillHeight compactFillHeight={!expanded} rows={expanded ? 20 : 7} hideTokensRow />}
    <output data-testid="saved-mention-value">{JSON.stringify(value)}</output>
  </>;
}
const savedValue = () => JSON.parse(screen.getByTestId('saved-mention-value').textContent!) as SeedanceParams;
const menu = () => screen.getByRole('listbox', { name: 'mention candidates' });

describe('mention trigger after media tokens', () => {
  it.each([false, true])('supports consecutive mentions and dedupes original media in expanded=%s', async expanded => {
    const user = userEvent.setup();
    render(<Harness prompt="动作图片1" expanded={expanded} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.type(textarea, '@');
    await user.click(within(menu()).getByRole('button', { name: /^背景原图\s*image$/ }));
    await waitFor(() => expect(document.activeElement).toBe(textarea));
    expect(textarea).toHaveValue('动作图片1图片2');
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(savedValue().media_inputs.map(media => media.url)).toEqual(['/original.png', '/background.png']);
    await user.keyboard('@');
    await user.click(within(menu()).getByRole('button', { name: /^原图\s*image$/ }));
    await waitFor(() => expect(textarea.selectionStart).toBe(textarea.value.length));
    expect(textarea).toHaveValue('动作图片1图片2图片1');
    expect(savedValue().media_inputs).toHaveLength(2);
  });

  it.each(['图片1', '视频1', '音频1', '图片12', '图片1图片2'])('opens after the complete %s token and supports keyboard search', async token => {
    const user = userEvent.setup();
    render(<Harness prompt={`动作${token}`} />);
    await user.type(screen.getByRole('textbox'), '@');
    const search = within(menu()).getByPlaceholderText('搜索...');
    await user.type(search, '背景');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(savedValue().prompt).toBe(`动作${token}图片2`);
    expect(savedValue().media_inputs[1].url).toBe('/background.png');
  });

  it.each([false, true])('inserts at the token boundary in the actual panel, expanded=%s', async expanded => {
    const user = userEvent.setup();
    render(<Harness prompt="人物图片1，后续动作不变" panel />);
    if (expanded) await user.click(screen.getByRole('button', { name: '放大编辑' }));
    const editor = expanded ? within(screen.getByRole('dialog', { name: '放大编辑提示词' })) : screen;
    const textarea = editor.getByRole('textbox') as HTMLTextAreaElement;
    await user.click(textarea);
    textarea.setSelectionRange('人物图片1'.length, '人物图片1'.length);
    await user.keyboard('@');
    await user.click(within(menu()).getByRole('button', { name: /^背景原图\s*image$/ }));
    expect(textarea).toHaveValue('人物图片1图片2 ，后续动作不变');
    expect(savedValue().prompt).not.toContain('@');
    expect(savedValue().media_inputs.map(media => media.url)).toEqual(['/original.png', '/background.png']);
    if (expanded) {
      await user.click(editor.getByRole('button', { name: '完成' }));
      expect(screen.getByRole('textbox')).toHaveValue(savedValue().prompt);
    }
  });

  it.each(['user123', 'foo_bar', '版本2', '图片1suffix'])('does not trigger in ordinary words: %s', async prefix => {
    const user = userEvent.setup();
    render(<Harness prompt={prefix} />);
    await user.type(screen.getByRole('textbox'), '@');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(savedValue().prompt).toBe(`${prefix}@`);
  });

  it('does not treat the middle of a multi-digit index as a complete token', async () => {
    const user = userEvent.setup();
    render(<Harness prompt="图片12" />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    await user.click(textarea);
    textarea.setSelectionRange(3, 3);
    await user.keyboard('@');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(savedValue().prompt).toBe('图片1@2');
  });

  it('keeps IME suppression and Escape cancellation after a token', async () => {
    const user = userEvent.setup();
    render(<Harness prompt="图片1" />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.compositionStart(textarea);
    fireEvent.change(textarea, { target: { value: '图片1@', selectionStart: 4 } });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.compositionEnd(textarea);
    fireEvent.change(textarea, { target: { value: '图片1', selectionStart: 3 } });
    await user.type(textarea, '@');
    expect(menu()).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(savedValue()).toEqual(initialValue('图片1@'));
  });
});
