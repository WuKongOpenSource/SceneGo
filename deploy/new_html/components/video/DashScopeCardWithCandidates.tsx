import React, { useCallback, useMemo, useState } from 'react';
import ReactDOM from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import type {
    DashScopeVideoParams,
    SeedanceMediaInput,
    SeedanceParams,
} from '../../services/videoModelService';
import { useSeedanceCandidates } from '../../hooks/useSeedanceCandidates';
import { SeedanceMentionPromptEditor } from '../SeedanceMentionPromptEditor';
import { DashScopeVideoCard, type DashScopePromptEditorProps } from './DashScopeCards';

export interface DashScopeCardWithCandidatesProps {
    params: DashScopeVideoParams;
    onChange: (next: DashScopeVideoParams) => void;
    onPickImage: (cb: (media: SeedanceMediaInput) => void) => void;
    onPreviewImage?: (url: string) => void;
    disabled?: boolean;
    storyboardItemId?: string;
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
}

export const DashScopeCardWithCandidates: React.FC<DashScopeCardWithCandidatesProps> = (props) => {
    const [promptModalOpen, setPromptModalOpen] = useState(false);
    const referenceLimit = props.params.model === 'HappyHorse' ? 9 : 7;
    const adapted = useMemo<SeedanceParams>(() => ({
        sub_model: 'standard',
        prompt: props.params.prompt || '',
        media_inputs: props.params.media_inputs || [],
    }), [props.params.prompt, props.params.media_inputs]);

    const { candidates } = useSeedanceCandidates({
        currentParams: adapted,
        currentStoryboardItemId: props.storyboardItemId,
    });

    const PromptEditor = useCallback<React.FC<DashScopePromptEditorProps>>((editorProps) => {
        const fakeSeedanceParams: SeedanceParams = {
            sub_model: 'standard',
            prompt: editorProps.params.prompt || '',
            media_inputs: editorProps.params.media_inputs || [],
        };

        return (
            <div className="flex shrink-0 flex-col gap-2" data-testid="dashscope-prompt-section">
                <div className="flex items-center justify-between gap-2 text-[9px] text-n100">
                    <span>最多输入 {referenceLimit} 个参考素材；输入文字，或输入 @ 选择参考内容</span>
                    <button type="button" onClick={() => setPromptModalOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-primary hover:bg-primary-light"><Maximize2 size={11} />放大编辑</button>
                </div>
                <SeedanceMentionPromptEditor
                    value={fakeSeedanceParams}
                    onChange={(next) => editorProps.onChange({
                        ...editorProps.params,
                        prompt: next.prompt,
                        media_inputs: next.media_inputs,
                    })}
                    candidates={candidates}
                    disabled={editorProps.disabled}
                    placeholder={editorProps.placeholder || '输入文字描述，或输入 @ 选择参考内容……'}
                    onPreviewMedia={props.onPreviewMedia}
                    hideTokensRow={true}
                    rows={7}
                />
            </div>
        );
    }, [candidates, props.onPreviewMedia, referenceLimit]);

    const updateFromPromptEditor = (next: SeedanceParams) => props.onChange({
        ...props.params,
        prompt: next.prompt,
        media_inputs: next.media_inputs,
    });

    return (
        <>
            <DashScopeVideoCard
                params={props.params}
                onChange={props.onChange}
                onPickImage={props.onPickImage}
                onPreviewImage={props.onPreviewImage}
                disabled={props.disabled}
                PromptEditor={PromptEditor}
            />
            {promptModalOpen && ReactDOM.createPortal(
                <div className="fixed inset-0 z-[9500] flex items-center justify-center bg-n900/50 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setPromptModalOpen(false); }}>
                    <div role="dialog" aria-label="放大编辑提示词" className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-n40 bg-n0 shadow-bottom">
                        <div className="flex items-center justify-between border-b border-n40 px-4 py-3">
                            <div><div className="text-sm font-semibold text-primary">提示词 · 放大编辑</div><div className="text-[10px] text-n100">最多 {referenceLimit} 个参考素材；输入文字，或输入 @ 选择参考内容</div></div>
                            <button type="button" onClick={() => setPromptModalOpen(false)} className="rounded p-1.5 text-n300 hover:bg-n20" aria-label="关闭"><X size={16} /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            <SeedanceMentionPromptEditor value={adapted} onChange={updateFromPromptEditor} candidates={candidates} disabled={props.disabled} rows={27} openUpward placeholder="输入文字描述，或输入 @ 选择参考内容……" onPreviewMedia={props.onPreviewMedia} />
                        </div>
                        <div className="flex justify-end border-t border-n40 px-4 py-3"><button type="button" onClick={() => setPromptModalOpen(false)} className="rounded-lg bg-primary px-4 py-1.5 text-xs text-white hover:bg-primary-hover">完成</button></div>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
};

export default DashScopeCardWithCandidates;
