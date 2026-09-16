import { ImageSourceBadgeOverlay, SeedreamSourceBadge } from './SeedreamSourceBadge';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Layers, Move, Copy, UserCheck, Loader2, Eraser, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface GeneratedImage {
    url: string;
    timestamp?: number;
}

interface ImageFusionModalProps {
    generatedImages: GeneratedImage[];
    onClose: () => void;
    onSubmit: (fusionType: 'fusion' | 'transfer' | 'imitation' | 'direct', params: FusionParams) => void;
    isProcessing?: boolean;
}

interface FusionParams {
    imageBk: string;
    imageHu: string;
    imageMb?: string;
    compositeImage?: string;
    seed?: number;
}

type FusionType = 'fusion' | 'transfer' | 'direct' | 'imitation';

const FUSION_MODES: { type: FusionType; name: string; desc: string; icon: React.ElementType }[] = [
    { type: 'fusion', name: '人物置景', desc: '人物融合到底图中', icon: Layers },
    { type: 'transfer', name: '迁移学习', desc: '选取底图融合区域，自动融合人物到对应位置', icon: Move },
    { type: 'direct', name: '直接拼合', desc: '所见即所得，直接拼图', icon: Copy },
    { type: 'imitation', name: '模仿学习', desc: '人物模仿另一图像的姿势', icon: UserCheck },
];





