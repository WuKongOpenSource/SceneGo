import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MiniMaxVideoPanel } from '../../components/video/MiniMaxVideoPanel';

const defaultValue = {
    model: 'MiniMax-Hailuo-2.3' as const,
    duration: 6 as const,
    resolution: '768P' as const,
    promptOptimizer: true,
};

describe('MiniMaxVideoPanel', () => {
    it('exposes backend runtime model choices', () => {
        const onChange = vi.fn();
        render(
            <MiniMaxVideoPanel
                value={defaultValue}
                prompt="move gently"
                modelOptions={[
                    { value: 'MiniMax-Hailuo-2.3-Preview' },
                    { value: 'MiniMax-Hailuo-2.3-Fast' },
                ]}
                onChange={onChange}
                onPromptChange={vi.fn()}
            />,
        );

        fireEvent.click(screen.getByLabelText('MiniMax 模型'));
        fireEvent.click(screen.getByRole('option', { name: /MiniMax-Hailuo-2.3-Fast/ }));

        expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
            model: 'MiniMax-Hailuo-2.3-Fast',
        }));
        fireEvent.click(screen.getByLabelText('MiniMax 模型'));
        expect(screen.getByRole('option', { name: /MiniMax-Hailuo-2.3-Preview/ })).toBeInTheDocument();
    });

    it('disables 10 seconds while 1080P is selected instead of silently changing the resolution', () => {
        render(
            <MiniMaxVideoPanel
                value={{ ...defaultValue, resolution: '1080P' }}
                prompt="test"
                onChange={vi.fn()}
                onPromptChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('option', { name: '10 秒' })).toBeDisabled();
    });

    it('disables 1080P while 10 seconds is selected', () => {
        render(
            <MiniMaxVideoPanel
                value={{ ...defaultValue, duration: 10, resolution: '768P' }}
                prompt="move gently"
                onChange={vi.fn()}
                onPromptChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('option', { name: '1080P' })).toBeDisabled();
    });
});
