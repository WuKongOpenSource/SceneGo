import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeedanceMentionPromptEditor } from '../../components/SeedanceMentionPromptEditor';
import { baseParams } from '../utils/_fixtures/seedance';

const sampleCands = () => [
    { id: 'c_img_1', group: 'assets', kind: 'image', label: '主角立绘', url: '/c.png' },
    { id: 'c_aud_1', group: 'audio', kind: 'audio', label: '主题曲',  url: '/a.mp3' },
    { id: 'c_txt_1', group: 'storyboard_data', kind: 'text', label: 'SB-1 场景', text: 'INT. 卧室 - 夜' },
    { id: 'ark_input', group: 'ark_asset_id', kind: 'image', label: '手输 asset://...' },
] as any;

describe('SeedanceMentionPromptEditor', () => {
    it('renders prompt textarea', () => {
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: 'hi' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        expect(screen.getByRole('textbox')).toHaveValue('hi');
    });

    it('opens popover when user types @ at start of line', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '' })}
                onChange={onChange}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox');
        await user.click(ta);
        await user.type(ta, '@');
        await waitFor(() =>
            expect(screen.getByRole('listbox', { name: /mention/i })).toBeInTheDocument(),
        );
    });

    it('does NOT open popover when @ is mid-word', async () => {
        const user = userEvent.setup();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: 'foo' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        await user.type(screen.getByRole('textbox'), '@');
        expect(screen.queryByRole('listbox', { name: /mention/i })).toBeNull();
    });

    // Mention triggers must work after Chinese text and punctuation, not only whitespace.
    // Imported video_prompt is full Chinese text; before this fix, typing @ at the end

    it('opens popover when @ follows a Chinese character', async () => {
        const user = userEvent.setup();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '中景，平视，西关老巷' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        await user.click(ta);
        ta.setSelectionRange(ta.value.length, ta.value.length);
        await user.type(ta, '@');
        await waitFor(() =>
            expect(screen.getByRole('listbox', { name: /mention/i })).toBeInTheDocument(),
        );
    });

    it('opens popover when @ follows a punctuation mark', async () => {
        const user = userEvent.setup();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '镜头一：' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        await user.click(ta);
        ta.setSelectionRange(ta.value.length, ta.value.length);
        await user.type(ta, '@');
        await waitFor(() =>
            expect(screen.getByRole('listbox', { name: /mention/i })).toBeInTheDocument(),
        );
    });

    it('selecting an image candidate calls onChange with insertMention result', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '' })}
                onChange={onChange}
                candidates={sampleCands()}
            />,
        );
        await user.click(screen.getByRole('textbox'));
        await user.type(screen.getByRole('textbox'), '@');
        await user.click(await screen.findByText('主角立绘'));
        expect(onChange).toHaveBeenCalled();
        const next = onChange.mock.calls[onChange.mock.calls.length - 1][0];
        expect(next.media_inputs).toHaveLength(1);
        expect(next.prompt).toMatch(/图片1/);
    });

    it('autoOpenOnMount opens popover immediately when prompt === "@"', async () => {
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '@' })}
                onChange={() => {}}
                candidates={sampleCands()}
                autoOpenOnMount
            />,
        );
        await waitFor(() =>
            expect(screen.getByRole('listbox', { name: /mention/i })).toBeInTheDocument(),
        );
    });

    it('hides popover during IME composition', async () => {
        const user = userEvent.setup();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox');
        await user.click(ta);
        await user.type(ta, '@');
        await screen.findByRole('listbox', { name: /mention/i });
        // Simulate IME compositionstart
        fireEvent.compositionStart(ta);
        await waitFor(() =>
            expect(screen.queryByRole('listbox', { name: /mention/i })).toBeNull(),
        );
        // compositionend re-evaluates
        fireEvent.compositionEnd(ta, { data: '中' });
    });

    it('Esc closes the popover', async () => {
        const user = userEvent.setup();
        render(
            <SeedanceMentionPromptEditor
                value={baseParams({ prompt: '' })}
                onChange={() => {}}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox');
        await user.click(ta);
        await user.type(ta, '@');
        await screen.findByRole('listbox', { name: /mention/i });
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox', { name: /mention/i })).toBeNull();
    });

    it('Backspace deletes the entire 图片1 token in one press and shrinks media_inputs', async () => {
        const user = userEvent.setup();
        const handleChange = vi.fn();
        const initial = baseParams({
            prompt: '镜头描述 图片1',
            media_inputs: [{ kind: 'image', url: '/c.png', role: 'reference_image' }],
        });
        render(
            <SeedanceMentionPromptEditor
                value={initial}
                onChange={handleChange}
                candidates={sampleCands()}
            />,
        );
        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        await user.click(ta);

        ta.setSelectionRange(initial.prompt.length, initial.prompt.length);
        await user.keyboard('{Backspace}');
        expect(handleChange).toHaveBeenCalled();
        const next = handleChange.mock.calls[handleChange.mock.calls.length - 1][0];
        expect(next.media_inputs).toHaveLength(0);
        expect(next.prompt).not.toMatch(/图片1/);
        expect(next.prompt).not.toMatch(/图片$/); // no orphan fragment
    });
});
