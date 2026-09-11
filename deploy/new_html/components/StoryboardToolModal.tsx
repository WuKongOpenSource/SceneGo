import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Globe, Wand2, Grid3X3, Loader2, ChevronRight, RefreshCw, Trash2, ZoomIn, ZoomOut, RotateCcw, Move } from 'lucide-react';

interface StoryboardToolModalProps {
    generatedImages: Array<{ url: string; timestamp?: number }>;
    materialImages?: Array<{ url: string; name?: string }>;
    onClose: () => void;
    onPanorama360: (imageUrl: string, prompt: string, seed: number) => Promise<string>;
    onPanoramaFusion: (image1: string, image3: string, prompt: string, image2?: string, seed?: number) => Promise<string>;
    onAutoStoryboard: (imageUrl: string, prompt: string, seed: number) => Promise<string>;
    onMultiGridStoryboard: (mode: 'multi_shot' | 'story', prompt: string, referenceImage: string) => Promise<{ images?: string[] }>;
    isProcessing?: boolean;
}

type ToolType = 'panorama' | 'auto' | 'multi_grid';
type MultiGridMode = 'multi_shot' | 'story';





export const StoryboardToolModal: React.FC<StoryboardToolModalProps> = ({
    generatedImages,
    materialImages = [],
    onClose,
    onPanorama360,
    onPanoramaFusion,
    onAutoStoryboard,
    onMultiGridStoryboard,
    isProcessing = false
}) => {
    const [toolType, setToolType] = useState<ToolType>('panorama');
    const [processing, setProcessing] = useState(false);


    const [panoramaStep, setPanoramaStep] = useState<1 | 2>(1);
    const [selectedSceneImage, setSelectedSceneImage] = useState<string | null>(null);
    const [panorama360Result, setPanorama360Result] = useState<string | null>(null);
    const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
    const [fusionPrompt, setFusionPrompt] = useState('');
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cropContainerRef = useRef<HTMLDivElement>(null);
    const [isCropping, setIsCropping] = useState(false);
    const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);


    const [panoramaZoom, setPanoramaZoom] = useState(1);
    const [panoramaOffset, setPanoramaOffset] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState({ x: 0, y: 0 });
    const panoramaImageRef = useRef<HTMLImageElement>(null);
    const [panoramaImageSize, setPanoramaImageSize] = useState({ width: 0, height: 0 });


    const [autoImage, setAutoImage] = useState<string | null>(null);
    const [autoPrompt, setAutoPrompt] = useState('');
    const [generatedScript, setGeneratedScript] = useState<string | null>(null);


    const [multiGridMode, setMultiGridMode] = useState<MultiGridMode>('multi_shot');
    const [multiGridPrompt, setMultiGridPrompt] = useState('');
    const [multiGridResults, setMultiGridResults] = useState<string[]>([]);
    const [multiGridImage, setMultiGridImage] = useState<string | null>(null);

    const [seed, setSeed] = useState(-1);
    const [useRandomSeed, setUseRandomSeed] = useState(true);


    const [panorama360Prompt, setPanorama360Prompt] = useState('');


    useEffect(() => {
        if (panorama360Result) {
            const img = new Image();
            img.onload = () => {
                setPanoramaImageSize({ width: img.width, height: img.height });

                setPanoramaZoom(1);
                setPanoramaOffset({ x: 0, y: 0 });
            };
            img.src = panorama360Result;
        }
    }, [panorama360Result]);


    const handlePanorama360Generate = async () => {
        if (!selectedSceneImage) return;
        setProcessing(true);
        try {
            const result = await onPanorama360(selectedSceneImage, panorama360Prompt, useRandomSeed ? -1 : seed);
            setPanorama360Result(result);
            setPanoramaStep(2);
        } catch (error) {
            console.error('360度全景生成失败:', error);
        } finally {
            setProcessing(false);
        }
    };


    const handlePanoramaPanStart = useCallback((e: React.MouseEvent) => {

        if (e.button === 1 || e.button === 2 || e.altKey) {
            e.preventDefault();
            setIsPanning(true);
            setPanStart({ x: e.clientX - panoramaOffset.x, y: e.clientY - panoramaOffset.y });
        }
    }, [panoramaOffset]);

    const handlePanoramaPanMove = useCallback((e: React.MouseEvent) => {
        if (isPanning) {
            setPanoramaOffset({
                x: e.clientX - panStart.x,
                y: e.clientY - panStart.y
            });
        }
    }, [isPanning, panStart]);

    const handlePanoramaPanEnd = useCallback(() => {
        setIsPanning(false);
    }, []);


    const handlePanoramaZoom = useCallback((delta: number) => {
        setPanoramaZoom(prev => Math.max(0.5, Math.min(3, prev + delta)));
    }, []);


    const resetPanoramaView = useCallback(() => {
        setPanoramaZoom(1);
        setPanoramaOffset({ x: 0, y: 0 });
    }, []);


    const handleCropMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const container = cropContainerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setCropStart({ x, y });
        setCropRect({ x, y, width: 0, height: 0 });
        setIsCropping(true);
    }, []);

    const handleCropMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!isCropping || !cropStart) return;

        const container = cropContainerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

        const newRect = {
            x: Math.min(cropStart.x, currentX),
            y: Math.min(cropStart.y, currentY),
            width: Math.abs(currentX - cropStart.x),
            height: Math.abs(currentY - cropStart.y)
        };

        setCropRect(newRect);
    }, [isCropping, cropStart]);

    const handleCropMouseUp = useCallback(() => {
        if (isCropping && cropRect) {

            if (cropRect.width < 30 || cropRect.height < 30) {
                setCropRect(null);
            }
        }
        setIsCropping(false);
    }, [isCropping, cropRect]);


    const clearCropRect = useCallback(() => {
        setCropRect(null);
        setCropStart(null);
    }, []);


    const handlePanoramaFusion = async () => {
        if (!cropRect || selectedCharacters.length === 0) return;

        const container = cropContainerRef.current;
        if (!container || !panorama360Result) return;

        setProcessing(true);
        try {

            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = reject;
                img.src = panorama360Result;
            });


            const containerRect = container.getBoundingClientRect();
            const scaleX = img.naturalWidth / containerRect.width;
            const scaleY = img.naturalHeight / containerRect.height;


            const actualCropRect = {
                x: Math.round(cropRect.x * scaleX),
                y: Math.round(cropRect.y * scaleY),
                width: Math.round(cropRect.width * scaleX),
                height: Math.round(cropRect.height * scaleY)
            };


            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = actualCropRect.width;
            tempCanvas.height = actualCropRect.height;
            const tempCtx = tempCanvas.getContext('2d');
            if (!tempCtx) return;

            tempCtx.drawImage(
                img,
                actualCropRect.x, actualCropRect.y, actualCropRect.width, actualCropRect.height,
                0, 0, actualCropRect.width, actualCropRect.height
            );
            const croppedImage = tempCanvas.toDataURL('image/png');

            const result = await onPanoramaFusion(
                selectedCharacters[0],
                croppedImage,
                fusionPrompt,
                selectedCharacters[1],
                useRandomSeed ? -1 : seed
            );


            console.log('全景融合完成:', result);
        } catch (error) {
            console.error('全景融合失败:', error);
        } finally {
            setProcessing(false);
        }
    };


    const handleAutoStoryboard = async () => {
        if (!autoImage || !autoPrompt) return;

        setProcessing(true);
        try {
            await onAutoStoryboard(autoImage, autoPrompt, useRandomSeed ? -1 : seed);
        } catch (error) {
            console.error('自动分镜失败:', error);
        } finally {
            setProcessing(false);
        }
    };


    const handleMultiGridGenerate = async () => {
        if (!multiGridPrompt.trim() || !multiGridImage) return;

        setProcessing(true);
        try {
            const result = await onMultiGridStoryboard(multiGridMode, multiGridPrompt, multiGridImage);
            if (result.images) {
                setMultiGridResults(result.images);
            }
        } catch (error) {
            console.error('多宫格分镜失败:', error);
        } finally {
            setProcessing(false);
        }
    };

    const allImages = [...generatedImages.map(i => i.url), ...materialImages.map(i => i.url)];

    return (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-label="分镜工具" className="app-modal-surface bg-n0 rounded-2xl border border-n40 shadow-bottom w-[1300px] max-w-[95vw] max-h-[92vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-n40 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-primary-light rounded-lg">
                            <Wand2 className="w-5 h-5 text-primary" />
                        </div>
                        <h2 className="text-lg font-bold text-n800">分镜工具</h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={processing}
                        className="p-2 hover:bg-n20 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <X className="w-5 h-5 text-n300" />
                    </button>
                </div>


                <div className="flex border-b border-n40 flex-shrink-0">
                    <button
                        onClick={() => setToolType('panorama')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${
                            toolType === 'panorama'
                                ? 'text-primary border-b-2 border-primary bg-primary-light'
                                : 'text-n300 hover:text-n700'
                        }`}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <Globe className="w-4 h-4" />
                            全景截图融合
                        </div>
                    </button>
                    <button
                        onClick={() => setToolType('auto')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${
                            toolType === 'auto'
                                ? 'text-primary border-b-2 border-primary bg-primary-light'
                                : 'text-n300 hover:text-n700'
                        }`}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <Wand2 className="w-4 h-4" />
                            自动分镜
                        </div>
                    </button>
                    <button
                        onClick={() => setToolType('multi_grid')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${
                            toolType === 'multi_grid'
                                ? 'text-primary border-b-2 border-primary bg-primary-light'
                                : 'text-n300 hover:text-n700'
                        }`}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <Grid3X3 className="w-4 h-4" />
                            多宫格分镜
                        </div>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1">

                    {toolType === 'panorama' && (
                        <div className="space-y-6">

                            <div className="flex items-center gap-4">
                                <div className={`flex items-center gap-2 ${panoramaStep >= 1 ? 'text-primary' : 'text-n100'}`}>
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                                        panoramaStep >= 1 ? 'bg-primary text-white' : 'bg-n0'
                                    }`}>1</div>
                                    <span>选择场景生成全景</span>
                                </div>
                                <ChevronRight className="w-5 h-5 text-n100" />
                                <div className={`flex items-center gap-2 ${panoramaStep >= 2 ? 'text-primary' : 'text-n100'}`}>
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                                        panoramaStep >= 2 ? 'bg-primary text-white' : 'bg-n0'
                                    }`}>2</div>
                                    <span>框选区域融合人物</span>
                                </div>
                            </div>

                            {panoramaStep === 1 && (
                                <div className="space-y-4">
                                    <label className="text-sm font-medium text-n700">选择场景素材</label>
                                    <div className="grid grid-cols-5 gap-3 max-h-60 overflow-y-auto p-2 bg-n30 rounded-lg">
                                        {allImages.map((img, idx) => (
                                            <div
                                                key={idx}
                                                onClick={() => !processing && setSelectedSceneImage(img)}
                                                className={`aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                                                    selectedSceneImage === img
                                                        ? 'border-primary ring-2 ring-primary/50'
                                                        : 'border-transparent hover:border-n40'
                                                }`}
                                            >
                                                <img src={img} alt={`Image ${idx}`} className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                    {selectedSceneImage && (
                                        <div className="aspect-video bg-n800 rounded-lg overflow-hidden border border-n40">
                                            <img src={selectedSceneImage} alt="Selected" className="w-full h-full object-contain" />
                                        </div>
                                    )}
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-n700">全景描述提示词（可选）</label>
                                        <input
                                            type="text"
                                            value={panorama360Prompt}
                                            onChange={(e) => setPanorama360Prompt(e.target.value)}
                                            disabled={processing}
                                            className="w-full px-4 py-2 bg-n0 border border-n40 rounded-lg text-n800 text-sm focus:outline-none focus:border-primary disabled:opacity-50"
                                            placeholder="描述全景效果，如：室内360度环绕视角..."
                                        />
                                    </div>
                                    <button
                                        onClick={handlePanorama360Generate}
                                        disabled={!selectedSceneImage || processing}
                                        className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {processing ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                生成360度全景中...
                                            </>
                                        ) : (
                                            <>
                                                <Globe className="w-5 h-5" />
                                                生成360度全景
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}

                            {panoramaStep === 2 && panorama360Result && (
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-n700">
                                            在全景图上框选融合区域
                                            <span className="text-n100 ml-2">（拖拽框选，Alt+拖拽平移）</span>
                                        </label>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handlePanoramaZoom(-0.2)}
                                                className="p-1.5 bg-n0 hover:bg-n20 rounded text-n700"
                                                title="缩小"
                                            >
                                                <ZoomOut className="w-4 h-4" />
                                            </button>
                                            <span className="text-xs text-n300 w-12 text-center">{Math.round(panoramaZoom * 100)}%</span>
                                            <button
                                                onClick={() => handlePanoramaZoom(0.2)}
                                                className="p-1.5 bg-n0 hover:bg-n20 rounded text-n700"
                                                title="放大"
                                            >
                                                <ZoomIn className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={resetPanoramaView}
                                                className="p-1.5 bg-n0 hover:bg-n20 rounded text-n700"
                                                title="重置视图"
                                            >
                                                <RotateCcw className="w-4 h-4" />
                                            </button>
                                            {cropRect && (
                                                <button
                                                    onClick={clearCropRect}
                                                    className="flex items-center gap-1 px-2 py-1 text-xs text-danger hover:text-danger hover:bg-r50 rounded transition-colors"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                    清除框选
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div
                                        ref={cropContainerRef}
                                        className="relative bg-n0 rounded-lg overflow-hidden border-2 border-n40 select-none"
                                        style={{
                                            height: '400px',
                                            cursor: isPanning ? 'grabbing' : 'crosshair'
                                        }}
                                        onMouseDown={(e) => {
                                            if (e.altKey || e.button === 1) {
                                                handlePanoramaPanStart(e);
                                            } else {
                                                handleCropMouseDown(e);
                                            }
                                        }}
                                        onMouseMove={(e) => {
                                            if (isPanning) {
                                                handlePanoramaPanMove(e);
                                            } else {
                                                handleCropMouseMove(e);
                                            }
                                        }}
                                        onMouseUp={(e) => {
                                            handlePanoramaPanEnd();
                                            handleCropMouseUp();
                                        }}
                                        onMouseLeave={() => {
                                            handlePanoramaPanEnd();
                                            handleCropMouseUp();
                                        }}
                                        onWheel={(e) => {
                                            e.preventDefault();
                                            const delta = e.deltaY > 0 ? -0.1 : 0.1;
                                            handlePanoramaZoom(delta);
                                        }}
                                        onContextMenu={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className="absolute"
                                            style={{
                                                transform: `translate(${panoramaOffset.x}px, ${panoramaOffset.y}px) scale(${panoramaZoom})`,
                                                transformOrigin: 'center center',
                                                left: '50%',
                                                top: '50%',
                                                marginLeft: panoramaImageSize.width ? -panoramaImageSize.width / 2 : 0,
                                                marginTop: panoramaImageSize.height ? -panoramaImageSize.height / 2 : 0,
                                            }}
                                        >
                                            <img
                                                ref={panoramaImageRef}
                                                src={panorama360Result}
                                                alt="Panorama"
                                                className="pointer-events-none max-w-none"
                                                style={{
                                                    width: panoramaImageSize.width || 'auto',
                                                    height: panoramaImageSize.height || 'auto',
                                                }}
                                                draggable={false}
                                            />
                                        </div>

                                        {cropRect && cropRect.width > 0 && cropRect.height > 0 && (
                                            <div
                                                className="absolute border-2 border-primary pointer-events-none"
                                                style={{
                                                    left: cropRect.x,
                                                    top: cropRect.y,
                                                    width: cropRect.width,
                                                    height: cropRect.height,
                                                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)'
                                                }}
                                            >

                                                <div className="absolute -top-1 -left-1 w-3 h-3 border-t-2 border-l-2 border-white"></div>
                                                <div className="absolute -top-1 -right-1 w-3 h-3 border-t-2 border-r-2 border-white"></div>
                                                <div className="absolute -bottom-1 -left-1 w-3 h-3 border-b-2 border-l-2 border-white"></div>
                                                <div className="absolute -bottom-1 -right-1 w-3 h-3 border-b-2 border-r-2 border-white"></div>

                                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-primary text-white text-xs rounded whitespace-nowrap">
                                                    {Math.round(cropRect.width)} × {Math.round(cropRect.height)}
                                                </div>
                                            </div>
                                        )}

                                        {!cropRect && (
                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                <div className="px-4 py-2 bg-n900/50 rounded-lg text-n700 text-sm">
                                                    点击拖拽框选 · 滚轮缩放 · Alt+拖拽平移
                                                </div>
                                            </div>
                                        )}

                                        <div className="absolute bottom-2 left-2 px-2 py-1 bg-n900/50 rounded text-xs text-n300 pointer-events-none">
                                            {panoramaImageSize.width} × {panoramaImageSize.height}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-n700">选择人物图（最多2张）</label>
                                            <div className="grid grid-cols-4 gap-2 max-h-32 overflow-y-auto p-2 bg-n30 rounded-lg">
                                                {allImages.map((img, idx) => (
                                                    <div
                                                        key={idx}
                                                        onClick={() => {
                                                            if (processing) return;
                                                            if (selectedCharacters.includes(img)) {
                                                                setSelectedCharacters(selectedCharacters.filter(c => c !== img));
                                                            } else if (selectedCharacters.length < 2) {
                                                                setSelectedCharacters([...selectedCharacters, img]);
                                                            }
                                                        }}
                                                        className={`aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                                                            selectedCharacters.includes(img)
                                                                ? 'border-b400 ring-2 ring-b400/50'
                                                                : 'border-transparent hover:border-n40'
                                                        }`}
                                                    >
                                                        <img src={img} alt={`Image ${idx}`} className="w-full h-full object-cover" />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-n700">融合提示词</label>
                                            <textarea
                                                value={fusionPrompt}
                                                onChange={(e) => setFusionPrompt(e.target.value)}
                                                disabled={processing}
                                                className="w-full h-32 px-4 py-2 bg-n0 border border-n40 rounded-lg text-n800 text-sm resize-none focus:outline-none focus:border-primary disabled:opacity-50"
                                                placeholder="描述融合效果..."
                                            />
                                        </div>
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setPanoramaStep(1)}
                                            disabled={processing}
                                            className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded-lg font-medium transition-colors disabled:opacity-50"
                                        >
                                            返回上一步
                                        </button>
                                        <button
                                            onClick={handlePanoramaFusion}
                                            disabled={!cropRect || selectedCharacters.length === 0 || processing}
                                            className="flex-1 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                        >
                                            {processing ? (
                                                <>
                                                    <Loader2 className="w-5 h-5 animate-spin" />
                                                    融合中...
                                                </>
                                            ) : (
                                                <>
                                                    <RefreshCw className="w-5 h-5" />
                                                    开始融合
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}


                    {toolType === 'auto' && (
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-n700">选择图像</label>
                                <div className="grid grid-cols-5 gap-3 max-h-48 overflow-y-auto p-2 bg-n30 rounded-lg">
                                    {allImages.map((img, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => !processing && setAutoImage(img)}
                                            className={`aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                                                autoImage === img
                                                    ? 'border-primary ring-2 ring-primary/50'
                                                    : 'border-transparent hover:border-n40'
                                            }`}
                                        >
                                            <img src={img} alt={`Image ${idx}`} className="w-full h-full object-cover" />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {autoImage && (
                                <div className="aspect-video bg-n800 rounded-lg overflow-hidden border border-n40">
                                    <img src={autoImage} alt="Selected" className="w-full h-full object-contain" />
                                </div>
                            )}

                            <div className="space-y-3">
                                <label className="text-sm font-medium text-n700">分镜描述（提示词）</label>
                                <textarea
                                    value={autoPrompt}
                                    onChange={(e) => setAutoPrompt(e.target.value)}
                                    disabled={processing}
                                    className="w-full h-32 px-4 py-3 bg-n0 border border-n40 rounded-lg text-n800 resize-none focus:outline-none focus:border-primary disabled:opacity-50"
                                    placeholder="输入分镜描述，如：角色从左侧走入画面，背景是夕阳下的城市..."
                                />
                            </div>

                            <button
                                onClick={handleAutoStoryboard}
                                disabled={!autoImage || !autoPrompt.trim() || processing}
                                className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {processing ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        生成分镜中...
                                    </>
                                ) : (
                                    <>
                                        <Wand2 className="w-5 h-5" />
                                        生成分镜
                                    </>
                                )}
                            </button>
                        </div>
                    )}


                    {toolType === 'multi_grid' && (
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <label className="text-sm font-medium text-n700">分镜模式</label>
                                <div className="grid grid-cols-2 gap-4">
                                    <button
                                        onClick={() => setMultiGridMode('multi_shot')}
                                        disabled={processing}
                                        className={`p-4 rounded-md border-2 transition-all ${
                                            multiGridMode === 'multi_shot'
                                                ? 'border-primary bg-primary-light'
                                                : 'border-n40 bg-n0 hover:border-n40'
                                        } disabled:opacity-50`}
                                    >
                                        <div className="text-left">
                                            <div className={`font-medium ${multiGridMode === 'multi_shot' ? 'text-primary' : 'text-n700'}`}>
                                                多镜头分镜
                                            </div>
                                            <div className="text-xs text-n100 mt-1">
                                                生成多个不同镜头角度的画面
                                            </div>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setMultiGridMode('story')}
                                        disabled={processing}
                                        className={`p-4 rounded-md border-2 transition-all ${
                                            multiGridMode === 'story'
                                                ? 'border-primary bg-primary-light'
                                                : 'border-n40 bg-n0 hover:border-n40'
                                        } disabled:opacity-50`}
                                    >
                                        <div className="text-left">
                                            <div className={`font-medium ${multiGridMode === 'story' ? 'text-primary' : 'text-n700'}`}>
                                                故事分镜
                                            </div>
                                            <div className="text-xs text-n100 mt-1">
                                                生成故事情节的连续分镜
                                            </div>
                                        </div>
                                    </button>
                                </div>
                            </div>


                            <div className="space-y-3">
                                <label className="text-sm font-medium text-n700">
                                    选择参考图像 <span className="text-danger">*</span>
                                    <span className="text-n100 ml-2">（必须选择一张）</span>
                                </label>
                                <div className="grid grid-cols-6 gap-2 max-h-40 overflow-y-auto p-2 bg-n30 rounded-lg">
                                    {allImages.length > 0 ? allImages.map((img, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => !processing && setMultiGridImage(img)}
                                            className={`aspect-square rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${
                                                multiGridImage === img
                                                    ? 'border-primary ring-2 ring-primary/50'
                                                    : 'border-transparent hover:border-n40'
                                            }`}
                                        >
                                            <img src={img} alt={`Image ${idx}`} className="w-full h-full object-cover" />
                                        </div>
                                    )) : (
                                        <div className="col-span-6 py-8 text-center text-n100">
                                            暂无可用图片，请先生成或上传图片
                                        </div>
                                    )}
                                </div>
                                {multiGridImage && (
                                    <div className="flex items-center gap-2 text-sm text-success">
                                        <span>✓</span>
                                        <span>已选择参考图像</span>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3">
                                <label className="text-sm font-medium text-n700">输入提示词</label>
                                <textarea
                                    value={multiGridPrompt}
                                    onChange={(e) => setMultiGridPrompt(e.target.value)}
                                    disabled={processing}
                                    className="w-full h-24 px-4 py-3 bg-n0 border border-n40 rounded-lg text-n800 resize-none focus:outline-none focus:border-primary disabled:opacity-50"
                                    placeholder={multiGridMode === 'multi_shot'
                                        ? "输入场景描述，如：一个武侠高手站在山顶..."
                                        : "输入故事描述，如：一个少年踏上修仙之路的故事..."
                                    }
                                />
                                <div className="text-xs text-n100">
                                    {multiGridMode === 'multi_shot'
                                        ? '后台将自动拼合："{您的输入}+AI+分镜"'
                                        : '后台将自动拼合："{您的输入}+AI+分镜1"'
                                    }
                                </div>
                            </div>

                            <button
                                onClick={handleMultiGridGenerate}
                                disabled={!multiGridPrompt.trim() || !multiGridImage || processing}
                                className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                {processing ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        生成中...
                                    </>
                                ) : (
                                    <>
                                        <Grid3X3 className="w-5 h-5" />
                                        生成{multiGridMode === 'multi_shot' ? '多镜头' : '故事'}分镜
                                    </>
                                )}
                            </button>


                            {multiGridResults.length > 0 && (
                                <div className="space-y-3">
                                    <label className="text-sm font-medium text-n700">生成结果</label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {multiGridResults.map((img, idx) => (
                                            <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-n40">
                                                <img src={img} alt={`Result ${idx}`} className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>


                {toolType !== 'multi_grid' && (
                    <div className="px-6 py-4 border-t border-n40 flex-shrink-0">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-n700">种子值</label>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 text-sm text-n300 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={useRandomSeed}
                                        onChange={(e) => setUseRandomSeed(e.target.checked)}
                                        disabled={processing}
                                        className="rounded border-n40 bg-n0 text-primary focus:ring-primary"
                                    />
                                    随机
                                </label>
                                {!useRandomSeed && (
                                    <input
                                        type="number"
                                        value={seed}
                                        onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                                        disabled={processing}
                                        className="w-32 px-3 py-1 bg-n0 border border-n40 rounded-lg text-n800 text-sm focus:outline-none focus:border-primary disabled:opacity-50"
                                        placeholder="种子值"
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="flex justify-end px-6 py-4 border-t border-n40 flex-shrink-0">
                    <button
                        onClick={onClose}
                        disabled={processing}
                        className="px-6 py-2 bg-n0 hover:bg-n20 text-n700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StoryboardToolModal;
