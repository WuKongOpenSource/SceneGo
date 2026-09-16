
import React, { useRef, useState, useEffect } from 'react';
import {
    X, Brush, Eraser, Palette, Undo, Trash2,
    MousePointer2, Download, Play, Image as ImageIcon,
    Activity, Wand2, Loader2, ChevronDown, Upload, Layers
} from 'lucide-react';
import { useStudioRuntime } from '../services/runtime';
import {
    STUDIO_IMAGE_MODEL_CONFIGURED,
    STUDIO_IMAGE_MODEL_POSE_LABEL,
    STUDIO_IMAGE_MODEL_SHORT_LABEL,
    STUDIO_VIDEO_MODEL_FAST,
    STUDIO_VIDEO_MODEL_FAST_LABEL,
} from '../services/modelOptions';

interface SketchEditorProps {
    onClose: () => void;
    onGenerate: (type: 'image' | 'video', result: string, prompt: string) => void;
}

type Tool = 'brush' | 'eraser';
type Mode = 'video' | 'image' | 'pose';

const PRESET_COLORS = [
    '#000000', '#ffffff', '#ff3b30', '#ff9500',
    '#ffcc00', '#4cd964', '#5ac8fa', '#007aff',
    '#5856d6', '#ff2d55', '#8e8e93'
];

