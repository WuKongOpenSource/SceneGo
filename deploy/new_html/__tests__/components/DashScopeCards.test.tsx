import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { KlingCard, ViduCard, HappyHorseCard } from '../../components/video/DashScopeCards';
import { makeDefaultDashScopeParams } from '../../services/videoModelService';













const noopPick = () => {};
const noopPreview = () => {};

describe('KlingCard 多镜头模式', () => {
    it('在紧凑胶囊下拉中显示自动 / Omni / Multi 模式', () => {
        const params = makeDefaultDashScopeParams('Kling');
        render(
            <KlingCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        const select = screen.getByLabelText('Kling 生成模式') as HTMLSelectElement;
        expect(Array.from(select.options).map(option => option.value)).toEqual(['auto', 'omni', 'multi']);
        expect(screen.getByTestId('kling-control-row')).toHaveClass('flex-wrap');
        expect(select.closest('label')).toHaveClass('rounded-full');
    });

    it('点击 Multi mode 后调用 onChange 设置 kling_multi_shot=true + shot_type 默认 intelligence', () => {
        const params = makeDefaultDashScopeParams('Kling');
        const onChange = vi.fn();
        render(
            <KlingCard
                params={params}
                onChange={onChange}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        fireEvent.change(screen.getByLabelText('Kling 生成模式'), { target: { value: 'multi' } });
        expect(onChange).toHaveBeenCalled();
        const lastCall = onChange.mock.calls.at(-1)![0];
        expect(lastCall.kling_multi_shot).toBe(true);
        expect(lastCall.kling_shot_type).toBe('intelligence');
    });

    it('Multi mode + shot_type=customize 时显示「+ 添加分镜」按钮', () => {
        const params = {
            ...makeDefaultDashScopeParams('Kling'),
            kling_multi_shot: true,
            kling_shot_type: 'customize' as const,
            kling_multi_prompt: [],
        };
        render(
            <KlingCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '多镜头设置' }));
        expect(screen.getByText(/添加分镜/)).toBeInTheDocument();
    });

    it('Multi mode + 添加 1 个分镜后渲染 index=1 的输入', () => {
        const params = {
            ...makeDefaultDashScopeParams('Kling'),
            kling_multi_shot: true,
            kling_shot_type: 'customize' as const,
            kling_multi_prompt: [{ index: 1, prompt: '雾岭镇黄昏', duration: 5 }],
        };
        render(
            <KlingCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '多镜头设置' }));
        expect(screen.getByDisplayValue('雾岭镇黄昏')).toBeInTheDocument();
        expect(screen.getByText(/分镜 1/)).toBeInTheDocument();
    });
});



// we use the project's English DashScopeVideoModel identifiers ('Vidu' / 'HappyHorse').

describe('ViduCard 完整参数', () => {
    it('显示 resolution 下拉（540P / 720P / 1080P）', () => {
        const params = makeDefaultDashScopeParams('Vidu');
        render(
            <ViduCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        const sel = screen.getByLabelText(/分辨率/) as HTMLSelectElement;
        expect(sel).toBeInTheDocument();
        expect(Array.from(sel.options).map(o => o.value)).toEqual(
            expect.arrayContaining(['540P', '720P', '1080P']),
        );
        expect(sel.closest('details')).toBeNull();
    });

    it('显示 seed 输入', () => {
        const params = makeDefaultDashScopeParams('Vidu');
        render(
            <ViduCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
        expect(screen.getByLabelText(/种子|seed/i)).toBeInTheDocument();
    });

    it('audio 仅当 sub_model_vidu 以 q3 开头时可勾选', () => {
        const params = { ...makeDefaultDashScopeParams('Vidu'), sub_model_vidu: 'q2' as const };
        render(
            <ViduCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
        const audioCheckbox = screen.getByLabelText(/有声|audio/i) as HTMLInputElement;
        expect(audioCheckbox.disabled).toBe(true);
    });
});

describe('HappyHorseCard 完整参数', () => {
    it('keeps the reference strip in its own non-shrinking row below the prompt editor', () => {
        const params = {
            ...makeDefaultDashScopeParams('HappyHorse'),
            media_inputs: [{ kind: 'image' as const, url: '/reference.png', role: 'reference_image' as const }],
        };
        render(
            <HappyHorseCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
                PromptEditor={() => <div data-testid="test-prompt-editor">提示词编辑器</div>}
            />,
        );
        const prompt = screen.getByTestId('test-prompt-editor');
        const references = screen.getByTestId('dashscope-reference-row');
        expect(prompt.compareDocumentPosition(references) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(references).toHaveClass('shrink-0', 'border-t', 'bg-n0');
    });

    it('显示 resolution 下拉（720P / 1080P）', () => {
        const params = makeDefaultDashScopeParams('HappyHorse');
        render(
            <HappyHorseCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        const sel = screen.getByLabelText(/分辨率/) as HTMLSelectElement;
        expect(Array.from(sel.options).map(o => o.value).sort()).toEqual(['1080P', '720P']);
    });

    it('显示 ratio 下拉，包含 9 种比例', () => {
        const params = makeDefaultDashScopeParams('HappyHorse');
        render(
            <HappyHorseCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        const sel = screen.getByLabelText(/比例/) as HTMLSelectElement;
        const vals = Array.from(sel.options).map(o => o.value);
        expect(vals).toEqual(expect.arrayContaining([
            '16:9', '9:16', '3:4', '4:3', '4:5', '5:4', '1:1', '9:21', '21:9',
        ]));
        expect(vals.length).toBe(9);
    });

    it('时长以当前值胶囊展示，点击后提供 3-15 秒输入', () => {
        const params = makeDefaultDashScopeParams('HappyHorse');
        render(
            <HappyHorseCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        const summary = screen.getByLabelText('时长设置');
        expect(summary).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(summary);
        expect(summary).toHaveTextContent('5 秒');
        const inp = screen.getByLabelText('时长') as HTMLInputElement;
        expect(inp.min).toBe('3');
        expect(inp.max).toBe('15');
    });

    it('显示 watermark + seed', () => {
        const params = makeDefaultDashScopeParams('HappyHorse');
        render(
            <HappyHorseCard
                params={params}
                onChange={vi.fn()}
                onPickImage={noopPick}
                onPreviewImage={noopPreview}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: '高级设置' }));
        expect(screen.getByLabelText(/水印|watermark/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/种子|seed/i)).toBeInTheDocument();
    });
});
