
// ... existing imports
import { ImageSourceBadgeOverlay } from '@app/components/SeedreamSourceBadge';
import { AppNode, NodeStatus, NodeType } from '../types';
import { RefreshCw, Play, Image as ImageIcon, Video as VideoIcon, Type, AlertCircle, CheckCircle, Plus, Maximize2, Download, MoreHorizontal, Wand2, Scaling, FileSearch, Edit, Loader2, Layers, Trash2, X, Upload, Scissors, Film, MousePointerClick, Crop as CropIcon, ChevronDown, ChevronUp, GripHorizontal, Link, Copy, Monitor, Music, Pause, Volume2, Mic2, Coins } from 'lucide-react';
import { VideoModeSelector, SceneDirectorOverlay } from './VideoNodeModules';
import React, { memo, useRef, useState, useEffect, useCallback } from 'react';
import { useStudioRuntime } from '../services/runtime';
import {
    STUDIO_AUDIO_MODEL_OPTIONS,
    STUDIO_IMAGE_MODEL_OPTIONS,
    STUDIO_TEXT_MODEL_OPTIONS,
    getStudioVideoModelUnavailableReason,
    getStudioVideoModelOptions,
    normalizeStudioAudioModel,
    normalizeStudioImageModel,
    normalizeStudioTextModel,
    normalizeStudioVideoModel,
} from '../services/modelOptions';
import { MINIMAX_HAILUO_LIMIT_EVENT, isComfyUIModel, type VideoModel } from '@app/services/videoModelService';
import { ModelPicker, type ModelPickerOption } from '@app/components/ModelPicker';
import {
    buildStudioNodeCreditRequest,
    summarizeStudioCreditQuote,
    type StudioCreditQuote,
} from '../services/creditPolicy';


interface InputAsset {
    id: string;
    type: 'image' | 'video';
    src: string;
}

interface NodeProps {
  node: AppNode;
  onUpdate: (id: string, data: Partial<AppNode['data']>, size?: { width?: number, height?: number }, title?: string) => void;
  onAction: (id: string, prompt?: string) => void;
  onDelete: (id: string) => void;
  onExpand?: (data: { type: 'image' | 'video', src: string, rect: DOMRect, images?: string[], initialIndex?: number }) => void;
  onCrop?: (id: string, imageBase64: string) => void;
  onNodeMouseDown: (e: React.MouseEvent, id: string) => void;
  onPortMouseDown: (e: React.MouseEvent, id: string, type: 'input' | 'output') => void;
  onPortMouseUp: (e: React.MouseEvent, id: string, type: 'input' | 'output') => void;
  onNodeContextMenu: (e: React.MouseEvent, id: string) => void;
  onMediaContextMenu?: (e: React.MouseEvent, nodeId: string, type: 'image' | 'video', src: string) => void;
  onResizeMouseDown: (e: React.MouseEvent, id: string, initialWidth: number, initialHeight: number) => void;
  inputAssets?: InputAsset[];
  onInputReorder?: (nodeId: string, newOrder: string[]) => void;

  isDragging?: boolean;
  isGroupDragging?: boolean;
  isSelected?: boolean;
  isResizing?: boolean;
  isConnecting?: boolean;
}

const IMAGE_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'];
const VIDEO_ASPECT_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'];
const IMAGE_RESOLUTIONS = ['1k', '2k', '4k'];
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'];
const IMAGE_COUNTS = [1, 2, 3, 4];
const VIDEO_COUNTS = [1, 2, 3, 4];
const GLASS_PANEL = "studio-node-control-panel";
const DEFAULT_NODE_WIDTH = 420;
const DEFAULT_FIXED_HEIGHT = 360;
const AUDIO_NODE_HEIGHT = 200;

// Fetches video as blob to bypass auth/cors issues with <video src>
const SecureVideo = ({ src, className, autoPlay, muted, loop, onMouseEnter, onMouseLeave, onClick, controls, videoRef, style }: any) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!src) return;
        if (src.startsWith('data:') || src.startsWith('blob:')) {
            setBlobUrl(src);
            return;
        }

        let active = true;
        // Fetch the video content
        fetch(src)
            .then(response => {
                if (!response.ok) throw new Error("Video fetch failed");
                return response.blob();
            })
            .then(blob => {
                if (active) {
                    // FORCE MIME TYPE TO VIDEO/MP4 to fix black screen issues with generic binary blobs
                    const mp4Blob = new Blob([blob], { type: 'video/mp4' });
                    const url = URL.createObjectURL(mp4Blob);
                    setBlobUrl(url);
                }
            })
            .catch(err => {
                console.error("SecureVideo load error:", err);
                if (active) setError(true);
            });

        return () => {
            active = false;
            if (blobUrl && !blobUrl.startsWith('data:')) {
                URL.revokeObjectURL(blobUrl);
            }
        };
    }, [src]);

    if (error) {
        return <div className={`studio-node-media-object flex items-center justify-center text-xs text-red-400 ${className}`}>Load Error</div>;
    }

    if (!blobUrl) {
        return <div className={`studio-node-media-object flex items-center justify-center ${className}`}><Loader2 className="animate-spin text-zinc-600" /></div>;
    }

    return (
        <video
            ref={videoRef}
            src={blobUrl}
            className={className}
            autoPlay={autoPlay}
            muted={muted}
            loop={loop}
            controls={controls}
            playsInline
            preload="auto"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            style={{ backgroundColor: 'var(--studio-node-media-bg)', ...style }} // Force background and apply passed styles
        />
    );
};

// Helper for safe video playback
const safePlay = (e: React.SyntheticEvent<HTMLVideoElement> | HTMLVideoElement) => {
    const vid = (e as any).currentTarget || e;
    if (!vid) return;
    const p = vid.play();
    if (p !== undefined) {
        p.catch((error: any) => {
            // Ignore AbortError which happens when pausing immediately after playing
            if (error.name !== 'AbortError') {
                console.debug("Video play prevented:", error);
            }
        });
    }
};

