import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeedanceMentionPromptEditor } from '../../components/SeedanceMentionPromptEditor';
import { TOKEN_PREFIX } from '../../utils/seedanceMedia';
import { baseParams } from '../utils/_fixtures/seedance';

describe('SeedanceMentionPromptEditor duplicate media references', () => {
    it('keeps the media_input when Backspace removes one of several references to the same token', async () => {
        const user = userEvent.setup();
        const handleChange = vi.fn();
        const token = `${TOKEN_PREFIX.image}1`;
        const initial = baseParams({
            prompt: `shot ${token} closeup ${token}`,
            media_inputs: [{ kind: 'image', url: '/c.png', role: 'reference_image' }],
        });

        render(
            <SeedanceMentionPromptEditor
                value={initial}
                onChange={handleChange}
                candidates={[]}
            />,
        );

        const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
        await user.click(ta);
        ta.setSelectionRange(initial.prompt.length, initial.prompt.length);
        await user.keyboard('{Backspace}');

        expect(handleChange).toHaveBeenCalled();
        const next = handleChange.mock.calls[handleChange.mock.calls.length - 1][0];
        expect(next.media_inputs).toHaveLength(1);
        expect(next.prompt).toBe(`shot ${token} closeup`);
    });
});
