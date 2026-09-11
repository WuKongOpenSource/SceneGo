import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { SeedanceParams, SeedanceMediaInput } from '../../services/videoModelService';
import type { SeedanceAssetCandidate } from '../../utils/seedanceMedia';
import { SeedanceMultimodalPanel } from '../SeedanceMultimodalPanel';

export interface SeedanceDetailModalProps {
    open: boolean;
    title: string;
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    candidates: SeedanceAssetCandidate[];
    onClose: () => void;

    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    onUsePreviousVideoAudio?: () => void;
    previousVideoAudioBusy?: boolean;
    audioReferenceNotice?: string;
    supportsMultimodal?: boolean;
}

export const SeedanceDetailModal: React.FC<SeedanceDetailModalProps> = (p) => {
    useEffect(() => {
        if (!p.open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [p.open, p.onClose]);

    if (!p.open) return null;
    return (
        <div
            className="app-modal-backdrop fixed inset-0 z-50 bg-n900/50 flex items-center justify-center p-4"
            onClick={p.onClose}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Seedance 详情"
                className="app-modal-surface w-[520px] max-w-full max-h-[85vh] bg-n0 border border-n40 rounded-md shadow-bottom overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-n40">
                    <div className="text-xs text-n800">
                        <span className="opacity-60">Seedance 详情 ·</span>
                        <span className="ml-1.5 font-semibold">{p.title}</span>
                    </div>
                    <button
                        type="button"
                        onClick={p.onClose}
                        aria-label="关闭"
                        className="p-1 text-n300 hover:text-primary transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    <SeedanceMultimodalPanel
                        value={p.value}
                        onChange={p.onChange}
                        candidates={p.candidates}
                        onPreviewMedia={p.onPreviewMedia}
                        onUsePreviousVideoAudio={p.onUsePreviousVideoAudio}
                        previousVideoAudioBusy={p.previousVideoAudioBusy}
                        audioReferenceNotice={p.audioReferenceNotice}
                        supportsMultimodal={p.supportsMultimodal}
                    />
                </div>
            </div>
        </div>
    );
};

export default SeedanceDetailModal;