const safePause = (e: React.SyntheticEvent<HTMLVideoElement> | HTMLVideoElement) => {
    const vid = (e as any).currentTarget || e;
    if (vid) {
        vid.pause();
        vid.currentTime = 0; // Optional: reset to start
    }
};

// Custom Comparator for React.memo to prevent unnecessary re-renders during drag
const arePropsEqual = (prev: NodeProps, next: NodeProps) => {
    if (prev.isDragging !== next.isDragging ||
        prev.isResizing !== next.isResizing ||
        prev.isSelected !== next.isSelected ||
        prev.isGroupDragging !== next.isGroupDragging ||
        prev.isConnecting !== next.isConnecting) {
        return false;
    }
    if (prev.node !== next.node) return false;
    const prevInputs = prev.inputAssets || [];
    const nextInputs = next.inputAssets || [];
    if (prevInputs.length !== nextInputs.length) return false;
    for(let i = 0; i < prevInputs.length; i++) {
        if (prevInputs[i].id !== nextInputs[i].id || prevInputs[i].src !== nextInputs[i].src) return false;
    }
    return true;
};

const InputThumbnails = ({ assets, onReorder }: { assets: InputAsset[], onReorder: (newOrder: string[]) => void }) => {
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOffset, setDragOffset] = useState(0);
    const onReorderRef = useRef(onReorder);
    onReorderRef.current = onReorder;
    const stateRef = useRef({ draggingId: null as string | null, startX: 0, originalAssets: [] as InputAsset[] });
    const THUMB_WIDTH = 48;
    const GAP = 6;
    const ITEM_FULL_WIDTH = THUMB_WIDTH + GAP;

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!stateRef.current.draggingId) return;
        const delta = e.clientX - stateRef.current.startX;
        setDragOffset(delta);
    }, []);

    const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
        if (!stateRef.current.draggingId) return;
        const { draggingId, startX, originalAssets } = stateRef.current;
        const currentOffset = e.clientX - startX;
        const moveSlots = Math.round(currentOffset / ITEM_FULL_WIDTH);
        const currentIndex = originalAssets.findIndex(a => a.id === draggingId);
        const newIndex = Math.max(0, Math.min(originalAssets.length - 1, currentIndex + moveSlots));

        if (newIndex !== currentIndex) {
            const newOrderIds = originalAssets.map(a => a.id);
            const [moved] = newOrderIds.splice(currentIndex, 1);
            newOrderIds.splice(newIndex, 0, moved);
            onReorderRef.current(newOrderIds);
        }
        setDraggingId(null);
        setDragOffset(0);
        stateRef.current.draggingId = null;
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, [ITEM_FULL_WIDTH]);

    useEffect(() => {
        return () => {
            document.body.style.cursor = '';
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        }
    }, [handleGlobalMouseMove, handleGlobalMouseUp]);

    const handleMouseDown = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        e.preventDefault();
        setDraggingId(id);
        setDragOffset(0);
        stateRef.current = { draggingId: id, startX: e.clientX, originalAssets: [...assets] };
        document.body.style.cursor = 'grabbing';
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);
    };

    if (!assets || assets.length === 0) return null;

    return (
        <div className="flex items-center justify-center h-14 pointer-events-none select-none relative z-0" onMouseDown={e => e.stopPropagation()}>
            <div className="relative flex items-center gap-[6px]">
                {assets.map((asset, index) => {
                    const isItemDragging = asset.id === draggingId;
                    const originalIndex = assets.findIndex(a => a.id === draggingId);
                    let translateX = 0;
                    let scale = 1;
                    let zIndex = 10;

                    if (isItemDragging) {
                        translateX = dragOffset;
                        scale = 1.15;
                        zIndex = 100;
                    } else if (draggingId) {
                        const draggingVirtualIndex = Math.max(0, Math.min(assets.length - 1, originalIndex + Math.round(dragOffset / ITEM_FULL_WIDTH)));
                        if (index > originalIndex && index <= draggingVirtualIndex) translateX = -ITEM_FULL_WIDTH;
                        else if (index < originalIndex && index >= draggingVirtualIndex) translateX = ITEM_FULL_WIDTH;
                    }
                    const isVideo = asset.type === 'video';
                    return (
                        <div
                            key={asset.id}
                            className={`studio-node-thumbnail relative rounded-md overflow-hidden cursor-grab active:cursor-grabbing pointer-events-auto border shadow-lg group`}
                            style={{
                                width: `${THUMB_WIDTH}px`, height: `${THUMB_WIDTH}px`,
                                transform: `translateX(${translateX}px) scale(${scale})`,
                                zIndex,
                                transition: isItemDragging ? 'none' : 'transform 0.5s cubic-bezier(0.32,0.72,0,1)',
                            }}
                            onMouseDown={(e) => handleMouseDown(e, asset.id)}
                        >
                            {isVideo ? (
                                <SecureVideo src={asset.src} className="studio-node-media-object w-full h-full object-cover pointer-events-none select-none opacity-80 group-hover:opacity-100 transition-opacity" muted loop autoPlay />
                            ) : (
                                <img src={asset.src} className="studio-node-media-object w-full h-full object-cover pointer-events-none select-none opacity-80 group-hover:opacity-100 transition-opacity" alt="" />
                            )}
                            {!isVideo && <ImageSourceBadgeOverlay reference={asset.src} scope="studio" />}
                            <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-md"></div>
                            <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 bg-black/60 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 z-20 shadow-sm pointer-events-none">
                                <span className="text-[9px] font-bold text-white leading-none">{index + 1}</span>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
};

const AudioVisualizer = ({ isPlaying }: { isPlaying: boolean }) => (
    <div className="flex items-center justify-center gap-[2px] h-12 w-full opacity-60">
        {[...Array(20)].map((_, i) => (
            <div key={i} className="w-1 bg-cyan-400/80 rounded-full" style={{ height: isPlaying ? `${20 + Math.random() * 80}%` : '20%', transition: 'height 0.1s ease', animation: isPlaying ? `pulse 0.5s infinite ${i * 0.05}s` : 'none' }} />
        ))}
    </div>
);

const NodeComponent: React.FC<NodeProps> = ({
  node, onUpdate, onAction, onDelete, onExpand, onCrop, onNodeMouseDown, onPortMouseDown, onPortMouseUp, onNodeContextMenu, onMediaContextMenu, onResizeMouseDown, inputAssets, onInputReorder, isDragging, isGroupDragging, isSelected, isResizing, isConnecting
}) => {
  const runtime = useStudioRuntime();
  const isWorking = node.status === NodeStatus.WORKING;
  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | HTMLAudioElement | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const isHoveringRef = useRef(false);
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [showImageGrid, setShowImageGrid] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(node.title);
  const [isHovered, setIsHovered] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const generationMode = node.data.generationMode || 'CONTINUE';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localPrompt, setLocalPrompt] = useState(node.data.prompt || '');
  const [inputHeight, setInputHeight] = useState(48);
  const [creditQuote, setCreditQuote] = useState<StudioCreditQuote | null>(null);
  const [, setVideoModelLimitRevision] = useState(0);
  const [isCreditLoading, setIsCreditLoading] = useState(false);
  const isResizingInput = useRef(false);
  const inputStartDragY = useRef(0);
  const inputStartHeight = useRef(0);

  useEffect(() => { setLocalPrompt(node.data.prompt || ''); }, [node.data.prompt]);
  useEffect(() => {
    const refresh = () => {
      setVideoModelLimitRevision(value => value + 1);
    };
    window.addEventListener(MINIMAX_HAILUO_LIMIT_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(MINIMAX_HAILUO_LIMIT_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const creditRequest = buildStudioNodeCreditRequest(node, localPrompt);
  const creditRequestKey = creditRequest ? JSON.stringify(creditRequest) : '';
  const creditSummary = creditRequest ? summarizeStudioCreditQuote(creditRequest, creditQuote) : null;
  const creditInsufficient = Boolean(creditSummary?.enabled && !creditSummary.enough);

  useEffect(() => {
      if ((!isHovered && !isInputFocused) || !creditRequest) return;
      let active = true;
      setIsCreditLoading(true);
      const timer = window.setTimeout(() => {
          runtime.estimateCredits(creditRequest.featureKey, creditRequest.params)
              .then(quote => { if (active) setCreditQuote(quote); })
              .catch(error => {
                  console.warn('[studio] failed to estimate node credits', error);
                  if (active) setCreditQuote(null);
              })
              .finally(() => { if (active) setIsCreditLoading(false); });
      }, 120);
      return () => {
          active = false;
          window.clearTimeout(timer);
      };
  }, [creditRequestKey, isHovered, isInputFocused, runtime]);

  const commitPrompt = () => { if (localPrompt !== (node.data.prompt || '')) onUpdate(node.id, { prompt: localPrompt }); };
  const handleActionClick = () => { if (creditInsufficient) return; commitPrompt(); onAction(node.id, localPrompt); };
  const handleCmdEnter = (e: React.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (creditInsufficient) return; commitPrompt(); onAction(node.id, localPrompt); }};

  const handleInputResizeStart = (e: React.MouseEvent) => {
      e.stopPropagation(); e.preventDefault();
      isResizingInput.current = true; inputStartDragY.current = e.clientY; inputStartHeight.current = inputHeight;
      const handleGlobalMouseMove = (e: MouseEvent) => {
          if (!isResizingInput.current) return;
          setInputHeight(Math.max(48, Math.min(inputStartHeight.current + (e.clientY - inputStartDragY.current), 300)));
      };
      const handleGlobalMouseUp = () => { isResizingInput.current = false; window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp); };
      window.addEventListener('mousemove', handleGlobalMouseMove); window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  React.useEffect(() => {
      if (videoBlobUrl) { URL.revokeObjectURL(videoBlobUrl); setVideoBlobUrl(null); }
      if ((node.type === NodeType.VIDEO_GENERATOR || node.type === NodeType.VIDEO_ANALYZER) && node.data.videoUri) {
          if (node.data.videoUri.startsWith('data:')) { setVideoBlobUrl(node.data.videoUri); return; }
          let isActive = true; setIsLoadingVideo(true);
          fetch(node.data.videoUri).then(res => res.blob()).then(blob => {
              if (isActive) {
                  // Force video/mp4 for local analysis blob too
                  const mp4Blob = new Blob([blob], { type: 'video/mp4' });
                  setVideoBlobUrl(URL.createObjectURL(mp4Blob));
                  setIsLoadingVideo(false);
              }
          }).catch(err => { if (isActive) setIsLoadingVideo(false); });
          return () => { isActive = false; if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl); };
      }
  }, [node.data.videoUri, node.type]);

  const toggleAudio = (e: React.MouseEvent) => {
      e.stopPropagation();
      const audio = mediaRef.current as HTMLAudioElement;
      if (!audio) return;
      if (audio.paused) { audio.play(); setIsPlayingAudio(true); } else { audio.pause(); setIsPlayingAudio(false); }
  };

  useEffect(() => {
    return () => {
        if (mediaRef.current && (mediaRef.current instanceof HTMLVideoElement || mediaRef.current instanceof HTMLAudioElement)) {
            try { mediaRef.current.pause(); mediaRef.current.src = ""; mediaRef.current.load(); } catch (e) {}
        }
    }
  }, []);

  const handleMouseEnter = () => {
    isHoveringRef.current = true;
    if((node.data.images?.length || 0) > 1 || (node.data.videoUris?.length || 0) > 1) setShowImageGrid(true);

    if (mediaRef.current instanceof HTMLVideoElement) {
        safePlay(mediaRef.current);
    }
  };

  const handleMouseLeave = () => {
    isHoveringRef.current = false;
    setShowImageGrid(false);

    if (mediaRef.current instanceof HTMLVideoElement) {
        safePause(mediaRef.current);
    }
  };

  const handleExpand = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onExpand && mediaRef.current) {
          const rect = mediaRef.current.getBoundingClientRect();
          if (node.type.includes('IMAGE') && node.data.image) {
              onExpand({ type: 'image', src: node.data.image, rect, images: node.data.images || [node.data.image], initialIndex: (node.data.images || [node.data.image]).indexOf(node.data.image) });
          } else if (node.type.includes('VIDEO') && node.data.videoUri) {
              const src = node.data.videoUri;
              const videos = node.data.videoUris && node.data.videoUris.length > 0 ? node.data.videoUris : [src];
              const currentIndex = node.data.videoUris ? node.data.videoUris.indexOf(node.data.videoUri) : 0;
              const safeIndex = currentIndex >= 0 ? currentIndex : 0;
              // ExpandedView applies authenticated media loading.
              onExpand({ type: 'video', src: src, rect, images: videos, initialIndex: safeIndex });
          }
      }
  };
  const handleDownload = (e: React.MouseEvent) => { e.stopPropagation(); const a = document.createElement('a'); a.href = node.data.image || videoBlobUrl || node.data.audioUri || ''; a.download = `sunstudio-${Date.now()}`; document.body.appendChild(a); a.click(); document.body.removeChild(a); };
  const handleUploadVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void runtime.uploadAsset(file, node.id)
      .then(videoUri => onUpdate(node.id, { videoUri }))
      .catch(error => onUpdate(node.id, { error: error instanceof Error ? error.message : '视频上传失败' }));
  };
  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void runtime.uploadAsset(file, node.id)
      .then(image => onUpdate(node.id, { image }))
      .catch(error => onUpdate(node.id, { error: error instanceof Error ? error.message : '图片上传失败' }));
  };
  const handleAspectRatioSelect = (newRatio: string) => {
    const [w, h] = newRatio.split(':').map(Number);
    let newSize: { width?: number, height?: number } = { height: undefined };
    if (w && h) {
        const currentWidth = node.width || DEFAULT_NODE_WIDTH;
        const projectedHeight = (currentWidth * h) / w;
        if (projectedHeight > 600) newSize.width = (600 * w) / h;
    }
    onUpdate(node.id, { aspectRatio: newRatio }, newSize);
  };
  const handleTitleSave = () => { setIsEditingTitle(false); if (tempTitle.trim() && tempTitle !== node.title) onUpdate(node.id, {}, undefined, tempTitle); else setTempTitle(node.title); };

  const getNodeConfig = () => {
      switch (node.type) {
        case NodeType.PROMPT_INPUT: return { icon: Type, color: 'text-amber-400', border: 'border-amber-500/30' };
        case NodeType.IMAGE_GENERATOR: return { icon: ImageIcon, color: 'text-cyan-400', border: 'border-cyan-500/30' };
        case NodeType.VIDEO_GENERATOR: return { icon: VideoIcon, color: 'text-purple-400', border: 'border-purple-500/30' };
        case NodeType.AUDIO_GENERATOR: return { icon: Mic2, color: 'text-pink-400', border: 'border-pink-500/30' };
        case NodeType.VIDEO_ANALYZER: return { icon: FileSearch, color: 'text-emerald-400', border: 'border-emerald-500/30' };
        case NodeType.IMAGE_EDITOR: return { icon: Edit, color: 'text-rose-400', border: 'border-rose-500/30' };
        default: return { icon: Type, color: 'text-slate-400', border: 'border-white/10' };
      }
  };
  const { icon: NodeIcon, color: iconColor } = getNodeConfig();

  const getNodeHeight = () => {
      if (node.height) return node.height;
      if (node.type === NodeType.VIDEO_ANALYZER || node.type === NodeType.IMAGE_EDITOR || node.type === NodeType.PROMPT_INPUT) return DEFAULT_FIXED_HEIGHT;
      if (node.type === NodeType.AUDIO_GENERATOR) return AUDIO_NODE_HEIGHT;
      const ratio = node.data.aspectRatio || '16:9';
      const [w, h] = ratio.split(':').map(Number);
      const extra = (node.type === NodeType.VIDEO_GENERATOR && generationMode === 'CUT') ? 36 : 0;
      return ((node.width || DEFAULT_NODE_WIDTH) * h / w) + extra;
  };
  const nodeHeight = getNodeHeight();
  const nodeWidth = node.width || DEFAULT_NODE_WIDTH;
  const hasInputs = inputAssets && inputAssets.length > 0;

  const renderTopBar = () => {
    const showTopBar = isSelected || isHovered;
    const titleControl = (
      <div className="flex shrink-0 items-center gap-2 px-2 py-1 pointer-events-auto">
        {isWorking && <div className="studio-node-icon-button backdrop-blur-md p-1.5 rounded-full"><Loader2 className="animate-spin w-3 h-3 text-cyan-400" /></div>}
        {isEditingTitle ? (
          <input className="studio-node-title bg-transparent border-none outline-none text-xs font-bold uppercase tracking-wider w-28 text-right whitespace-nowrap" value={tempTitle} onChange={(e) => setTempTitle(e.target.value)} onBlur={handleTitleSave} onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()} onMouseDown={e => e.stopPropagation()} autoFocus />
        ) : (
          <span className="studio-node-title text-xs font-bold uppercase tracking-wider cursor-text text-right whitespace-nowrap" onClick={() => setIsEditingTitle(true)}>{node.title}</span>
        )}
      </div>
    );
    const mediaActions = (node.data.image || node.data.videoUri || node.data.audioUri) && (
      <div className="flex shrink-0 items-center gap-1 pointer-events-auto">
        <button onClick={handleDownload} className="studio-node-icon-button p-1.5 backdrop-blur-md rounded-md transition-colors" title="下载"><Download size={14} /></button>
        {node.type !== NodeType.AUDIO_GENERATOR && <button onClick={handleExpand} className="studio-node-icon-button p-1.5 backdrop-blur-md rounded-md transition-colors" title="全屏预览"><Maximize2 size={14} /></button>}
      </div>
    );

    if (node.type === NodeType.VIDEO_GENERATOR) {
      return (
        <div className={`absolute -top-[72px] left-0 w-full flex flex-col gap-1 px-1 transition-opacity duration-200 ${showTopBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="flex min-h-7 items-center justify-between">
            {mediaActions || <div />}
            {titleControl}
          </div>
          <div className="studio-node-mode-strip w-full overflow-x-auto pointer-events-auto">
            <VideoModeSelector currentMode={generationMode} onSelect={(mode) => onUpdate(node.id, { generationMode: mode })} />
          </div>
        </div>
      );
    }

    return (
    <div className={`absolute -top-10 left-0 w-full flex items-center justify-between px-1 transition-opacity duration-200 ${showTopBar ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {mediaActions || <div />}
        {titleControl}
    </div>
    );
  };

  const renderMediaContent = () => {
      if (node.type === NodeType.PROMPT_INPUT) {
          return (
            <div className="w-full h-full p-6 flex flex-col group/text">
                <div className="studio-node-inner-box flex-1 rounded-2xl p-4 relative overflow-hidden transition-colors">
                    <textarea className="studio-node-textarea w-full h-full bg-transparent resize-none focus:outline-none text-sm font-medium leading-relaxed custom-scrollbar selection:bg-amber-500/30" placeholder={node.title.includes('剧本') ? '输入场景、人物、动作和台词…' : '输入您的创意构想...'} value={localPrompt} onChange={(e) => setLocalPrompt(e.target.value)} onBlur={commitPrompt} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commitPrompt(); } }} onWheel={(e) => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} maxLength={6000} />
                </div>
            </div>
          );
      }
      if (node.type === NodeType.VIDEO_ANALYZER) {
          return (
            <div className="w-full h-full p-5 flex flex-col gap-3">
                 <div className="studio-node-upload-box relative w-full h-32 rounded-xl overflow-hidden flex items-center justify-center cursor-pointer transition-colors group/upload" onClick={() => !node.data.videoUri && fileInputRef.current?.click()}>
                    {videoBlobUrl ? <video src={videoBlobUrl} className="studio-node-media-object w-full h-full object-cover opacity-80" muted onMouseEnter={safePlay} onMouseLeave={safePause} onClick={handleExpand} /> : <div className="studio-node-muted flex flex-col items-center gap-2"><Upload size={20} /><span className="text-[10px] font-bold uppercase tracking-wider">上传视频</span></div>}
                    {node.data.videoUri && <button className="studio-node-icon-button absolute top-2 right-2 p-1 rounded-full backdrop-blur-md" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}><Edit size={10} /></button>}
                    <input type="file" ref={fileInputRef} className="hidden" accept="video/*" onChange={handleUploadVideo} />
                 </div>
                 <div className="studio-node-inner-box flex-1 rounded-xl overflow-hidden relative group/analysis">
                    <textarea className="studio-node-textarea w-full h-full bg-transparent p-3 resize-none focus:outline-none text-xs font-mono leading-relaxed custom-scrollbar select-text placeholder:italic" value={node.data.analysis || ''} placeholder="等待分析结果，或在此粘贴文本..." onChange={(e) => onUpdate(node.id, { analysis: e.target.value })} onWheel={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} spellCheck={false} />
                    {node.data.analysis && <button className="studio-node-icon-button absolute top-2 right-2 p-1.5 rounded-md transition-all opacity-0 group-hover/analysis:opacity-100 backdrop-blur-md z-10" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(node.data.analysis || ''); }} title="复制全部"><Copy size={12} /></button>}
                 </div>
                 {isWorking && <div className="studio-node-error-overlay absolute inset-0 flex items-center justify-center backdrop-blur-sm z-10"><Loader2 className="animate-spin text-emerald-400" /></div>}
            </div>
          )
      }
      if (node.type === NodeType.AUDIO_GENERATOR) {
          return (
              <div className="w-full h-full p-6 flex flex-col justify-center items-center relative overflow-hidden group/audio">
                  <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 to-purple-900/10 z-0"></div>
                  {node.data.audioUri ? (
                      <div className="flex flex-col items-center gap-4 w-full z-10">
                          <audio ref={mediaRef as any} src={node.data.audioUri} onEnded={() => setIsPlayingAudio(false)} onPlay={() => setIsPlayingAudio(true)} onPause={() => setIsPlayingAudio(false)} className="hidden" />
                          <div className="w-full px-4"><AudioVisualizer isPlaying={isPlayingAudio} /></div>
                          <div className="flex items-center gap-4"><button onClick={toggleAudio} className="w-12 h-12 rounded-full bg-cyan-500/20 hover:bg-cyan-500/40 border border-cyan-500/50 flex items-center justify-center transition-all hover:scale-105">{isPlayingAudio ? <Pause size={20} className="text-white" /> : <Play size={20} className="text-white ml-1" />}</button></div>
                      </div>
                  ) : (
                      <div className="studio-node-muted flex flex-col items-center gap-3 z-10 select-none">{isWorking ? <Loader2 size={32} className="animate-spin text-pink-500" /> : <Mic2 size={32} />}<span className="text-[10px] font-bold uppercase tracking-widest">{isWorking ? '生成中...' : '准备生成'}</span></div>
                  )}
                  {node.status === NodeStatus.ERROR && <div className="studio-node-error-overlay absolute inset-0 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20"><AlertCircle className="text-red-500 mb-2" /><span className="text-xs text-red-400">{node.data.error}</span></div>}
              </div>
          )
      }

      const hasContent = node.data.image || node.data.videoUri;
      return (
        <div className="studio-node-media-frame w-full h-full relative group/media overflow-hidden" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
            {!hasContent ? (
                <div className="studio-node-faint absolute inset-0 flex flex-col items-center justify-center gap-3"><div className="studio-node-upload-tile w-20 h-20 rounded-[28px] flex items-center justify-center cursor-pointer hover:scale-105 transition-all duration-300 shadow-inner" onClick={() => fileInputRef.current?.click()}>{isWorking ? <Loader2 className="animate-spin text-cyan-500" size={32} /> : <NodeIcon size={32} className="opacity-50" />}</div><span className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-70">{isWorking ? "处理中..." : "拖拽或上传"}</span><input type="file" ref={fileInputRef} className="hidden" accept={node.type.includes('VIDEO') ? "video/*" : "image/*"} onChange={node.type.includes('VIDEO') ? handleUploadVideo : handleUploadImage} /></div>
            ) : (
                <>
                    {node.data.image ?
                        <img ref={mediaRef as any} src={node.data.image} className="studio-node-media-object w-full h-full object-cover transition-transform duration-700 group-hover/media:scale-105" draggable={false} style={{ filter: showImageGrid ? 'blur(10px)' : 'none' }} onContextMenu={(e) => onMediaContextMenu?.(e, node.id, 'image', node.data.image!)} />
                    :
                        <SecureVideo
                            videoRef={mediaRef} // Pass Ref to Video
                            src={node.data.videoUri}
                            className="studio-node-media-object w-full h-full object-cover"
                            loop
                            muted
                            onContextMenu={(e: React.MouseEvent) => onMediaContextMenu?.(e, node.id, 'video', node.data.videoUri!)}
                            style={{ filter: showImageGrid ? 'blur(10px)' : 'none' }} // Pass Style
                        />
                    }
                    {node.status === NodeStatus.ERROR && <div className="studio-node-error-overlay absolute inset-0 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20"><AlertCircle className="text-red-500 mb-2" /><span className="text-xs text-red-400">{node.data.error}</span></div>}
                    {node.data.image && !showImageGrid && <ImageSourceBadgeOverlay reference={node.data.image} scope="studio" />}
                    {showImageGrid && (node.data.images || node.data.videoUris) && (
                        <div className="studio-node-media-chooser absolute inset-0 z-10 grid grid-cols-2 gap-2 p-2 animate-in fade-in duration-200">
                            {node.data.images ? node.data.images.map((img, idx) => (
                                <div key={idx} className={`studio-node-thumbnail relative rounded-lg overflow-hidden cursor-pointer border-2 ${img === node.data.image ? 'border-cyan-500' : 'border-transparent hover:border-cyan-500/40'}`} onClick={(e) => { e.stopPropagation(); onUpdate(node.id, { image: img }); }}>
                                    <img src={img} className="w-full h-full object-cover" />
                                    <ImageSourceBadgeOverlay reference={img} scope="studio" />
                                </div>
                            )) : node.data.videoUris?.map((uri, idx) => (
                                <div key={idx} className={`studio-node-thumbnail relative rounded-lg overflow-hidden cursor-pointer border-2 ${uri === node.data.videoUri ? 'border-cyan-500' : 'border-transparent hover:border-cyan-500/40'}`} onClick={(e) => { e.stopPropagation(); onUpdate(node.id, { videoUri: uri }); }}>
                                    {uri ? (
                                        <SecureVideo src={uri} className="studio-node-media-object w-full h-full object-cover" muted loop autoPlay />
                                    ) : (
                                        <div className="studio-node-upload-tile w-full h-full flex items-center justify-center text-xs">Failed</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {generationMode === 'CUT' && node.data.croppedFrame && <div className="studio-node-cut-preview absolute top-4 right-4 w-24 aspect-video rounded-lg border border-purple-500/50 shadow-xl overflow-hidden z-20 hover:scale-150 transition-transform origin-top-right opacity-0 group-hover:opacity-100 transition-opacity duration-300"><img src={node.data.croppedFrame} className="w-full h-full object-cover" /></div>}
                    {generationMode === 'CUT' && !node.data.croppedFrame && hasInputs && inputAssets?.some(a => a.src) && (<div className="studio-node-cut-preview absolute top-4 right-4 w-24 aspect-video rounded-lg border border-purple-500/30 border-dashed shadow-xl overflow-hidden z-20 hover:scale-150 transition-transform origin-top-right flex flex-col items-center justify-center group/preview opacity-0 group-hover:opacity-100 transition-opacity duration-300"><div className="absolute inset-0 bg-purple-500/10 z-10"></div>{(() => { const asset = inputAssets!.find(a => a.src); if (asset?.type === 'video') { return <SecureVideo src={asset.src} className="studio-node-media-object w-full h-full object-cover opacity-60" muted autoPlay />; } else { return <img src={asset?.src} className="studio-node-media-object w-full h-full object-cover opacity-60" />; } })()}<span className="absolute z-20 text-[8px] font-bold text-purple-200 bg-black/50 px-1 rounded">分镜参考</span></div>)}
                </>
            )}
            {node.type === NodeType.VIDEO_GENERATOR && generationMode === 'CUT' && (videoBlobUrl || node.data.videoUri) &&
                <SceneDirectorOverlay
                    visible={true}
                    videoRef={mediaRef as React.RefObject<HTMLVideoElement>}
                    onCrop={() => {
                        const vid = mediaRef.current as HTMLVideoElement;
                        if (vid) { // Safety check to prevent null access
                            const canvas = document.createElement('canvas');
                            canvas.width = vid.videoWidth;
                            canvas.height = vid.videoHeight;
                            const ctx = canvas.getContext('2d');
                            if (ctx) {
                                ctx.drawImage(vid, 0, 0);
                                onCrop?.(node.id, canvas.toDataURL('image/png'));
                            }
                        }
                    }}
                    onTimeHover={() => {}}
                />
            }
        </div>
      );
  };

  const renderBottomPanel = () => {
     if (node.type === NodeType.PROMPT_INPUT) return null;
     const isOpen = (isHovered || isInputFocused);
     let models: {l: string, v: string}[] = [];
     if (node.type === NodeType.VIDEO_GENERATOR) {
        models = [...getStudioVideoModelOptions()];
     } else if (node.type === NodeType.VIDEO_ANALYZER) {
         models = [{l: '当前版本已停用', v: 'disabled'}];
     } else if (node.type === NodeType.AUDIO_GENERATOR) {
         models = [...STUDIO_AUDIO_MODEL_OPTIONS];
     } else if (node.type === NodeType.IMAGE_GENERATOR || node.type === NodeType.IMAGE_EDITOR) {
        models = [...STUDIO_IMAGE_MODEL_OPTIONS];
     } else {
        models = [...STUDIO_TEXT_MODEL_OPTIONS];
     }
     const selectedModel = node.type === NodeType.VIDEO_GENERATOR
        ? normalizeStudioVideoModel(node.data.model)
        : node.type === NodeType.AUDIO_GENERATOR
            ? normalizeStudioAudioModel(node.data.model)
            : (node.type === NodeType.IMAGE_GENERATOR || node.type === NodeType.IMAGE_EDITOR)
                ? normalizeStudioImageModel(node.data.model)
                : normalizeStudioTextModel(node.data.model);
     const modelPickerOptions: readonly ModelPickerOption<string>[] = models.map(model => {
        const videoModel = node.type === NodeType.VIDEO_GENERATOR ? model.v as VideoModel : null;
        const unavailableReason = videoModel
            ? getStudioVideoModelUnavailableReason(videoModel)
            : model.v === 'disabled'
                ? '当前版本已停用'
                : undefined;
        return {
            value: model.v,
            label: model.l,
            description: node.type === NodeType.VIDEO_GENERATOR
                ? (videoModel && isComfyUIModel(videoModel) ? '本地节点视频生成模型' : '在线视频生成模型')
                : node.type === NodeType.AUDIO_GENERATOR
                    ? '高清语音生成模型'
                    : node.type === NodeType.IMAGE_GENERATOR || node.type === NodeType.IMAGE_EDITOR
                        ? '在线图像生成模型'
                        : '在线文本生成模型',
            group: videoModel && isComfyUIModel(videoModel) ? '本地节点' : '在线 API',
            badge: videoModel && isComfyUIModel(videoModel) ? '本地节点' : undefined,
            available: !unavailableReason,
            unavailableReason,
        };
     });
     const pickerKind = node.type === NodeType.VIDEO_GENERATOR
        ? 'video'
        : node.type === NodeType.AUDIO_GENERATOR
            ? 'audio'
            : node.type === NodeType.IMAGE_GENERATOR || node.type === NodeType.IMAGE_EDITOR
                ? 'image'
                : 'text';

     return (
        <div className={`absolute top-full left-[1%] w-[98%] pt-2 z-50 flex flex-col items-center justify-start transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            {/* InputThumbnails: Set strict Z-Index to lower layer */}
            {hasInputs && onInputReorder && (<div className="w-full flex justify-center mb-2 z-0 relative"><InputThumbnails assets={inputAssets!} onReorder={(newOrder) => onInputReorder(node.id, newOrder)} /></div>)}
            {/* Glass Panel: Set strict Z-Index to higher layer to overlap thumbnails */}
            <div className={`w-full rounded-[20px] p-1 flex flex-col gap-1 ${GLASS_PANEL} relative z-[100]`} onMouseDown={e => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
                {creditSummary && (
                    <div className={`flex items-center gap-1.5 px-3 pt-2 text-[10px] font-medium ${creditInsufficient ? 'text-red-400' : 'studio-node-muted'}`}>
                        <Coins size={11} className="shrink-0" />
                        <span className="whitespace-nowrap">
                            {isCreditLoading
                                ? '正在计算创作点数…'
                                : creditSummary.enabled
                                    ? `预计 ${creditSummary.totalCost} 创作点数 · 成功后扣除`
                                    : '当前生成不计创作点数'}
                        </span>
                        {creditInsufficient && <span className="ml-auto whitespace-nowrap">余额不足</span>}
                    </div>
                )}
                <div className="studio-node-control-input relative group/input rounded-[16px]">
                    <textarea className="studio-node-textarea w-full bg-transparent text-xs p-3 focus:outline-none resize-none custom-scrollbar font-medium leading-relaxed" style={{ height: `${Math.min(inputHeight, 200)}px` }} placeholder={node.type === NodeType.AUDIO_GENERATOR ? "输入需要合成语音的台词..." : "描述您的修改或生成需求..."} value={localPrompt} onChange={(e) => setLocalPrompt(e.target.value)} onBlur={() => { setIsInputFocused(false); commitPrompt(); }} onKeyDown={handleCmdEnter} onFocus={() => setIsInputFocused(true)} onMouseDown={e => e.stopPropagation()} readOnly={isWorking} />
                    <div className="absolute bottom-0 left-0 w-full h-3 cursor-row-resize flex items-center justify-center opacity-0 group-hover/input:opacity-100 transition-opacity" onMouseDown={handleInputResizeStart}><div className="w-8 h-1 rounded-full bg-white/10 group-hover/input:bg-white/20" /></div>
                </div>
                <div className="flex items-center gap-2 px-2 pb-1 pt-1 relative z-20">
                    <div className="flex min-w-0 flex-1 items-center gap-1">
                         <ModelPicker
                             value={selectedModel}
                             options={modelPickerOptions}
                             onChange={model => onUpdate(node.id, { model })}
                             compact
                             className="max-w-[132px]"
                             ariaLabel="选择画布模型"
                             title="画布模型"
                             kind={pickerKind}
                         />
                         {node.type !== NodeType.VIDEO_ANALYZER && node.type !== NodeType.AUDIO_GENERATOR && (<div className="relative shrink-0 whitespace-nowrap group/ratio"><div className="studio-node-control-trigger flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer transition-colors text-[11px] font-bold"><Scaling size={12} /><span>{node.data.aspectRatio || '16:9'}</span></div><div className="absolute bottom-full left-0 pb-2 w-20 opacity-0 translate-y-2 pointer-events-none group-hover/ratio:opacity-100 group-hover/ratio:translate-y-0 group-hover/ratio:pointer-events-auto transition-all duration-200 z-[200]"><div className="studio-node-menu rounded-xl shadow-xl overflow-hidden">{(node.type.includes('VIDEO') ? VIDEO_ASPECT_RATIOS : IMAGE_ASPECT_RATIOS).map(r => (<div key={r} onClick={() => handleAspectRatioSelect(r)} className={`studio-node-menu-item px-3 py-2 text-[10px] font-bold cursor-pointer ${node.data.aspectRatio === r ? 'studio-node-menu-item-active' : ''}`}>{r}</div>))}</div></div></div>)}
                         {(node.type.includes('IMAGE') || node.type === NodeType.VIDEO_GENERATOR) && (<div className="relative shrink-0 whitespace-nowrap group/resolution"><div className="studio-node-control-trigger flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer transition-colors text-[11px] font-bold"><Monitor size={12} /><span>{node.data.resolution || (node.type.includes('IMAGE') ? '1k' : '720p')}</span></div><div className="absolute bottom-full left-0 pb-2 w-20 opacity-0 translate-y-2 pointer-events-none group-hover/resolution:opacity-100 group-hover/resolution:translate-y-0 group-hover/resolution:pointer-events-auto transition-all duration-200 z-[200]"><div className="studio-node-menu rounded-xl shadow-xl overflow-hidden">{(node.type.includes('IMAGE') ? IMAGE_RESOLUTIONS : VIDEO_RESOLUTIONS).map(r => (<div key={r} onClick={() => onUpdate(node.id, { resolution: r })} className={`studio-node-menu-item px-3 py-2 text-[10px] font-bold cursor-pointer ${node.data.resolution === r ? 'studio-node-menu-item-active' : ''}`}>{r}</div>))}</div></div></div>)}
                         {(node.type.includes('IMAGE') || node.type === NodeType.VIDEO_GENERATOR) && (<div className="relative shrink-0 whitespace-nowrap group/count"><div className="studio-node-control-trigger flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer transition-colors text-[11px] font-bold"><Layers size={12} /><span>{node.type.includes('IMAGE') ? (node.data.imageCount || 1) : (node.data.videoCount || 1)}</span></div><div className="absolute bottom-full left-0 pb-2 w-16 opacity-0 translate-y-2 pointer-events-none group-hover/count:opacity-100 group-hover/count:translate-y-0 group-hover/count:pointer-events-auto transition-all duration-200 z-[200]"><div className="studio-node-menu rounded-xl shadow-xl overflow-hidden">{(node.type.includes('IMAGE') ? IMAGE_COUNTS : VIDEO_COUNTS).map(c => (<div key={c} onClick={() => onUpdate(node.id, node.type.includes('IMAGE') ? { imageCount: c } : { videoCount: c })} className={`studio-node-menu-item px-3 py-2 text-[10px] font-bold cursor-pointer ${((node.type.includes('IMAGE') ? node.data.imageCount : node.data.videoCount) || 1) === c ? 'studio-node-menu-item-active' : ''}`}>{c}</div>))}</div></div></div>)}
                    </div>
                    <button onClick={handleActionClick} disabled={isWorking || creditInsufficient} title={creditInsufficient ? '创作点数不足，请先补充创作点数' : undefined} className={`relative flex shrink-0 items-center justify-center gap-2 whitespace-nowrap px-4 py-1.5 rounded-[12px] font-bold text-[11px] tracking-wide transition-all duration-300 ${isWorking || creditInsufficient ? 'bg-white/5 text-slate-500 cursor-not-allowed' : 'bg-gradient-to-r from-cyan-500 to-blue-500 text-black hover:shadow-lg hover:shadow-cyan-500/20 hover:scale-105 active:scale-95'}`}>{isWorking ? <Loader2 className="shrink-0 animate-spin" size={12} /> : <Wand2 className="shrink-0" size={12} />}<span className="whitespace-nowrap">{isWorking ? '生成中...' : '生成'}</span></button>
                </div>
            </div>
        </div>
     );
  };

  const isInteracting = isDragging || isResizing || isGroupDragging;
  return (
    <div
        className={`studio-node absolute rounded-[24px] group ${isSelected ? 'z-30' : 'z-10'}`}
        data-selected={isSelected ? 'true' : 'false'}
        style={{
            left: Math.round(node.x), top: Math.round(node.y), width: Math.round(nodeWidth), height: Math.round(nodeHeight),
            transition: isInteracting ? 'none' : 'left 0.5s cubic-bezier(0.32, 0.72, 0, 1), top 0.5s cubic-bezier(0.32, 0.72, 0, 1), width 0.5s cubic-bezier(0.32, 0.72, 0, 1), height 0.5s cubic-bezier(0.32, 0.72, 0, 1), border-color 0.2s ease, box-shadow 0.2s ease',
            boxShadow: isInteracting ? 'none' : undefined,
            willChange: isInteracting ? 'left, top, width, height' : 'auto'
        }}
        onMouseDown={(e) => onNodeMouseDown(e, node.id)} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} onContextMenu={(e) => onNodeContextMenu(e, node.id)}
    >
        {renderTopBar()}
        <div className={`studio-node-port absolute -left-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-125 cursor-crosshair z-50 shadow-md ${isConnecting ? 'ring-2 ring-cyan-400 animate-pulse' : ''}`} onMouseDown={(e) => onPortMouseDown(e, node.id, 'input')} onMouseUp={(e) => onPortMouseUp(e, node.id, 'input')} title="Input"><Plus size={10} strokeWidth={3} /></div>
        <div className={`studio-node-port absolute -right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-125 cursor-crosshair z-50 shadow-md ${isConnecting ? 'ring-2 ring-purple-400 animate-pulse' : ''}`} onMouseDown={(e) => onPortMouseDown(e, node.id, 'output')} onMouseUp={(e) => onPortMouseUp(e, node.id, 'output')} title="Output"><Plus size={10} strokeWidth={3} /></div>
        <div className="studio-node-body w-full h-full flex flex-col relative rounded-[24px] overflow-hidden"><div className="studio-node-body flex-1 min-h-0 relative">{renderMediaContent()}</div></div>
        {renderBottomPanel()}
        <div className="studio-node-port absolute -bottom-3 -right-3 w-6 h-6 flex items-center justify-center cursor-nwse-resize transition-colors opacity-0 group-hover:opacity-100 z-50" onMouseDown={(e) => onResizeMouseDown(e, node.id, nodeWidth, nodeHeight)}><div className="w-1.5 h-1.5 rounded-full bg-current" /></div>
    </div>
  );
};

export const Node = memo(NodeComponent, arePropsEqual);
