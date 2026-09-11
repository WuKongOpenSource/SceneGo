



import React from 'react';
import { Film, Link, Scissors, ScanFace } from 'lucide-react';
import { VideoGenerationMode } from '../types';

interface VideoModeSelectorProps {
    currentMode: VideoGenerationMode;
    onSelect: (mode: VideoGenerationMode) => void;
}

export const VideoModeSelector: React.FC<VideoModeSelectorProps> = ({ currentMode, onSelect }) => {
    const modes = [
        { mode: 'CONTINUE' as const, icon: Film, title: '剧情延展 (StoryContinuator)' },
        { mode: 'FIRST_LAST_FRAME' as const, icon: Link, title: '首尾帧 (FrameWeaver)' },
        { mode: 'CUT' as const, icon: Scissors, title: '局部分镜 (SceneDirector)' },
        { mode: 'CHARACTER_REF' as const, icon: ScanFace, title: '角色迁移 (CharacterRef)' }
    ];

    const handleSelect = (mode: VideoGenerationMode) => {
        if (currentMode === mode) {
            onSelect('DEFAULT');
        } else {
            onSelect(mode);
        }
    };

    return (
        <div className="flex min-w-max items-center gap-0.5">
            {modes.map(item => (
                <button
                   key={item.mode}
                   onClick={(e) => { e.stopPropagation(); handleSelect(item.mode); }}
                   className={`studio-node-mode-button flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5 py-1.5 rounded-md transition-colors text-xs font-bold ${currentMode === item.mode ? 'studio-node-mode-button-active shadow-md' : 'opacity-70 hover:opacity-100'}`}
                   title={item.title}
                >
                    <item.icon className="shrink-0" size={11} />
                    <span>{item.title.split(' ')[0]}</span>
                </button>
            ))}
        </div>
    );
};

interface SceneDirectorOverlayProps {
    visible: boolean;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    onCrop: () => void;
    onTimeHover: (time: number) => void;
}

export const SceneDirectorOverlay: React.FC<SceneDirectorOverlayProps> = ({ visible, videoRef, onCrop, onTimeHover }) => {
    const timelineRef = React.useRef<HTMLDivElement>(null);
    const [hoverTime, setHoverTime] = React.useState<number | null>(null);
    const [duration, setDuration] = React.useState(0);

    React.useEffect(() => {
        const vid = videoRef.current;
        if (vid) {
            setDuration(vid.duration || 0);
            const updateDur = () => setDuration(vid.duration);
            vid.addEventListener('loadedmetadata', updateDur);
            return () => vid.removeEventListener('loadedmetadata', updateDur);
        }
    }, [videoRef]);

    if (!visible) return null;

    return (
        <div
            ref={timelineRef}
            className="studio-node-timeline absolute bottom-0 left-0 w-full h-9 backdrop-blur-xl flex items-center cursor-crosshair z-30 opacity-0 group-hover/media:opacity-100 transition-opacity duration-300"
            onMouseMove={(e) => {
                if (!timelineRef.current || !videoRef.current) return;
                const rect = timelineRef.current.getBoundingClientRect();
                const per = Math.max(0, Math.min((e.clientX - rect.left) / rect.width, 1));
                const vid = videoRef.current;
                if (vid && Number.isFinite(vid.duration)) {
                    vid.currentTime = vid.duration * per;
                    setHoverTime(vid.duration * per);
                    onTimeHover(vid.duration * per);
                }
            }}
            onClick={(e) => {
                e.stopPropagation();
                onCrop();
            }}
        >
            {hoverTime !== null && duration > 0 && <div className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 z-10 shadow-[0_0_8px_rgba(34,211,238,0.8)]" style={{ left: `${(hoverTime / duration) * 100}%` }} />}
            <div className="w-full text-center text-[9px] font-bold tracking-widest pointer-events-none">Scene Director Timeline</div>
        </div>
    );
};
