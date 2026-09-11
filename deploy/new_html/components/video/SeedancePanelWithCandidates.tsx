import React from 'react';
import type { SeedanceMediaInput, SeedanceParams } from '../../services/videoModelService';
import { useSeedanceCandidates } from '../../hooks/useSeedanceCandidates';
import { SeedanceMultimodalPanel } from '../SeedanceMultimodalPanel';

export interface SeedancePanelWithCandidatesProps {
    value: SeedanceParams;
    onChange: (next: SeedanceParams) => void;
    disabled?: boolean;
    autoOpenMentionOnMount?: boolean;
    storyboardItemId?: string;
    onPreviewMedia?: (url: string, kind: SeedanceMediaInput['kind']) => void;
    onUsePreviousVideoAudio?: () => void;
    previousVideoAudioBusy?: boolean;
    audioReferenceNotice?: string;
    supportsMultimodal?: boolean;
    durationControl?: React.ReactNode;
}

export const SeedancePanelWithCandidates: React.FC<SeedancePanelWithCandidatesProps> = ({
    value,
    onChange,
    disabled,
    autoOpenMentionOnMount,
    storyboardItemId,
    onPreviewMedia,
    onUsePreviousVideoAudio,
    previousVideoAudioBusy,
    audioReferenceNotice,
    supportsMultimodal,
    durationControl,
}) => {
    const { candidates } = useSeedanceCandidates({
        currentParams: value,
        currentStoryboardItemId: storyboardItemId,
    });

    return (
        <SeedanceMultimodalPanel
            value={value}
            onChange={onChange}
            disabled={disabled}
            candidates={candidates}
            autoOpenMentionOnMount={autoOpenMentionOnMount}
            onPreviewMedia={onPreviewMedia}
            onUsePreviousVideoAudio={onUsePreviousVideoAudio}
            previousVideoAudioBusy={previousVideoAudioBusy}
            audioReferenceNotice={audioReferenceNotice}
            supportsMultimodal={supportsMultimodal}
            durationControl={durationControl}
        />
    );
};

export default SeedancePanelWithCandidates;