export const SketchEditor: React.FC<SketchEditorProps> = ({ onClose, onGenerate }) => {
    const runtime = useStudioRuntime();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [tool, setTool] = useState<Tool>('brush');
    const [brushColor, setBrushColor] = useState('#000000');
    const [brushSize, setBrushSize] = useState(5);
    const [eraserSize, setEraserSize] = useState(30);
    const [canvasHistory, setCanvasHistory] = useState<ImageData[]>([]);

    const [backgroundImage, setBackgroundImage] = useState<HTMLImageElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [activeMode, setActiveMode] = useState<Mode>('video');
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [showPalette, setShowPalette] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.scale(dpr, dpr);
            ctx.clearRect(0, 0, rect.width, rect.height);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            saveHistory();
        }
    }, []);

    const saveHistory = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
            setCanvasHistory(prev => [...prev.slice(-10), data]);
        }
    };

    const handleUndo = () => {
        if (canvasHistory.length <= 1) return;
        const newHistory = [...canvasHistory];
        newHistory.pop();
        const prevState = newHistory[newHistory.length - 1];
        setCanvasHistory(newHistory);

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx && prevState) {
            ctx.putImageData(prevState, 0, 0);
        }
    };

    const handleClear = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            saveHistory();
        }
    };

    const handleImportBackground = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => setBackgroundImage(img);
                img.src = ev.target?.result as string;
            };
            reader.readAsDataURL(file);
        }
    };

    const getPos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        setIsDrawing(true);
        const { x, y } = getPos(e);
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            if (tool === 'eraser') {
                ctx.globalCompositeOperation = 'destination-out';
                ctx.lineWidth = eraserSize;
            } else {
                ctx.globalCompositeOperation = 'source-over';
                ctx.strokeStyle = brushColor;
                ctx.lineWidth = brushSize;
            }
        }
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        const { x, y } = getPos(e);
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx) {
            ctx.lineTo(x, y);
            ctx.stroke();
        }
    };

    const stopDrawing = () => {
        if (isDrawing) {
            setIsDrawing(false);
            const ctx = canvasRef.current?.getContext('2d');
            ctx?.closePath();
            if (ctx) ctx.globalCompositeOperation = 'source-over';
            saveHistory();
        }
    };

    const getCompositeDataURL = (): string => {
        const canvas = canvasRef.current;
        if (!canvas) return '';

        const osc = document.createElement('canvas');
        osc.width = canvas.width;
        osc.height = canvas.height;
        const ctx = osc.getContext('2d');
        if (!ctx) return '';

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, osc.width, osc.height);

        if (backgroundImage) {
            const scale = Math.min(osc.width / backgroundImage.width, osc.height / backgroundImage.height);
            const w = backgroundImage.width * scale;
            const h = backgroundImage.height * scale;
            const x = (osc.width - w) / 2;
            const y = (osc.height - h) / 2;
            ctx.drawImage(backgroundImage, x, y, w, h);
        }

        ctx.drawImage(canvas, 0, 0);

        return osc.toDataURL('image/png');
    };

    const handleGenerate = async () => {
        if (!prompt.trim() || isGenerating) return;
        setIsGenerating(true);

        try {
            if (activeMode === 'pose') {
                const posePrompt = `
                Generate a simple, high-contrast black line art sketch on a white background.
                Subject: ${prompt}.
                Style: Minimalist stick figure or outline drawing, clear lines, no shading.
                `;

                const res = await runtime.generateImage(posePrompt, STUDIO_IMAGE_MODEL_CONFIGURED, [], { aspectRatio: '16:9', count: 1 });
                const imgUrl = res[0];

                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    const canvas = canvasRef.current;
                    const ctx = canvas?.getContext('2d');
                    if (canvas && ctx) {
                        // Pixel history makes generated line art a destructive canvas edit.
                        ctx.globalCompositeOperation = 'source-over';

                        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
                        const w = img.width * scale;
                        const h = img.height * scale;
                        const x = (canvas.width - w) / 2;
                        const y = (canvas.height - h) / 2;

                        ctx.drawImage(img, x, y, w, h);
                        saveHistory();
                        setIsGenerating(false);
                    }
                };
                img.onerror = () => {
                    throw new Error("Failed to load generated pose image");
                };
                img.src = imgUrl;

            } else {
                const compositeBase64 = getCompositeDataURL();

                if (activeMode === 'video') {
                    const res = await runtime.generateVideo(
                        prompt,
                        STUDIO_VIDEO_MODEL_FAST,
                        {
                          aspectRatio: '16:9',
                          generationMode: 'DEFAULT',
                          inputImage: compositeBase64,
                        },
                    );
                    onGenerate('video', res.uri, prompt);
                } else {
                    const res = await runtime.generateImage(
                        prompt,
                        STUDIO_IMAGE_MODEL_CONFIGURED,
                        [compositeBase64],
                        { aspectRatio: '16:9', count: 1 }
                    );
                    onGenerate('image', res[0], prompt);
                }
                onClose();
            }
        } catch (e) {
            console.error(e);
            alert("生成失败，请重试");
            setIsGenerating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-[#0a0a0c] flex flex-col animate-in fade-in duration-300">
            {/* 1. Top Navigation Bar */}
            <div className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#1c1c1e]">
                <button
                    onClick={onClose}
                    className="absolute left-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                    <X size={16} />
                </button>

                <div className="flex-1 flex justify-center">
                    <div className="ui-tabs ui-tabs--compact ui-tabs--dark">
                        {[
                            { id: 'video', label: '涂鸦生视频', icon: Play },
                            { id: 'image', label: '涂鸦生图', icon: ImageIcon },
                            { id: 'pose', label: '姿势生成器 (Pose)', icon: Activity }
                        ].map(mode => (
                            <button
                                key={mode.id}
                                onClick={() => setActiveMode(mode.id as Mode)}
                                className="ui-tab"
                                aria-pressed={activeMode === mode.id}
                            >
                                <mode.icon size={12} />
                                {mode.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 2. Main Canvas Area */}
            <div className="flex-1 relative bg-[#121214] flex items-center justify-center p-8 overflow-hidden">

                {/* Floating Toolbar */}
                <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 p-1.5 bg-[#2c2c2e]/90 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
                    <button
                        onClick={() => setTool('brush')}
                        className={`p-2.5 rounded-full transition-colors ${tool === 'brush' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                        title="画笔"
                    >
                        <Brush size={16} />
                    </button>

                    <button
                        onClick={() => setTool('eraser')}
                        className={`p-2.5 rounded-full transition-colors ${tool === 'eraser' ? 'bg-cyan-500 text-black' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                        title="橡皮擦"
                    >
                        <Eraser size={16} />
                    </button>

                    <div className="w-px h-6 bg-white/10 mx-1" />

                    <div className="relative">
                        <button
                            onClick={() => setShowPalette(!showPalette)}
                            className="p-2.5 rounded-full transition-colors text-slate-400 hover:text-white hover:bg-white/5 relative"
                            title="调色板"
                        >
                            <Palette size={16} style={{ color: tool === 'brush' ? brushColor : undefined }} />
                            <div className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-[#2c2c2e]" style={{ backgroundColor: brushColor }} />
                        </button>

                        {showPalette && (
                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 p-3 bg-[#1c1c1e] border border-white/10 rounded-xl shadow-xl grid grid-cols-4 gap-2 w-48 z-30">
                                {PRESET_COLORS.map(c => (
                                    <button
                                        key={c}
                                        onClick={() => { setBrushColor(c); setTool('brush'); setShowPalette(false); }}
                                        className={`w-8 h-8 rounded-full border-2 ${brushColor === c ? 'border-white' : 'border-transparent hover:scale-110'}`}
                                        style={{ backgroundColor: c }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="w-px h-6 bg-white/10 mx-1" />

                    <button onClick={handleUndo} className="p-2.5 rounded-full text-slate-400 hover:text-white hover:bg-white/5">
                        <Undo size={16} />
                    </button>

                    <button onClick={handleClear} className="p-2.5 rounded-full text-red-400 hover:bg-red-500/10">
                        <Trash2 size={16} />
                    </button>
                </div>

                {/* The Canvas Wrapper */}
                {backgroundImage && <SeedreamSourceBadge reference={backgroundImage.src} />}
                <div className="relative shadow-2xl rounded-lg overflow-hidden border border-white/5 bg-[#ffffff] select-none" style={{ aspectRatio: '16/9', height: '100%', maxHeight: '800px' }}>
                     {/* Background Image Layer */}
                     {backgroundImage && (
                        <img
                            src={backgroundImage.src}
                            className="absolute inset-0 w-full h-full object-contain pointer-events-none opacity-50"
                            alt="Reference"
                        />
                    )}

                    <canvas
                        ref={canvasRef}
                        className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                    />
                </div>
            </div>

            {/* 3. Bottom Control Bar */}
            <div className="h-20 bg-[#1c1c1e] border-t border-white/10 flex items-center px-8 gap-4">
                {/* Tools (Left) */}
                <div className="flex items-center gap-2 mr-4">
                    {/* Import Background Button */}
                     <div
                        className="relative p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white border border-white/5 cursor-pointer hover:bg-white/10 transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                        title="导入底图"
                     >
                        <Layers size={16} />
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImportBackground} />
                    </div>
                    <button onClick={() => { if(canvasRef.current){ const a = document.createElement('a'); a.href = getCompositeDataURL(); a.download='sketch.png'; a.click(); } }} className="p-2 rounded-lg bg-white/5 text-slate-400 hover:text-white border border-white/5" title="下载当前画布">
                        <Download size={16} />
                    </button>
                </div>

                {/* Input Area */}
                <div className="flex-1 relative">
                    <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder={activeMode === 'pose' ? "描述姿势 (e.g. A stick figure running fast)..." : "描述画面内容 (e.g. Milk splash around the bottle)..."}
                        className="w-full h-11 bg-black/30 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                        onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                    />
                </div>

                {/* Settings & Generate */}
                <div className="flex items-center gap-3">
                    <div className="h-11 px-4 flex items-center gap-2 bg-black/30 border border-white/10 rounded-xl text-xs text-slate-300 font-medium">
                        <span>{activeMode === 'pose' ? STUDIO_IMAGE_MODEL_POSE_LABEL : activeMode === 'video' ? STUDIO_VIDEO_MODEL_FAST_LABEL : STUDIO_IMAGE_MODEL_SHORT_LABEL}</span>
                        <ChevronDown size={12} className="text-slate-500" />
                    </div>

                    <div className="w-px h-6 bg-white/10 mx-2" />

                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating || !prompt.trim()}
                        className={`
                            h-11 px-6 rounded-xl flex items-center gap-2 font-bold text-sm transition-all
                            ${isGenerating || !prompt.trim()
                                ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                                : activeMode === 'pose'
                                    ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:scale-105'
                                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:scale-105'}
                        `}
                    >
                        {isGenerating ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                        <span>{activeMode === 'pose' ? '生成姿势' : '生成作品'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};
import { SeedreamSourceBadge } from '@app/components/SeedreamSourceBadge';
