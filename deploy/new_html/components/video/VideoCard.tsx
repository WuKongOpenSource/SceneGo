// Lightweight video card primitives shared by VideoPage.
// Heavy provider panels live in separate lazy-loaded modules.
import React from 'react';
import { ImageOff } from 'lucide-react';
import type { TaskGroup, UploadedImage } from '../../services/videoTaskTypes';
import type { StoryboardMeta } from '../../services/videoWorkspaceService';
import { useReactiveDuration } from '../../hooks/useReactiveDuration';
import { LazyImage } from '../LazyImage';
import { CardDurationField } from './CardDurationField';

export interface DurationFieldForGroupProps {
    group: TaskGroup;
    meta: Partial<StoryboardMeta> | undefined;
    onPatchGroup: (uuid: string, patch: Partial<TaskGroup>) => void;
    disabled?: boolean;
    maxDuration?: number;
    variant?: 'compact' | 'seedance15';
}

export const DurationFieldForGroup: React.FC<DurationFieldForGroupProps> = ({
    group,
    meta,
    onPatchGroup,
    disabled,
    maxDuration,
    variant,
}) => {
    const dur = useReactiveDuration({
        groupUuid: group.uuid,
        durationUserOverride: !!group.durationUserOverride,
        meta: meta || {},
        currentDuration: group.duration,
        maxDuration,
        onChange: (duration, durationUserOverride) =>
            onPatchGroup(group.uuid, { duration, durationUserOverride }),
    });

    return (
        <CardDurationField
            duration={dur.duration}
            userOverride={dur.userOverride}
            onChange={dur.setUserDuration}
            onClear={dur.clearOverride}
            disabled={disabled}
            maxDuration={maxDuration}
            variant={variant}
        />
    );
};

export interface StoryboardImageAreaProps {
    image: UploadedImage;
    meta?: Partial<StoryboardMeta>;
    imgClassName?: string;
    placeholderClassName?: string;
    onClick?: () => void;
    showBadges?: boolean;
}

export const StoryboardImageArea: React.FC<StoryboardImageAreaProps> = ({
    image,
    meta,
    imgClassName,
    placeholderClassName,
    onClick,
    showBadges = true,
}) => {
    const placeholderClass =
        placeholderClassName ??
        'w-full aspect-video bg-n30 border border-dashed border-n40 rounded flex flex-col items-center justify-center text-n100';
    const realImgClass = imgClassName ?? 'w-full aspect-video object-cover rounded';

    return (
        <div className="w-full" onClick={onClick}>
            {image.isPlaceholder || !image.url ? (
                <div className={placeholderClass} title="空分镜：用 @ 挑选首帧">
                    <ImageOff size={20} />
                    <div className="text-[10px] mt-1">空分镜</div>
                    <div className="text-[9px] mt-0.5">@ 选首帧</div>
                </div>
            ) : (
                <LazyImage src={image.url} alt={image.filename} className={realImgClass} />
            )}
            {showBadges && <AudioBadgesRow meta={meta} />}
        </div>
    );
};

export interface AudioBadgesRowProps {
    meta?: Partial<StoryboardMeta>;
}

export const AudioBadgesRow: React.FC<AudioBadgesRowProps> = ({ meta }) => {
    if (!meta) return null;

    const hasDialogue = !!meta.audioUrls?.dialogue;
    const hasNarration = !!meta.audioUrls?.narration;
    const hasSfx = !!meta.audioUrls?.sfx;
    const hasMixed = !!meta.mixedAudioUrl;

    if (!(hasDialogue || hasNarration || hasSfx)) return null;

    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {hasDialogue && <span className="px-1 py-0.5 bg-b50 text-b400 rounded text-[9px]">对白</span>}
            {hasNarration && <span className="px-1 py-0.5 bg-primary-light text-primary rounded text-[9px]">旁白</span>}
            {hasSfx && <span className="px-1 py-0.5 bg-warning/15 text-warning rounded text-[9px]">音效</span>}
            {hasMixed
                ? <span className="px-1 py-0.5 bg-success/15 text-success rounded text-[9px]">已混音</span>
                : <span className="px-1 py-0.5 bg-n30 text-n300 rounded text-[9px]">混音中...</span>}
        </div>
    );
};

export interface VideoCardProps {
    group: TaskGroup;
    image: UploadedImage;
    meta?: Partial<StoryboardMeta>;
    onPatchGroup: (uuid: string, patch: Partial<TaskGroup>) => void;
    disabled?: boolean;
}

export const VideoCard: React.FC<VideoCardProps> = ({
    group,
    image,
    meta,
    onPatchGroup,
    disabled,
}) => (
    <div className="bg-n0 rounded-md border border-n40 shadow-card hover:shadow-atlas p-3 flex flex-col gap-2">
        <StoryboardImageArea image={image} meta={meta} />
        <DurationFieldForGroup
            group={group}
            meta={meta}
            onPatchGroup={onPatchGroup}
            disabled={disabled}
        />
    </div>
);
