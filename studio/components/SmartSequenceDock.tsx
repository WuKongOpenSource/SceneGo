
import React, { useState, useRef, useEffect } from 'react';
import {
    Plus, Play, Pause, X, Clock, Trash2, Link, ArrowRight,
    GripVertical, RefreshCw, Download, Maximize2, Minimize2,
    MonitorPlay, Loader2
} from 'lucide-react';
import { SmartSequenceItem } from '../types';

interface SmartSequenceDockProps {
    isOpen: boolean;
    onClose: () => void;
    onGenerate: (frames: SmartSequenceItem[]) => Promise<string>;
    onConnectStart?: (e: React.MouseEvent, type: 'input' | 'output') => void;
}

// Apple Physics Curve
const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";

export const SmartSequenceDock: React.FC<SmartSequenceDockProps> = ({ isOpen, onClose, onGenerate, onConnectStart }) => {
    const [frames, setFrames] = useState<SmartSequenceItem[]>([]);
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const [isGenerating, setIsGenerating] = useState(false);
    const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null);

    const [editingTransitionId, setEditingTransitionId] = useState<string | null>(null);
    const [tempPrompt, setTempPrompt] = useState('');
    const [tempDuration, setTempDuration] = useState(3);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const dockRef = useRef<HTMLDivElement>(null);
    const transitionModalRef = useRef<HTMLDivElement>(null);

    const totalDuration = frames.reduce((acc, f, i) => i < frames.length - 1 ? acc + f.transition.duration : acc, 0);

    // Global Click Listener for Closing Popups
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (editingTransitionId && transitionModalRef.current && !transitionModalRef.current.contains(event.target as Node)) {
                // Clicked outside transition modal
                // Check if clicked on the link button (to prevent immediate reopen toggling issues if handled there)
                const target = event.target as HTMLElement;
                if (!target.closest('button[data-link-btn]')) {
                    saveTransition();
                }
            }
        };
        window.addEventListener('mousedown', handleClickOutside);
        return () => window.removeEventListener('mousedown', handleClickOutside);
    }, [editingTransitionId, tempPrompt, tempDuration]);

    const handleGenerateClick = async () => {
        if (frames.length < 2 || isGenerating) return;
        setIsGenerating(true);
        setResultVideoUrl(null);
        setIsPlaying(false);

        try {
            const url = await onGenerate(frames);
            setResultVideoUrl(url);
            // Auto play after generation
            setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
                }
            }, 100);
        } catch (error) {
            console.error("Generation failed", error);
        } finally {
            setIsGenerating(false);
        }
    };

    const togglePlay = () => {
        if (!videoRef.current || !resultVideoUrl) return;
        if (isPlaying) {
            videoRef.current.pause();
            setIsPlaying(false);
        } else {
            videoRef.current.play();
            setIsPlaying(true);
        }
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggingIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        // Create invisible drag image to rely on our UI updates
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault(); // Necessary for drop
        if (draggingIndex === null) return;
        if (draggingIndex !== index) {
            setDragOverIndex(index);
            // If we want "live" reordering, we manipulate 'frames' here.
            // But standard behavior is usually onDrop. Let's do live swap for "spring" feel.
            const newFrames = [...frames];
            const [moved] = newFrames.splice(draggingIndex, 1);
            newFrames.splice(index, 0, moved);
            setFrames(newFrames);
            setDraggingIndex(index); // Update drag index to new position
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDraggingIndex(null);
        setDragOverIndex(null);

        // Handle external files if any
        if (e.dataTransfer.files?.length > 0) {
             const files = Array.from(e.dataTransfer.files).filter((f: any) => f.type.startsWith('image/'));
             if (files.length > 0) {
                 const readers = files.map((file: any) => new Promise<SmartSequenceItem>((resolve) => {
                     const reader = new FileReader();
                     reader.onload = (ev) => resolve({
                         id: `seq-${Date.now()}-${Math.random()}`,
                         src: ev.target?.result as string,
                         transition: { duration: 3, prompt: '' }
                     });
                     reader.readAsDataURL(file);
                 }));
                 Promise.all(readers).then(newItems => {
                     // Append to end if dropping on container, or insert if tracking index
                     setFrames(p => [...p, ...newItems].slice(0, 10));
                 });
             }
        }
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files);
            const readers = files.map((file: any) => new Promise<SmartSequenceItem>((resolve) => {
                const reader = new FileReader();
                reader.onload = (ev) => resolve({
                    id: `seq-${Date.now()}-${Math.random()}`,
                    src: ev.target?.result as string,
                    transition: { duration: 3, prompt: '' }
                });
                reader.readAsDataURL(file);
            }));
            Promise.all(readers).then(newItems => setFrames(p => [...p, ...newItems].slice(0, 10)));
        }
        e.target.value = '';
    };

    const openTransitionEditor = (id: string, transition: { duration: number, prompt: string }) => {
        if (editingTransitionId === id) {
            saveTransition();
        } else {
            saveTransition(); // Close others
            setEditingTransitionId(id);
            setTempPrompt(transition.prompt);
            setTempDuration(transition.duration);
        }
    };

    const saveTransition = () => {
        if (editingTransitionId) {
            setFrames(prev => prev.map(f => f.id === editingTransitionId ? { ...f, transition: { prompt: tempPrompt, duration: tempDuration } } : f));
            setEditingTransitionId(null);
        }
    };

    if (!isOpen) return null;


    const renderPlayer = () => (
        <div className={`
            relative bg-black border border-white/10 shadow-2xl overflow-hidden flex items-center justify-center transition-all duration-500 ease-[${SPRING}]
            ${isExpanded ? 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[50vw] h-[28.125vw] max-w-[90vw] max-h-[80vh] z-[100] rounded-2xl shadow-[0_0_100px_rgba(0,0,0,0.8)]' : 'w-[360px] h-[202px] rounded-xl'}
        `}>
            {/* Top Left Controls (Expand / Download) */}
            <div className={`absolute top-3 left-3 flex gap-2 z-20 transition-opacity duration-200 ${isGenerating ? 'opacity-0' : 'opacity-0 hover:opacity-100 group-hover/player:opacity-100'}`}>
                <button
                    onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
                    className="p-2 bg-black/60 backdrop-blur-md rounded-lg text-white/70 hover:text-white border border-white/10 hover:scale-105 transition-all"
                    title={isExpanded ? "退出全屏" : "放大预览"}
                >
                    {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                {resultVideoUrl && (
                    <a
                        href={resultVideoUrl}
                        download={`sunstudio_seq_${Date.now()}.mp4`}
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 bg-black/60 backdrop-blur-md rounded-lg text-white/70 hover:text-white border border-white/10 hover:scale-105 transition-all"
                        title="下载视频"
                    >
                        <Download size={16} />
                    </a>
                )}
            </div>

            {/* Playback Content */}
            {isGenerating ? (
                <div className="flex flex-col items-center gap-3">
                    <Loader2 size={32} className="animate-spin text-cyan-500" />
                    <span className="text-[10px] font-bold text-slate-400 tracking-widest uppercase animate-pulse">正在生成智能补帧...</span>
                </div>
            ) : resultVideoUrl ? (
                <div className="relative w-full h-full group/video" onClick={togglePlay}>
                    <video
                        ref={videoRef}
                        src={resultVideoUrl}
                        className="w-full h-full object-contain"
                        loop
                        playsInline
                        onEnded={() => setIsPlaying(false)}
                    />
                    {!isPlaying && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
                            <Play size={48} className="text-white/80 fill-white/20" />
                        </div>
                    )}
                </div>
            ) : frames.length > 0 ? (
                <div className="relative w-full h-full">
                    {/* Show hovered frame or first frame */}
                    <img
                        src={hoverIndex !== null && frames[hoverIndex] ? frames[hoverIndex].src : frames[0].src}
                        className="w-full h-full object-contain opacity-80"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                         {/* Central Play Button (Only toggles playback if generated, or shows placeholder) */}
                         <button
                             onClick={togglePlay}
                             disabled={!resultVideoUrl}
                             className={`w-14 h-14 rounded-full flex items-center justify-center transition-all backdrop-blur-md group/play
                                ${resultVideoUrl
                                    ? 'bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/50 shadow-[0_0_20px_rgba(6,182,212,0.3)]'
                                    : 'bg-white/5 border border-white/10 cursor-default opacity-50'}
                             `}
                         >
                             {isPlaying ? <Pause size={24} className="text-white" /> : <Play size={24} className="text-white ml-1" fill={resultVideoUrl ? "currentColor" : "none"} />}
                         </button>
                    </div>
                    {/* Info Overlay */}
                    <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 backdrop-blur rounded text-[9px] text-slate-300 font-mono border border-white/5 pointer-events-none">
                        {totalDuration}s • {frames.length} Frames
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center text-slate-600 gap-2 select-none">
                    <MonitorPlay size={32} strokeWidth={1} />
                    <span className="text-[10px] font-medium tracking-wider">智能多帧预览</span>
                </div>
            )}
        </div>
    );

    return (
        <>
            {/* Expanded Backdrop */}
            {isExpanded && (
                <div
                    className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm animate-in fade-in duration-300"
                    onClick={() => setIsExpanded(false)}
                />
            )}

            <div
                ref={dockRef}
                className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 transition-all duration-500 ease-[${SPRING}] animate-in slide-in-from-bottom-20 fade-in`}
            >
                <div className="relative group/player mb-2">
                     {/* Connectors (Visible only when not expanded) */}
                     {!isExpanded && (
                         <>
                            <div
                                onMouseDown={(e) => onConnectStart?.(e, 'input')}
                                className="absolute -left-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-white/20 bg-[#1c1c1e] flex items-center justify-center opacity-0 group-hover/player:opacity-100 hover:scale-125 transition-all cursor-crosshair z-30"
                                title="Connect Input"
                            >
                                <Plus size={12} className="text-white/50" />
                            </div>
                            <div
                                onMouseDown={(e) => onConnectStart?.(e, 'output')}
                                className="absolute -right-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full border border-white/20 bg-[#1c1c1e] flex items-center justify-center opacity-0 group-hover/player:opacity-100 hover:scale-125 transition-all cursor-crosshair z-30"
                                title="Connect Output"
                            >
                                <Plus size={12} className="text-white/50" />
                            </div>
                         </>
                     )}

                     {renderPlayer()}
                </div>

                <div
                    className="w-full h-6 bg-[#1c1c1e]/80 backdrop-blur-md rounded-t-lg border-t border-x border-white/5 relative overflow-hidden flex cursor-crosshair group/strip"
                    style={{ width: 'min(90vw, 820px)' }}
                    onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const index = Math.min(frames.length - 1, Math.floor(((e.clientX - rect.left) / rect.width) * frames.length));
                        setHoverIndex(index);
                    }}
                    onMouseLeave={() => setHoverIndex(null)}
                >
                    {frames.map((f, i) => (
                        <div key={f.id} className="flex-1 h-full relative border-r border-white/5 last:border-0 overflow-hidden">
                            <img src={f.src} className="w-full h-full object-cover opacity-30 grayscale group-hover/strip:opacity-50 transition-opacity" />
                        </div>
                    ))}

                    {/* Hover Highlight */}
                    {hoverIndex !== null && frames.length > 0 && (
                         <div
                            className="absolute top-0 bottom-0 bg-cyan-500/20 border-x border-cyan-500/50 pointer-events-none transition-all duration-75 ease-out"
                            style={{
                                left: `${(hoverIndex / frames.length) * 100}%`,
                                width: `${100 / frames.length}%`
                            }}
                         />
                    )}
                </div>

                <div
                    className="bg-[#0a0a0c]/95 backdrop-blur-2xl border border-white/10 rounded-b-2xl rounded-t-sm shadow-[0_20px_60px_rgba(0,0,0,0.6)] p-4 flex items-center gap-4 relative z-10"
                    style={{ width: 'min(90vw, 820px)' }}
                >
                    {/* Apple Style Close Button on Left */}
                    <button onClick={onClose} className="absolute -top-3 left-0 -translate-y-full p-2 text-slate-400 hover:text-white bg-black/50 backdrop-blur rounded-full border border-white/10 transition-colors">
                        <X size={14} />
                    </button>

                    {/* Scrollable List */}
                    <div className="flex-1 flex items-center gap-2 overflow-x-auto custom-scrollbar pb-1 min-h-[80px]">
                        {frames.map((frame, index) => (
                            <React.Fragment key={frame.id}>
                                {/* Draggable Thumbnail */}
                                <div
                                    className={`
                                        relative w-[72px] h-[72px] shrink-0 rounded-lg overflow-hidden border transition-all duration-300 ease-out group select-none
                                        ${draggingIndex === index ? 'opacity-30 scale-90 grayscale' : 'border-white/10 hover:border-white/30 bg-white/5'}
                                        ${dragOverIndex === index ? 'translate-x-2' : ''}
                                    `}
                                    onDragOver={(e) => handleDragOver(e, index)}
                                    onDrop={handleDrop}
                                >
                                    <img src={frame.src} className="w-full h-full object-cover pointer-events-none" />

                                    {/* Index Badge */}
                                    <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 rounded-full flex items-center justify-center text-[8px] font-bold text-white/80 pointer-events-none">
                                        {index + 1}
                                    </div>

                                    {/* Delete Button (Top Left) */}
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setFrames(p => p.filter(f => f.id !== frame.id)); }}
                                        className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full flex items-center justify-center bg-black/60 hover:bg-red-500 text-white/70 hover:text-white transition-colors opacity-0 group-hover:opacity-100 z-20"
                                    >
                                        <X size={10} strokeWidth={3} />
                                    </button>

                                    {/* Drag Handle (Center) */}
                                    <div
                                        className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing bg-black/20 backdrop-blur-[1px]"
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, index)}
                                    >
                                        <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center border border-white/20 text-white/80 hover:scale-110 transition-transform">
                                            <GripVertical size={16} />
                                        </div>
                                    </div>
                                </div>

                                {/* Link / Transition Button */}
                                {index < frames.length - 1 && (
                                    <div className="relative flex flex-col items-center justify-center w-6 shrink-0 z-10">
                                        <div className="h-[2px] w-full bg-white/10 absolute top-1/2 -translate-y-1/2 -z-10" />
                                        <button
                                            data-link-btn
                                            onClick={() => openTransitionEditor(frame.id, frame.transition)}
                                            className={`
                                                w-5 h-5 rounded-full flex items-center justify-center transition-all hover:scale-110 border
                                                ${frame.transition.prompt
                                                    ? 'bg-cyan-500 border-cyan-400 text-black shadow-[0_0_10px_rgba(6,182,212,0.5)]'
                                                    : 'bg-[#2c2c2e] border-white/20 text-slate-500 hover:text-white hover:border-white'}
                                            `}
                                        >
                                            <Link size={10} strokeWidth={2.5} />
                                        </button>
                                        <span className="text-[8px] text-slate-500 mt-1 font-mono tracking-tighter">{frame.transition.duration}s</span>
                                    </div>
                                )}
                            </React.Fragment>
                        ))}

                        {/* Add Button */}
                        {frames.length < 10 && (
                            <div
                                className="w-[72px] h-[72px] shrink-0 rounded-lg border border-dashed border-white/10 hover:border-white/30 bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center gap-1 cursor-pointer transition-all group active:scale-95"
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={handleDrop}
                            >
                                <Plus size={18} className="text-slate-500 group-hover:text-white transition-colors" />
                                <span className="text-[9px] text-slate-500 font-medium">Add</span>
                            </div>
                        )}
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" multiple onChange={handleFileUpload} />
                    </div>

                    {/* Right Action Column */}
                    <div className="pl-4 border-l border-white/10 flex flex-col gap-2 shrink-0">
                        <button
                            onClick={() => setFrames([])}
                            className="p-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
                            title="全部清空"
                        >
                            <Trash2 size={14} />
                        </button>
                        <button
                            onClick={handleGenerateClick}
                            disabled={frames.length < 2 || isGenerating}
                            className={`
                                w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg
                                ${frames.length >= 2 && !isGenerating ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white hover:scale-110 hover:shadow-cyan-500/30' : 'bg-white/10 text-slate-600 cursor-not-allowed'}
                            `}
                            title="生成视频"
                        >
                           {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} strokeWidth={3} />}
                        </button>
                    </div>
                </div>

                {editingTransitionId && (
                    <div
                        ref={transitionModalRef}
                        className="absolute bottom-[130px] z-[100] w-[240px] aspect-[9/16] bg-[#18181b] border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] flex flex-col animate-in slide-in-from-bottom-4 zoom-in-95 duration-300 overflow-hidden"
                        style={{ left: '50%', transform: 'translateX(-50%)' }}
                    >
                        {/* Header */}
                        <div className="px-4 py-4 border-b border-white/5 bg-white/5 flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-200 tracking-wide">运镜描述</span>
                            <button onClick={() => saveTransition()} className="text-slate-500 hover:text-white"><X size={12}/></button>
                        </div>

                        {/* Textarea */}
                        <div className="flex-1 p-4">
                            <textarea
                                className="w-full h-full bg-[#09090b] border border-white/10 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none leading-relaxed custom-scrollbar shadow-inner"
                                placeholder="描述镜头之间的转换..."
                                value={tempPrompt}
                                onChange={(e) => setTempPrompt(e.target.value)}
                                autoFocus
                            />
                        </div>

                        {/* Footer Actions */}
                        <div className="p-4 pt-0 flex flex-col gap-3">
                            <div className="flex items-center gap-2 bg-[#09090b] border border-white/10 rounded-xl px-3 py-2">
                                <Clock size={12} className="text-slate-500 shrink-0" />
                                <input
                                    type="range" min="1" max="6" step="0.5"
                                    value={tempDuration}
                                    onChange={(e) => setTempDuration(parseFloat(e.target.value))}
                                    className="flex-1 h-1 bg-white/10 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500 cursor-pointer"
                                />
                                <span className="text-[10px] font-mono text-slate-300 min-w-[24px] text-right">{tempDuration}s</span>
                            </div>
                            <button
                                onClick={saveTransition}
                                className="w-full py-2.5 bg-white text-black hover:bg-cyan-400 rounded-xl text-xs font-bold transition-colors shadow-lg"
                            >
                                确认
                            </button>
                        </div>

                        {/* Pointer Arrow */}
                        <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-3 h-3 bg-[#18181b] border-r border-b border-white/10 rotate-45 pointer-events-none" />
                    </div>
                )}
            </div>
        </>
    );
};