export const ImageFusionModal: React.FC<ImageFusionModalProps> = ({
    generatedImages,
    onClose,
    onSubmit,
    isProcessing = false
}) => {
    const [fusionType, setFusionType] = useState<FusionType>('fusion');
    const [selectedBk, setSelectedBk] = useState<string | null>(null);
    const [selectedHu, setSelectedHu] = useState<string | null>(null);
    const [seed, setSeed] = useState(-1);
    const [useRandomSeed, setUseRandomSeed] = useState(true);


    const [huPosition, setHuPosition] = useState({ x: 100, y: 100 });
    const [huScale, setHuScale] = useState(0.5);
    const [huOpacity, setHuOpacity] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [resizeCorner, setResizeCorner] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(null);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [resizeStart, setResizeStart] = useState({ scale: 0.5, mouseX: 0, mouseY: 0 });
    const compositeCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [huImageSize, setHuImageSize] = useState({ width: 200, height: 200 });


    const lastPosRef = useRef<{ x: number; y: number } | null>(null);


    const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [brushSize, setBrushSize] = useState(30);
    const [isErasing, setIsErasing] = useState(false);
    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const bgImageRef = useRef<HTMLImageElement | null>(null);
    const [canvasSize, setCanvasSize] = useState({ width: 512, height: 512 });


    useEffect(() => {
        if (fusionType === 'transfer' && selectedBk && maskCanvasRef.current) {
            const canvas = maskCanvasRef.current;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                bgImageRef.current = img;
                setCanvasSize({ width: img.width, height: img.height });
                canvas.width = img.width;
                canvas.height = img.height;

                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            };
            img.src = selectedBk;
        }
    }, [fusionType, selectedBk]);


    const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = maskCanvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }, []);

    const draw = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        const canvas = maskCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        const { x, y } = getCanvasCoords(e);
        const lastPos = lastPosRef.current;

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = brushSize * 2;
        ctx.strokeStyle = isErasing ? '#000000' : 'rgba(255, 255, 255, 0.8)';
        ctx.fillStyle = isErasing ? '#000000' : 'rgba(255, 255, 255, 0.8)';

        if (lastPos) {

            ctx.beginPath();
            ctx.moveTo(lastPos.x, lastPos.y);
            ctx.lineTo(x, y);
            ctx.stroke();
        } else {

            ctx.beginPath();
            ctx.arc(x, y, brushSize, 0, Math.PI * 2);
            ctx.fill();
        }

        lastPosRef.current = { x, y };
    }, [isDrawing, brushSize, isErasing, getCanvasCoords]);

    const startDrawing = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        setIsDrawing(true);
        lastPosRef.current = null;


        const canvas = maskCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        const { x, y } = getCanvasCoords(e);
        ctx.fillStyle = isErasing ? '#000000' : 'rgba(255, 255, 255, 0.8)';
        ctx.beginPath();
        ctx.arc(x, y, brushSize, 0, Math.PI * 2);
        ctx.fill();
        lastPosRef.current = { x, y };
    }, [getCanvasCoords, brushSize, isErasing]);

    const stopDrawing = useCallback(() => {
        setIsDrawing(false);
        lastPosRef.current = null;
        if (maskCanvasRef.current) {
            setMaskDataUrl(maskCanvasRef.current.toDataURL('image/png'));
        }
    }, []);

    const clearMask = useCallback(() => {
        const canvas = maskCanvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx || !canvas) return;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        setMaskDataUrl(null);
    }, []);


    useEffect(() => {
        if (selectedHu) {
            const img = new Image();
            img.onload = () => {
                setHuImageSize({ width: img.width, height: img.height });
            };
            img.src = selectedHu;
        }
    }, [selectedHu]);


    const handleMouseDown = (e: React.MouseEvent) => {
        if (fusionType !== 'fusion' && fusionType !== 'direct') return;
        if (isResizing) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - huPosition.x, y: e.clientY - huPosition.y });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isResizing && resizeCorner) {

            const deltaX = e.clientX - resizeStart.mouseX;
            const deltaY = e.clientY - resizeStart.mouseY;
            const delta = Math.max(deltaX, deltaY);


            let scaleDelta = delta / 300;
            if (resizeCorner === 'tl' || resizeCorner === 'bl') {
                scaleDelta = -scaleDelta;
            }


            const newScale = Math.max(0.01, Math.min(10, resizeStart.scale + scaleDelta));
            setHuScale(newScale);
        } else if (isDragging) {
            setHuPosition({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        setIsResizing(false);
        setResizeCorner(null);
    };


    const handleResizeStart = (corner: 'tl' | 'tr' | 'bl' | 'br', e: React.MouseEvent) => {
        e.stopPropagation();
        setIsResizing(true);
        setResizeCorner(corner);
        setResizeStart({ scale: huScale, mouseX: e.clientX, mouseY: e.clientY });
    };


    const generateCompositeImage = useCallback(async (): Promise<string> => {
        if (!selectedBk || !selectedHu) throw new Error('请选择底图和人物图');

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建Canvas');


        const loadImg = (src: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = src;
            });
        };

        const [bkImg, huImg] = await Promise.all([
            loadImg(selectedBk),
            loadImg(selectedHu)
        ]);


        canvas.width = bkImg.width;
        canvas.height = bkImg.height;


        ctx.drawImage(bkImg, 0, 0);


        const containerEl = containerRef.current;
        if (containerEl) {
            const containerRect = containerEl.getBoundingClientRect();
            const scaleX = bkImg.width / containerRect.width;
            const scaleY = bkImg.height / containerRect.height;

            const huWidth = huImg.width * huScale;
            const huHeight = huImg.height * huScale;
            const huX = huPosition.x * scaleX;
            const huY = huPosition.y * scaleY;


            ctx.drawImage(huImg, huX, huY, huWidth * scaleX, huHeight * scaleY);
        } else {

            const huWidth = huImg.width * huScale;
            const huHeight = huImg.height * huScale;
            ctx.drawImage(huImg, huPosition.x, huPosition.y, huWidth, huHeight);
        }

        return canvas.toDataURL('image/png');
    }, [selectedBk, selectedHu, huPosition, huScale]);

    const handleSubmit = async () => {
        if (!selectedBk || !selectedHu) return;

        try {
            if (fusionType === 'fusion') {

                const compositeImage = await generateCompositeImage();
                onSubmit(fusionType, {
                    imageBk: selectedBk,
                    imageHu: selectedHu,
                    compositeImage: compositeImage,
                    seed: useRandomSeed ? -1 : seed
                });
            } else if (fusionType === 'transfer') {

                if (!maskDataUrl) {
                    alert('请在底图上绘制蒙版区域');
                    return;
                }
                onSubmit(fusionType, {
                    imageBk: selectedBk,
                    imageHu: selectedHu,
                    imageMb: maskDataUrl,
                    seed: useRandomSeed ? -1 : seed
                });
            } else if (fusionType === 'direct') {

                const compositeImage = await generateCompositeImage();
                onSubmit(fusionType, {
                    imageBk: selectedBk,
                    imageHu: selectedHu,
                    compositeImage: compositeImage
                });
            } else {

                onSubmit(fusionType, {
                    imageBk: selectedBk,
                    imageHu: selectedHu,
                    seed: useRandomSeed ? -1 : seed
                });
            }
        } catch (error) {
            console.error('融合处理失败:', error);
            alert('处理失败，请重试');
        }
    };

    const canSubmit = selectedBk && selectedHu && (fusionType !== 'transfer' || maskDataUrl);

    return (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-label="图像融合" className="app-modal-surface bg-n0 rounded-2xl border border-n40 shadow-bottom w-[1000px] max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-n40 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-500/20 rounded-lg">
                            <Layers className="w-5 h-5 text-orange-400" />
                        </div>
                        <h2 className="text-lg font-bold text-n800">图像融合</h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="p-2 hover:bg-n20 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <X className="w-5 h-5 text-n300" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 overflow-y-auto flex-1">

                    <div className="space-y-3">
                        <label className="text-sm font-medium text-n700">融合模式</label>
                        <div className="grid grid-cols-4 gap-3">
                            {FUSION_MODES.map((mode) => {
                                const Icon = mode.icon;
                                return (
                                    <button
                                        key={mode.type}
                                        onClick={() => setFusionType(mode.type)}
                                        disabled={isProcessing}
                                        className={`p-3 rounded-md border-2 transition-all ${
                                            fusionType === mode.type
                                                ? 'border-orange-500 bg-orange-500/10'
                                                : 'border-n40 bg-n0 hover:border-n40'
                                        } disabled:opacity-50`}
                                    >
                                        <div className="flex flex-col items-center gap-2">
                                            <Icon className={`w-5 h-5 ${fusionType === mode.type ? 'text-orange-400' : 'text-n300'}`} />
                                            <span className={`text-sm font-medium ${fusionType === mode.type ? 'text-orange-400' : 'text-n700'}`}>
                                                {mode.name}
                                            </span>
                                            <span className="text-xs text-n100 text-center">
                                                {mode.desc}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>


                    <div className="grid grid-cols-2 gap-6">

                        <div className="space-y-3">
                            <label className="text-sm font-medium text-n700">
                                {fusionType === 'imitation' ? '姿势参考图' : '底图/背景图'}
                            </label>
                            <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto p-2 bg-n30 rounded-lg">
                                {generatedImages.map((img, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => !isProcessing && setSelectedBk(img.url)}
                                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                                            selectedBk === img.url
                                                ? 'border-orange-500 ring-2 ring-orange-500/50'
                                                : 'border-transparent hover:border-n40'
                                        }`}
                                    >
                                        <img src={img.url} alt={`Image ${idx}`} className="w-full h-full object-cover" />
                                        <ImageSourceBadgeOverlay reference={img.url} />
                                    </div>
                                ))}
                            </div>
                        </div>


                        <div className="space-y-3">
                            <label className="text-sm font-medium text-n700">人物图</label>
                            <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto p-2 bg-n30 rounded-lg">
                                {generatedImages.map((img, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => !isProcessing && setSelectedHu(img.url)}
                                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                                            selectedHu === img.url
                                                ? 'border-blue-500 ring-2 ring-blue-500/50'
                                                : 'border-transparent hover:border-n40'
                                        }`}
                                    >
                                        <img src={img.url} alt={`Image ${idx}`} className="w-full h-full object-cover" /><ImageSourceBadgeOverlay reference={img.url} />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>


                    {(fusionType === 'fusion' || fusionType === 'direct') && selectedBk && selectedHu && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <label className="text-sm font-medium text-n700">
                                    调整人物位置和大小（拖拽移动，拖拽四角缩放）
                                </label>
                                <div className="flex items-center gap-4">

                                    <label className="flex items-center gap-2 text-sm text-n300">
                                        透明度
                                        <input
                                            type="range"
                                            min="20"
                                            max="100"
                                            value={huOpacity * 100}
                                            onChange={(e) => setHuOpacity(parseInt(e.target.value) / 100)}
                                            className="w-20 h-1.5 accent-orange-500"
                                        />
                                        <span className="w-8 text-center">{Math.round(huOpacity * 100)}%</span>
                                    </label>

                                    <span className="text-sm text-n300">缩放: {Math.round(huScale * 100)}%</span>

                                    <button
                                        onClick={() => { setHuPosition({ x: 100, y: 100 }); setHuScale(0.5); setHuOpacity(1); }}
                                        className="p-2 bg-n0 hover:bg-n20 rounded-lg"
                                        title="重置位置、大小和透明度"
                                    >
                                        <RotateCcw className="w-4 h-4 text-n700" />
                                    </button>
                                </div>
                            </div>
                            <div
                                ref={containerRef}
                                className="relative aspect-video bg-black rounded-lg overflow-hidden border border-n40"
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                            >

                                <img
                                    src={selectedBk}
                                    alt="Background"
                                    className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                                />

                                <div
                                    className="absolute cursor-move"
                                    style={{
                                        left: huPosition.x,
                                        top: huPosition.y,
                                        width: huImageSize.width * huScale,
                                        height: huImageSize.height * huScale,
                                        opacity: huOpacity,
                                    }}
                                    onMouseDown={handleMouseDown}
                                >

                                    <img
                                        src={selectedHu}
                                        alt="Character"
                                        className="w-full h-full pointer-events-none"
                                        style={{ maxWidth: 'none' }}
                                        draggable={false}
                                    />

                                    <div className="absolute inset-0 border-2 border-orange-400 pointer-events-none" />

                                    <div
                                        className="absolute -top-2 -left-2 w-4 h-4 bg-orange-500 border-2 border-white rounded-sm cursor-nw-resize hover:bg-orange-400"
                                        onMouseDown={(e) => handleResizeStart('tl', e)}
                                    />
                                    <div
                                        className="absolute -top-2 -right-2 w-4 h-4 bg-orange-500 border-2 border-white rounded-sm cursor-ne-resize hover:bg-orange-400"
                                        onMouseDown={(e) => handleResizeStart('tr', e)}
                                    />
                                    <div
                                        className="absolute -bottom-2 -left-2 w-4 h-4 bg-orange-500 border-2 border-white rounded-sm cursor-sw-resize hover:bg-orange-400"
                                        onMouseDown={(e) => handleResizeStart('bl', e)}
                                    />
                                    <div
                                        className="absolute -bottom-2 -right-2 w-4 h-4 bg-orange-500 border-2 border-white rounded-sm cursor-se-resize hover:bg-orange-400"
                                        onMouseDown={(e) => handleResizeStart('br', e)}
                                    />
                                </div>
                            </div>
                        </div>
                    )}


                    {fusionType === 'transfer' && selectedBk && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-n700">
                                    在底图上绘制蒙版（白色区域为人物迁移位置）
                                </label>
                                <div className="flex items-center gap-3">
                                    <label className="flex items-center gap-2 text-sm text-n300">
                                        画笔
                                        <input
                                            type="range"
                                            min="5"
                                            max="100"
                                            value={brushSize}
                                            onChange={(e) => setBrushSize(parseInt(e.target.value))}
                                            className="w-24"
                                        />
                                        <span className="w-8 text-center">{brushSize}px</span>
                                    </label>
                                    <button
                                        onClick={() => setIsErasing(!isErasing)}
                                        className={`p-2 rounded-lg transition-colors ${
                                            isErasing ? 'bg-r50 text-danger' : 'bg-n0 text-n300 hover:bg-n20'
                                        }`}
                                        title={isErasing ? '橡皮擦模式' : '画笔模式'}
                                    >
                                        <Eraser className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={clearMask}
                                        className="px-3 py-1 bg-n0 hover:bg-n20 text-n700 rounded-lg text-sm"
                                    >
                                        清除蒙版
                                    </button>
                                </div>
                            </div>

                            <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-n40">
                                <img
                                    src={selectedBk}
                                    alt="Background"
                                    className="absolute inset-0 w-full h-full object-contain"
                                />
                                <canvas
                                    ref={maskCanvasRef}
                                    className="absolute inset-0 w-full h-full object-contain cursor-crosshair"
                                    style={{ opacity: 0.6, mixBlendMode: 'screen' }}
                                    onMouseDown={startDrawing}
                                    onMouseMove={draw}
                                    onMouseUp={stopDrawing}
                                    onMouseLeave={stopDrawing}
                                />
                                <div className="absolute bottom-2 left-2 text-xs text-n300 bg-black/70 px-2 py-1 rounded">
                                    在此绘制蒙版区域
                                </div>
                                {selectedHu && (
                                    <div className="absolute top-2 right-2 text-xs text-success bg-black/70 px-2 py-1 rounded flex items-center gap-1">
                                        <span>✓</span>
                                        <span>已选择人物图</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}


                    {fusionType === 'imitation' && selectedBk && selectedHu && (
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-n700">人物图（将模仿姿势）</label>
                                <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-n40">
                                    <img src={selectedHu} alt="Character" className="w-full h-full object-contain" /><ImageSourceBadgeOverlay reference={selectedHu} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-n700">姿势参考图</label>
                                <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-n40">
                                    <img src={selectedBk} alt="Pose Reference" className="w-full h-full object-contain" /><ImageSourceBadgeOverlay reference={selectedBk} />
                                </div>
                            </div>
                        </div>
                    )}


                    {fusionType !== 'direct' && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-n700">种子值</label>
                                <label className="flex items-center gap-2 text-sm text-n300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={useRandomSeed}
                                        onChange={(e) => setUseRandomSeed(e.target.checked)}
                                        disabled={isProcessing}
                                        className="rounded border-n40 bg-n0 text-orange-500 focus:ring-orange-500"
                                    />
                                    随机
                                </label>
                            </div>
                            {!useRandomSeed && (
                                <input
                                    type="number"
                                    value={seed}
                                    onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                                    disabled={isProcessing}
                                    className="w-full px-4 py-2 bg-n0 border border-n40 rounded-lg text-n800 focus:outline-none focus:border-orange-500 disabled:opacity-50"
                                    placeholder="输入种子值"
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-n40 flex-shrink-0">
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing || !canSubmit}
                        className="px-6 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                处理中...
                            </>
                        ) : (
                            <>
                                <Layers className="w-4 h-4" />
                                {fusionType === 'direct' ? '直接合成' : '开始融合'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImageFusionModal;
