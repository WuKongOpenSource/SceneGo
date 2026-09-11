import React from 'react';
import type { SeedanceParams } from '../../services/videoModelService';

export interface MediaBadgesProps {
    params: SeedanceParams;
}

const KIND_LABEL: Record<'image' | 'video' | 'audio', string> = {
    image: '图', video: '视', audio: '音',
};

function tooltipFor(params: SeedanceParams, kind: 'image' | 'video' | 'audio'): string {
    const items = params.media_inputs.filter(m => m.kind === kind);
    if (items.length === 0) return `没有${KIND_LABEL[kind]}片输入`;
    const top = items.slice(0, 3).map(m => (m.url || '').split('/').pop() || '').filter(Boolean);
    const extra = items.length - top.length;
    return extra > 0 ? `${top.join(' · ')}  +${extra} more` : top.join(' · ');
}

const TONE: Record<'image' | 'video' | 'audio', { active: string; zero: string }> = {
    image: {
        active: 'bg-b50 text-b400 border border-b75',
        zero:   'bg-n30 text-n100 border border-n40',
    },
    video: {
        active: 'bg-primary-light text-primary border border-primary',
        zero:   'bg-n30 text-n100 border border-n40',
    },
    audio: {
        active: 'bg-warning/15 text-warning border border-warning/40',
        zero:   'bg-n30 text-n100 border border-n40',
    },
};

export const MediaBadges: React.FC<MediaBadgesProps> = ({ params }) => {
    const counts = {
        image: params.media_inputs.filter(m => m.kind === 'image').length,
        video: params.media_inputs.filter(m => m.kind === 'video').length,
        audio: params.media_inputs.filter(m => m.kind === 'audio').length,
    };
    return (
        <div className="flex items-center gap-1 shrink-0">
            {(['image', 'video', 'audio'] as const).map(kind => {
                const n = counts[kind];
                const isZero = n === 0;
                return (
                    <span
                        key={kind}
                        data-kind={kind}
                        data-zero={isZero ? 'true' : 'false'}
                        title={tooltipFor(params, kind)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            isZero ? TONE[kind].zero : TONE[kind].active
                        }`}
                    >
                        {KIND_LABEL[kind]}{n}
                    </span>
                );
            })}
        </div>
    );
};

export default MediaBadges;
