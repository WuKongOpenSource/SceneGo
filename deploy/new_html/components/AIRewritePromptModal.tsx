







import React, { useEffect, useMemo, useState } from 'react';
import { X, Sparkles, Loader2, RotateCcw, Check } from 'lucide-react';
import {
    rewritePrompt,
    REWRITE_PRESETS,
    type RewriteBackend,
} from '../services/promptRewriter';
import { useScriptModelOptions } from '../hooks/useScriptModelOptions';
import {
    formatScriptModelDisplay,
    getScriptModelOption,
} from '../services/scriptModelCatalogService';
import { AiModel } from '../types';
import { ModelPicker, type ModelPickerOption } from './ModelPicker';

export interface AIRewritePromptModalProps {
    open: boolean;
    originalPrompt: string;

    onAccept: (newPrompt: string) => void;
    onClose: () => void;

    defaultBackend?: RewriteBackend;
}

const PRESET_CUSTOM = '__custom__';

export const AIRewritePromptModal: React.FC<AIRewritePromptModalProps> = (p) => {
    const scriptModelOptions = useScriptModelOptions();
    const [presetId, setPresetId] = useState<string>(REWRITE_PRESETS[0]?.id ?? PRESET_CUSTOM);
    const [customInstr, setCustomInstr] = useState('');
    const [backend, setBackend] = useState<RewriteBackend>(p.defaultBackend ?? 'geminiProxy');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rewriteBackendLabels = useMemo<Record<RewriteBackend, string>>(() => {
        const gemini = formatScriptModelDisplay(
            getScriptModelOption(AiModel.Gemini, scriptModelOptions),
        );
        const deepseek = formatScriptModelDisplay(
            getScriptModelOption(AiModel.DeepseekChat, scriptModelOptions),
        );
        return {
            geminiProxy: `${gemini}（默认）`,
            geminiSDK: `${gemini}（兼容旧选项）`,
            deepseek: `${deepseek}（中文优化）`,
        };
    }, [scriptModelOptions]);
    const rewriteModelPickerOptions = useMemo<readonly ModelPickerOption<RewriteBackend>[]>(() => (
        (Object.keys(rewriteBackendLabels) as RewriteBackend[]).map(value => ({
            value,
            label: rewriteBackendLabels[value],
            description: value === 'deepseek'
                ? '适合中文提示词优化'
                : value === 'geminiSDK'
                    ? '兼容历史任务，实际仍由后端统一调用'
                    : '默认全能改写通道',
            group: '在线 API',
        }))
    ), [rewriteBackendLabels]);


    useEffect(() => {
        if (p.open) {
            setPresetId(REWRITE_PRESETS[0]?.id ?? PRESET_CUSTOM);
            setCustomInstr('');
            setResult('');
            setError(null);
            setLoading(false);
        }
    }, [p.open]);


    useEffect(() => {
        if (!p.open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) p.onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [p.open, p.onClose, loading]);

    if (!p.open) return null;

    const isCustom = presetId === PRESET_CUSTOM;
    const presetMeta = REWRITE_PRESETS.find(x => x.id === presetId);
    const effectiveInstruction = isCustom ? customInstr.trim() : (presetMeta?.instruction ?? '');
    const canGenerate = !!p.originalPrompt.trim() && !!effectiveInstruction && !loading;

    const handleGenerate = async () => {
        setLoading(true);
        setError(null);
        try {
            const out = await rewritePrompt({
                originalPrompt: p.originalPrompt,
                instruction: effectiveInstruction,
                backend,
            });
            if (!out.trim()) throw new Error('AI 返回空内容');
            setResult(out);
        } catch (e: any) {
            setError(e?.message || String(e));
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = () => {
        if (!result.trim()) return;
        p.onAccept(result);
        p.onClose();
    };

    return (
        <div
            className="app-modal-backdrop fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4"
            onClick={() => { if (!loading) p.onClose(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="AI 改写视频提示词"


                className="app-modal-surface w-[min(96vw,1400px)] max-w-full max-h-[96vh] bg-n0 border border-primary rounded-md shadow-bottom overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-n40 bg-primary-light">
                    <div className="flex items-center gap-2 text-sm text-primary">
                        <Sparkles size={14} className="text-primary" />
                        <span className="font-semibold">AI 改写视频提示词</span>
                    </div>
                    <button
                        type="button"
                        onClick={p.onClose}
                        disabled={loading}
                        aria-label="关闭"
                        className="p-1 text-n300 hover:text-primary transition-colors disabled:opacity-30"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">

                    <div>
                        <div className="text-[10px] uppercase tracking-wide text-n100 mb-1">原提示词</div>
                        <textarea
                            value={p.originalPrompt}
                            readOnly
                            rows={16}
                            className="w-full px-2 py-1.5 bg-n30 border border-n40 rounded text-n700 text-xs resize-none"
                        />
                    </div>


                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-n100 mb-1">改写模式</div>
                            <select
                                value={presetId}
                                onChange={e => setPresetId(e.target.value)}
                                disabled={loading}
                                className="w-full px-2 py-1 bg-n0 border border-n40 rounded text-n700 text-xs focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                            >
                                {REWRITE_PRESETS.map(opt => (
                                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                                ))}
                                <option value={PRESET_CUSTOM}>自定义...</option>
                            </select>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-n100 mb-1">后端模型</div>
                            <ModelPicker<RewriteBackend>
                                value={backend}
                                options={rewriteModelPickerOptions}
                                onChange={setBackend}
                                disabled={loading}
                                fullWidth
                                ariaLabel="选择提示词改写模型"
                                title="提示词改写模型"
                                kind="text"
                            />
                        </div>
                    </div>


                    {isCustom && (
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-n100 mb-1">自定义改写要求</div>
                            <textarea
                                value={customInstr}
                                onChange={e => setCustomInstr(e.target.value)}
                                disabled={loading}
                                placeholder="例如：把背景改成下雨；让动作更慢；翻译为英文..."
                                rows={8}
                                className="w-full px-2 py-1.5 bg-n0 border border-n40 rounded text-n700 text-xs resize-none focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                            />
                        </div>
                    )}


                    <div>
                        <button
                            type="button"
                            onClick={handleGenerate}
                            disabled={!canGenerate}
                            className="w-full px-3 py-1.5 text-xs bg-primary hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-white rounded inline-flex items-center justify-center gap-2 transition-colors"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    AI 改写中...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={14} />
                                    {result ? '重新生成' : '生成改写'}
                                </>
                            )}
                        </button>
                    </div>


                    {error && (
                        <div className="p-2 bg-r50 border border-n40 rounded text-[11px] text-danger">
                            ✗ {error}
                        </div>
                    )}


                    {result && (
                        <div>
                            <div className="text-[10px] uppercase tracking-wide text-n100 mb-1">改写结果（可编辑）</div>
                            <textarea
                                value={result}
                                onChange={e => setResult(e.target.value)}
                                rows={32}
                                className="w-full px-2 py-1.5 bg-n0 border border-primary rounded text-n700 text-xs resize-none focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                            />
                        </div>
                    )}
                </div>


                <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-n40">
                    <button
                        type="button"
                        onClick={p.onClose}
                        disabled={loading}
                        className="px-3 py-1 text-xs text-n700 hover:text-n800 disabled:opacity-30"
                    >
                        取消
                    </button>
                    {result && (
                        <button
                            type="button"
                            onClick={() => setResult('')}
                            disabled={loading}
                            className="px-3 py-1 text-xs text-n700 hover:text-n800 disabled:opacity-30 inline-flex items-center gap-1"
                        >
                            <RotateCcw size={12} />
                            清空结果
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={handleAccept}
                        disabled={!result.trim() || loading}
                        className="px-3 py-1 text-xs bg-primary hover:bg-primary-hover disabled:opacity-40 text-white rounded inline-flex items-center gap-1"
                    >
                        <Check size={12} />
                        接受并替换
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AIRewritePromptModal;
