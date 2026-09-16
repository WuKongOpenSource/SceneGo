

import { SeedreamSourceBadge } from '@app/components/SeedreamSourceBadge';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { WorkspaceLoadBoundary } from '@app/components/WorkspaceLoadBoundary';
import { useWorkspaceSave } from '@app/hooks/useWorkspaceSave';
import { navigateFromStudio } from './navigation';
import { Node } from './components/Node';
import { SidebarDock } from './components/SidebarDock';
import { AssistantPanel } from './components/AssistantPanel';
import { ImageCropper } from './components/ImageCropper';
import { SketchEditor } from './components/SketchEditor';
import { SmartSequenceDock } from './components/SmartSequenceDock';
import { SonicStudio } from './components/SonicStudio';
import { AppNode, NodeType, NodeStatus, Connection, ContextMenuState, Group, Workflow, SmartSequenceItem } from './types';
import { getGenerationStrategy } from './services/videoStrategies';
import { useStudioRuntime, type StudioSnapshot } from './services/runtime';
import {
    createBasicScriptToVideoWorkflow,
    resolveStudioWorkspace,
    STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID,
} from './defaultWorkflows';
import {
    STUDIO_AUDIO_MODEL_SPEECH_HD,
    STUDIO_IMAGE_MODEL_CONFIGURED,
    STUDIO_TEXT_MODEL_CONFIGURED,
    STUDIO_VIDEO_MODEL_FAST,
    STUDIO_VIDEO_MODEL_STANDARD,
    normalizeStudioImageModel,
    normalizeStudioVideoModel,
} from './services/modelOptions';
import {
    persistStudioCanvasTheme,
    readStudioCanvasTheme,
    StudioCanvasTheme,
} from './theme';
import {
    Plus, Copy, Trash2, Type, Image as ImageIcon, Video as VideoIcon,
    ScanFace, Brush, MousePointerClick, LayoutTemplate, X, Film, Link, RefreshCw, Upload,
    Minus, FolderHeart, Unplug, Sparkles, ChevronLeft, ChevronRight, Scan, Music, Mic2, ArrowLeft,
    Moon, Sun, Hand, Coins
} from 'lucide-react';

const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";
const SNAP_THRESHOLD = 8; // Pixels for magnetic snap
const COLLISION_PADDING = 24; // Spacing when nodes bounce off each other
const MIN_CANVAS_SCALE = 0.2;
const MAX_CANVAS_SCALE = 3;
// Keep the rendered scale aligned with the percentage shown in the toolbar.
// A value that rounds to 100% must be exactly 1 so text is not resampled.
const snapCanvasScale = (value: number) => Math.round(value * 100) === 100 ? 1 : value;

const getImageDimensions = (src: string): Promise<{width: number, height: number}> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({width: img.width, height: img.height});
        img.onerror = reject;
        img.src = src;
    });
};

const ExpandedView = ({ media, onClose }: { media: any, onClose: () => void }) => {
    const [visible, setVisible] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        if (media) {
            requestAnimationFrame(() => setVisible(true));
            setCurrentIndex(media.initialIndex || 0);
        } else {
            setVisible(false);
        }
    }, [media]);

    const handleClose = useCallback(() => {
        setVisible(false);
        setTimeout(onClose, 400);
    }, [onClose]);

    const hasMultiple = media?.images && media.images.length > 1;

    const handleNext = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (hasMultiple) {
            setCurrentIndex((prev) => (prev + 1) % media.images.length);
        }
    }, [hasMultiple, media]);

    const handlePrev = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (hasMultiple) {
            setCurrentIndex((prev) => (prev - 1 + media.images.length) % media.images.length);
        }
    }, [hasMultiple, media]);

    useEffect(() => {
        if (!visible) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
            if (e.key === 'ArrowRight') handleNext();
            if (e.key === 'ArrowLeft') handlePrev();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [visible, handleClose, handleNext, handlePrev]);

    if (!media) return null;

    const currentSrc = hasMultiple ? media.images[currentIndex] : media.src;
    const isVideo = (media.type === 'video') && !(currentSrc && currentSrc.startsWith('data:image'));

    return (
        <div className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-500 ease-[${SPRING}] ${visible ? 'bg-black/90 backdrop-blur-xl' : 'bg-transparent pointer-events-none opacity-0'}`} onClick={handleClose}>
             <div className={`relative w-full h-full flex items-center justify-center p-8 transition-all duration-500 ease-[${SPRING}] ${visible ? 'scale-100 opacity-100' : 'scale-90 opacity-0'}`} onClick={e => e.stopPropagation()}>

                {hasMultiple && (
                    <button
                        onClick={handlePrev}
                        className="absolute left-4 md:left-8 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md transition-all hover:scale-110 z-[110]"
                    >
                        <ChevronLeft size={32} />
                    </button>
                )}

                <div className="relative max-w-full max-h-full flex flex-col items-center">
                    {!isVideo && <div className="rounded bg-white/95 px-2 py-1"><SeedreamSourceBadge reference={currentSrc} /></div>}
                    {!isVideo ? (
                        <img
                            key={currentSrc}
                            src={currentSrc}
                            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl animate-in fade-in duration-300 bg-[#0a0a0c]"
                            draggable={false}
                        />
                    ) : (
                        <video
                            key={currentSrc}
                            src={currentSrc}
                            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl animate-in fade-in duration-300 bg-[#0a0a0c]"
                            controls
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="auto"
                        />
                    )}

                    {hasMultiple && (
                        <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 flex gap-2">
                            {media.images.map((_:any, i:number) => (
                                <div
                                    key={i}
                                    onClick={(e) => { e.stopPropagation(); setCurrentIndex(i); }}
                                    className={`w-2.5 h-2.5 rounded-full cursor-pointer transition-all ${i === currentIndex ? 'bg-cyan-500 scale-125' : 'bg-white/30 hover:bg-white/50'}`}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {hasMultiple && (
                    <button
                        onClick={handleNext}
                        className="absolute right-4 md:right-8 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md transition-all hover:scale-110 z-[110]"
                    >
                        <ChevronRight size={32} />
                    </button>
                )}

             </div>
             <button onClick={handleClose} className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white backdrop-blur-md transition-colors z-[110]"><X size={24} /></button>
        </div>
    );
};

export const App = () => {
  const runtime = useStudioRuntime();
  return <WorkspaceLoadBoundary load={runtime.loadSnapshot} onBack={() => navigateFromStudio(runtime.returnTo)}>
    {snapshot => <StudioCanvas initialSnapshot={snapshot} />}
  </WorkspaceLoadBoundary>;
};

const StudioCanvas = ({ initialSnapshot }: { initialSnapshot: StudioSnapshot | null }) => {
  const runtime = useStudioRuntime();
  const [initialWorkspace] = useState(() => resolveStudioWorkspace(initialSnapshot));
  const [canvasTheme, setCanvasTheme] = useState<StudioCanvasTheme>(() => readStudioCanvasTheme());
  const [workflows, setWorkflows] = useState<Workflow[]>(initialWorkspace.workflows);
  const [assetHistory, setAssetHistory] = useState<any[]>(initialWorkspace.assets);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(initialSnapshot ? null : STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  const [isSketchEditorOpen, setIsSketchEditorOpen] = useState(false);

  const [isMultiFrameOpen, setIsMultiFrameOpen] = useState(false);

  const [isSonicStudioOpen, setIsSonicStudioOpen] = useState(false);

  const [nodes, setNodes] = useState<AppNode[]>(initialWorkspace.nodes);
  const [connections, setConnections] = useState<Connection[]>(initialWorkspace.connections);
  const [groups, setGroups] = useState<Group[]>(initialWorkspace.groups);
  const [clipboard, setClipboard] = useState<AppNode | null>(null);

  const [history, setHistory] = useState<any[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [scale, setScale] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number, y: number }>({ x: 0, y: 0 });
  const [isDraggingCanvas, setIsDraggingCanvas] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const isSpacePressedRef = useRef(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]); // Changed to Array for multi-select
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [draggingNodeParentGroupId, setDraggingNodeParentGroupId] = useState<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<any>(null);
  const [resizingGroupId, setResizingGroupId] = useState<string | null>(null);
  const [activeGroupNodeIds, setActiveGroupNodeIds] = useState<string[]>([]);
  const [connectionStart, setConnectionStart] = useState<{ id: string, x: number, y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<any>(null);

  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  const [initialSize, setInitialSize] = useState<{width: number, height: number} | null>(null);
  const [resizeStartPos, setResizeStartPos] = useState<{x: number, y: number} | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [contextMenuTarget, setContextMenuTarget] = useState<any>(null);

  const [expandedMedia, setExpandedMedia] = useState<any>(null);
  const [croppingNodeId, setCroppingNodeId] = useState<string | null>(null);
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);

  const nodesRef = useRef(nodes);
  const connectionsRef = useRef(connections);
  const groupsRef = useRef(groups);
  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);
  const connectionStartRef = useRef(connectionStart);
  const rafRef = useRef<number | null>(null); // For RAF Throttling

  const replaceVideoInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const replacementTargetRef = useRef<string | null>(null);

  const dragNodeRef = useRef<{
      id: string,
      startX: number,
      startY: number,
      mouseStartX: number,
      mouseStartY: number,
      parentGroupId?: string | null,
      siblingNodeIds: string[],
      nodeWidth: number,
      nodeHeight: number
  } | null>(null);

  const resizeContextRef = useRef<{
      nodeId: string,
      initialWidth: number,
      initialHeight: number,
      startX: number,
      startY: number,
      parentGroupId: string | null,
      siblingNodeIds: string[]
  } | null>(null);

  const dragGroupRef = useRef<{
      id: string,
      startX: number,
      startY: number,
      mouseStartX: number,
      mouseStartY: number,
      childNodes: {id: string, startX: number, startY: number}[]
  } | null>(null);

  useEffect(() => {
      nodesRef.current = nodes; connectionsRef.current = connections; groupsRef.current = groups;
      historyRef.current = history; historyIndexRef.current = historyIndex; connectionStartRef.current = connectionStart;
  }, [nodes, connections, groups, history, historyIndex, connectionStart]);

  const refreshCreditBalance = useCallback(async () => {
      try {
          setCreditBalance(await runtime.getCreditBalance());
      } catch (error) {
          console.warn('[studio] failed to refresh credit balance', error);
      }
  }, [runtime]);

  useEffect(() => {
      void refreshCreditBalance();
      const handleFocus = () => void refreshCreditBalance();
      const handleCreditsUpdated = (event: Event) => {
          const rawBalance = (event as CustomEvent<{ balance?: unknown }>).detail?.balance;
          if (typeof rawBalance === 'number' && Number.isFinite(rawBalance)) setCreditBalance(rawBalance);
          void refreshCreditBalance();
      };
      const timer = window.setInterval(() => void refreshCreditBalance(), 60_000);
      window.addEventListener('focus', handleFocus);
      window.addEventListener('credits:updated', handleCreditsUpdated);
      return () => {
          window.clearInterval(timer);
          window.removeEventListener('focus', handleFocus);
          window.removeEventListener('credits:updated', handleCreditsUpdated);
      };
  }, [refreshCreditBalance]);

  const snapshot = useMemo<StudioSnapshot>(() => ({
    schemaVersion: 1, assets: assetHistory, workflows, nodes, connections, groups,
  }), [assetHistory, workflows, nodes, connections, groups]);
  const { status: saveStatus, saveNow } = useWorkspaceSave(runtime.saveSnapshot, snapshot);
  const leaveStudio = useCallback(async (destination = runtime.returnTo) => {
    if (await saveNow()) navigateFromStudio(destination);
  }, [runtime.returnTo, saveNow]);


  const getApproxNodeHeight = (node: AppNode) => {
      if (node.height) return node.height;
      const width = node.width || 420;
      if (['PROMPT_INPUT', 'VIDEO_ANALYZER', 'IMAGE_EDITOR'].includes(node.type)) return 360;
      if (node.type === NodeType.AUDIO_GENERATOR) return 200;
      const [w, h] = (node.data.aspectRatio || '16:9').split(':').map(Number);
      const extra = (node.type === NodeType.VIDEO_GENERATOR && node.data.generationMode === 'CUT') ? 36 : 0;
      return ((width * h / w) + extra);
  };

  const getNodeBounds = (node: AppNode) => {
      const h = node.height || getApproxNodeHeight(node);
      const w = node.width || 420;
      return { x: node.x, y: node.y, width: w, height: h, r: node.x + w, b: node.y + h };
  };

  const getNodeNameCN = (t: string) => {
      switch(t) {
          case NodeType.PROMPT_INPUT: return '创意描述';
          case NodeType.IMAGE_GENERATOR: return '文字生图';
          case NodeType.VIDEO_GENERATOR: return '文生视频';
          case NodeType.AUDIO_GENERATOR: return '语音合成';
          case NodeType.VIDEO_ANALYZER: return '视频分析';
          case NodeType.IMAGE_EDITOR: return '图像编辑';
          default: return t;
      }
  };
  const getNodeIcon = (t: string) => {
      switch(t) {
          case NodeType.PROMPT_INPUT: return Type;
          case NodeType.IMAGE_GENERATOR: return ImageIcon;
          case NodeType.VIDEO_GENERATOR: return Film;
          case NodeType.AUDIO_GENERATOR: return Mic2;
          case NodeType.VIDEO_ANALYZER: return ScanFace;
          case NodeType.IMAGE_EDITOR: return Brush;
          default: return Plus;
      }
  };

  const handleFitView = useCallback(() => {
      if (nodes.length === 0) {
          setPan({ x: 0, y: 0 });
          setScale(1);
          return;
      }

      const padding = 100;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      nodes.forEach(n => {
          const h = n.height || getApproxNodeHeight(n);
          const w = n.width || 420;
          if (n.x < minX) minX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.x + w > maxX) maxX = n.x + w;
          if (n.y + h > maxY) maxY = n.y + h;
      });

      const contentW = maxX - minX;
      const contentH = maxY - minY;

      const scaleX = (window.innerWidth - padding * 2) / contentW;
      const scaleY = (window.innerHeight - padding * 2) / contentH;
      let newScale = Math.min(scaleX, scaleY, 1);
      newScale = snapCanvasScale(Math.max(MIN_CANVAS_SCALE, newScale));

      const contentCenterX = minX + contentW / 2;
      const contentCenterY = minY + contentH / 2;

      const newPanX = (window.innerWidth / 2) - (contentCenterX * newScale);
      const newPanY = (window.innerHeight / 2) - (contentCenterY * newScale);

      setPan({ x: newPanX, y: newPanY });
      setScale(newScale);
  }, [nodes]);

  const saveHistory = useCallback(() => {
      try {
          const currentStep = { nodes: JSON.parse(JSON.stringify(nodesRef.current)), connections: JSON.parse(JSON.stringify(connectionsRef.current)), groups: JSON.parse(JSON.stringify(groupsRef.current)) };
          const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
          newHistory.push(currentStep); if (newHistory.length > 50) newHistory.shift();
          setHistory(newHistory); setHistoryIndex(newHistory.length - 1);
      } catch (e) {
          console.warn("History save failed:", e);
      }
  }, []);

  const undo = useCallback(() => {
      const idx = historyIndexRef.current; if (idx > 0) { const prev = historyRef.current[idx - 1]; setNodes(prev.nodes); setConnections(prev.connections); setGroups(prev.groups); setHistoryIndex(idx - 1); }
  }, []);

  const deleteNodes = useCallback((ids: string[]) => {
      if (ids.length === 0) return;
      saveHistory();
      setNodes(p => p.filter(n => !ids.includes(n.id)).map(n => ({...n, inputs: n.inputs.filter(i => !ids.includes(i))})));
      setConnections(p => p.filter(c => !ids.includes(c.from) && !ids.includes(c.to)));
      setSelectedNodeIds([]);
  }, [saveHistory]);

  const addNode = useCallback((type: NodeType, x?: number, y?: number, initialData?: any) => {
      if (type === NodeType.IMAGE_EDITOR) {
          setIsSketchEditorOpen(true);
          return;
      }

      try { saveHistory(); } catch (e) { }

      const initialStatus = initialData?.status as NodeStatus | undefined;
      const { status: _ignoredStatus, ...safeInitialData } = initialData || {};
      const defaults: any = {
          model: type === NodeType.VIDEO_GENERATOR ? STUDIO_VIDEO_MODEL_FAST :
                 type === NodeType.AUDIO_GENERATOR ? STUDIO_AUDIO_MODEL_SPEECH_HD :
                 type.includes('IMAGE') ? STUDIO_IMAGE_MODEL_CONFIGURED :
                 STUDIO_TEXT_MODEL_CONFIGURED,
          generationMode: type === NodeType.VIDEO_GENERATOR ? 'DEFAULT' : undefined, // Initialize as DEFAULT (Off)
          ...safeInitialData
      };

      const typeMap: Record<string, string> = {
          [NodeType.PROMPT_INPUT]: '创意描述',
          [NodeType.IMAGE_GENERATOR]: '文字生图',
          [NodeType.VIDEO_GENERATOR]: '文生视频',
          [NodeType.AUDIO_GENERATOR]: '语音合成',
          [NodeType.VIDEO_ANALYZER]: '视频分析',
          [NodeType.IMAGE_EDITOR]: '图像编辑'
      };

      const safeX = x !== undefined ? x : (-pan.x + window.innerWidth/2)/scale - 210;
      const safeY = y !== undefined ? y : (-pan.y + window.innerHeight/2)/scale - 180;

      const newNode: AppNode = {
        id: `n-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        type,
        x: isNaN(safeX) ? 100 : safeX,
        y: isNaN(safeY) ? 100 : safeY,
        width: 420,
        title: typeMap[type] || '未命名节点',
        status: initialStatus || NodeStatus.IDLE,
        data: defaults,
        inputs: []
      };

      setNodes(prev => [...prev, newNode]);
  }, [pan, scale, saveHistory]);

  const handleAssetGenerated = useCallback((type: 'image' | 'video' | 'audio', src: string, title: string) => {
      setAssetHistory(h => {
          const exists = h.find(a => a.src === src);
          if (exists) return h;
          return [{ id: `a-${Date.now()}`, type, src, title, timestamp: Date.now() }, ...h];
      });
  }, []);

  const handleSketchResult = (type: 'image' | 'video', result: string, prompt: string) => {
      const centerX = (-pan.x + window.innerWidth/2)/scale - 210;
      const centerY = (-pan.y + window.innerHeight/2)/scale - 180;

      if (type === 'image') {
          addNode(NodeType.IMAGE_GENERATOR, centerX, centerY, { image: result, prompt, status: NodeStatus.SUCCESS });
      } else {
          addNode(NodeType.VIDEO_GENERATOR, centerX, centerY, { videoUri: result, prompt, status: NodeStatus.SUCCESS });
      }

      handleAssetGenerated(type, result, prompt || 'Sketch Output');
  };

  const handleMultiFrameGenerate = async (frames: SmartSequenceItem[]): Promise<string> => {
      const complexPrompt = runtime.compileMultiFramePrompt(frames);

      try {
          const res = await runtime.generateVideo(
              complexPrompt,
              STUDIO_VIDEO_MODEL_STANDARD,
              {
                aspectRatio: '16:9',
                count: 1,
                generationMode: 'FIRST_LAST_FRAME',
                inputImage: frames[0]?.src,
                referenceImages: frames.map(frame => frame.src),
              },
          );
          handleAssetGenerated('video', res.uri, 'Smart Sequence');
          return res.uri;
      } catch (e: any) {
          throw new Error(e.message || "Smart Sequence Generation Failed");
      }
  };


  const handleWheel = (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); const newScale = snapCanvasScale(Math.min(Math.max(MIN_CANVAS_SCALE, scale - e.deltaY * 0.001), MAX_CANVAS_SCALE));
        const rect = e.currentTarget.getBoundingClientRect(); const x = e.clientX - rect.left; const y = e.clientY - rect.top;
        const scaleDiff = newScale - scale;
        setPan(p => ({ x: p.x - (x - p.x) * (scaleDiff / scale), y: p.y - (y - p.y) * (scaleDiff / scale) }));
        setScale(newScale);
      } else { setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY })); }
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
      if (contextMenu) setContextMenu(null); setSelectedGroupId(null);
      if (e.button === 0 && !e.shiftKey) {
          if (e.detail > 1) { e.preventDefault(); return; }
          setSelectedNodeIds([]);
          setSelectionRect({ startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY });
      }
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) { setIsDraggingCanvas(true); setLastMousePos({ x: e.clientX, y: e.clientY }); }
  };

  const handleCanvasMouseDownCapture = (e: React.MouseEvent) => {
      if (e.button !== 0 || !isSpacePressedRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (contextMenu) setContextMenu(null);
      setIsDraggingCanvas(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
      const { clientX, clientY } = e;
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setMousePos({ x: clientX, y: clientY });

          if (selectionRect) { setSelectionRect((prev:any) => prev ? ({ ...prev, currentX: clientX, currentY: clientY }) : null); return; }

          if (dragGroupRef.current) {
              const { id, startX, startY, mouseStartX, mouseStartY, childNodes } = dragGroupRef.current;
              const dx = (clientX - mouseStartX) / scale;
              const dy = (clientY - mouseStartY) / scale;
              setGroups(prev => prev.map(g => g.id === id ? { ...g, x: startX + dx, y: startY + dy } : g));
              if (childNodes.length > 0) {
                  setNodes(prev => prev.map(n => {
                      const child = childNodes.find(c => c.id === n.id);
                      return child ? { ...n, x: child.startX + dx, y: child.startY + dy } : n;
                  }));
              }
              return;
          }

          if (isDraggingCanvas) {
              const dx = clientX - lastMousePos.x;
              const dy = clientY - lastMousePos.y;
              setPan(p => ({ x: p.x + dx, y: p.y + dy }));
              setLastMousePos({ x: clientX, y: clientY });
          }

          if (draggingNodeId && dragNodeRef.current && dragNodeRef.current.id === draggingNodeId) {
             const { startX, startY, mouseStartX, mouseStartY, nodeWidth, nodeHeight } = dragNodeRef.current;
             let dx = (clientX - mouseStartX) / scale;
             let dy = (clientY - mouseStartY) / scale;
             let proposedX = startX + dx;
             let proposedY = startY + dy;

             const SNAP = SNAP_THRESHOLD / scale;
             const myL = proposedX; const myC = proposedX + nodeWidth / 2; const myR = proposedX + nodeWidth;
             const myT = proposedY; const myM = proposedY + nodeHeight / 2; const myB = proposedY + nodeHeight;
             let snappedX = false; let snappedY = false;

             nodesRef.current.forEach(other => {
                 if (other.id === draggingNodeId) return;
                 const otherBounds = getNodeBounds(other);
                 if (!snappedX) {
                     if (Math.abs(myL - otherBounds.x) < SNAP) { proposedX = otherBounds.x; snappedX = true; }
                     else if (Math.abs(myL - otherBounds.r) < SNAP) { proposedX = otherBounds.r; snappedX = true; }
                     else if (Math.abs(myR - otherBounds.x) < SNAP) { proposedX = otherBounds.x - nodeWidth; snappedX = true; }
                     else if (Math.abs(myR - otherBounds.r) < SNAP) { proposedX = otherBounds.r - nodeWidth; snappedX = true; }
                     else if (Math.abs(myC - (otherBounds.x+otherBounds.width/2)) < SNAP) { proposedX = (otherBounds.x+otherBounds.width/2) - nodeWidth/2; snappedX = true; }
                 }
                 if (!snappedY) {
                     if (Math.abs(myT - otherBounds.y) < SNAP) { proposedY = otherBounds.y; snappedY = true; }
                     else if (Math.abs(myT - otherBounds.b) < SNAP) { proposedY = otherBounds.b; snappedY = true; }
                     else if (Math.abs(myB - otherBounds.y) < SNAP) { proposedY = otherBounds.y - nodeHeight; snappedY = true; }
                     else if (Math.abs(myB - otherBounds.b) < SNAP) { proposedY = otherBounds.b - nodeHeight; snappedY = true; }
                     else if (Math.abs(myM - (otherBounds.y+otherBounds.height/2)) < SNAP) { proposedY = (otherBounds.y+otherBounds.height/2) - nodeHeight/2; snappedY = true; }
                 }
             });

             setNodes(prev => prev.map(n => n.id === draggingNodeId ? { ...n, x: proposedX, y: proposedY } : n));

          } else if (draggingNodeId) {
              const dx = (clientX - lastMousePos.x) / scale;
              const dy = (clientY - lastMousePos.y) / scale;
              setNodes(prev => prev.map(n => n.id === draggingNodeId ? { ...n, x: n.x + dx, y: n.y + dy } : n));
              setLastMousePos({ x: clientX, y: clientY });
          }

          if (resizingNodeId && initialSize && resizeStartPos) {
              const dx = (clientX - resizeStartPos.x) / scale; const dy = (clientY - resizeStartPos.y) / scale;
              setNodes(prev => prev.map(n => n.id === resizingNodeId ? { ...n, width: Math.max(360, initialSize.width + dx), height: Math.max(240, initialSize.height + dy) } : n));
          }
      });
  }, [selectionRect, isDraggingCanvas, draggingNodeId, resizingNodeId, initialSize, resizeStartPos, scale, lastMousePos]);

  const handleGlobalMouseUp = useCallback(() => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (selectionRect) {
          const x = Math.min(selectionRect.startX, selectionRect.currentX); const y = Math.min(selectionRect.startY, selectionRect.currentY);
          const w = Math.abs(selectionRect.currentX - selectionRect.startX); const h = Math.abs(selectionRect.currentY - selectionRect.startY);
          if (w > 10) {
              const rect = { x: (x - pan.x) / scale, y: (y - pan.y) / scale, w: w / scale, h: h / scale };
              const enclosed = nodesRef.current.filter(n => { const cx = n.x + (n.width||420)/2; const cy = n.y + 160; return cx>rect.x && cx<rect.x+rect.w && cy>rect.y && cy<rect.y+rect.h; });
              if (enclosed.length > 0) { saveHistory();
                  const freeNodes = enclosed.filter(n => {
                      const cx = n.x + (n.width || 420) / 2; const cy = n.y + 160;
                      return !groupsRef.current.some(g => cx > g.x && cx < g.x + g.width && cy > g.y && cy < g.y + g.height);
                  });
                  if (freeNodes.length > 0) {
                      const fMinX=Math.min(...freeNodes.map(n=>n.x)), fMinY=Math.min(...freeNodes.map(n=>n.y)), fMaxX=Math.max(...freeNodes.map(n=>n.x+(n.width||420))), fMaxY=Math.max(...freeNodes.map(n=>n.y+320));
                      setGroups(prev => [...prev, { id: `g-${Date.now()}`, title: '新建分组', x: fMinX-32, y: fMinY-32, width: (fMaxX-fMinX)+64, height: (fMaxY-fMinY)+64 }]);
                  }
              }
          }
          setSelectionRect(null);
      }

      if (draggingNodeId) {
          const draggedNode = nodesRef.current.find(n => n.id === draggingNodeId);
          if (draggedNode) {
              const myBounds = getNodeBounds(draggedNode);
              const otherNodes = nodesRef.current.filter(n => n.id !== draggingNodeId);

              // Resolve each AABB overlap along its shortest axis in one pass.

              for (const other of otherNodes) {
                  const otherBounds = getNodeBounds(other);

                  const isOverlapping = (
                      myBounds.x < otherBounds.r &&
                      myBounds.r > otherBounds.x &&
                      myBounds.y < otherBounds.b &&
                      myBounds.b > otherBounds.y
                  );

                  if (isOverlapping) {
                       const overlapLeft = myBounds.r - otherBounds.x;
                       const overlapRight = otherBounds.r - myBounds.x;
                       const overlapTop = myBounds.b - otherBounds.y;
                       const overlapBottom = otherBounds.b - myBounds.y;

                       const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

                       if (minOverlap === overlapLeft) {
                           draggedNode.x = otherBounds.x - myBounds.width - COLLISION_PADDING;
                       } else if (minOverlap === overlapRight) {
                           draggedNode.x = otherBounds.r + COLLISION_PADDING;
                       } else if (minOverlap === overlapTop) {
                           draggedNode.y = otherBounds.y - myBounds.height - COLLISION_PADDING;
                       } else if (minOverlap === overlapBottom) {
                           draggedNode.y = otherBounds.b + COLLISION_PADDING;
                       }

                       myBounds.x = draggedNode.x;
                       myBounds.y = draggedNode.y;
                       myBounds.r = draggedNode.x + myBounds.width;
                       myBounds.b = draggedNode.y + myBounds.height;
                  }
              }

              setNodes(prev => prev.map(n => n.id === draggingNodeId ? { ...n, x: draggedNode.x, y: draggedNode.y } : n));
          }
      }

      if (draggingNodeId || resizingNodeId || dragGroupRef.current) saveHistory();
      setIsDraggingCanvas(false); setDraggingNodeId(null); setDraggingNodeParentGroupId(null); setDraggingGroup(null); setResizingGroupId(null); setActiveGroupNodeIds([]); setResizingNodeId(null); setInitialSize(null); setResizeStartPos(null); setConnectionStart(null);
      dragNodeRef.current = null; resizeContextRef.current = null; dragGroupRef.current = null;
  }, [selectionRect, pan, scale, saveHistory, draggingNodeId, resizingNodeId]);

  useEffect(() => { window.addEventListener('mousemove', handleGlobalMouseMove); window.addEventListener('mouseup', handleGlobalMouseUp); return () => { window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp); }; }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  const handleNodeUpdate = useCallback((id: string, data: any, size?: any, title?: string) => {
      setNodes(prev => prev.map(n => {
          if (n.id === id) {
              const { status: nextStatus, ...nextData } = data || {};
              const updated = {
                ...n,
                status: nextStatus || n.status,
                data: { ...n.data, ...nextData },
                title: title || n.title,
              };
              if (size) { if (size.width) updated.width = size.width; if (size.height) updated.height = size.height; }

              if (data.image) handleAssetGenerated('image', data.image, updated.title);
              if (data.videoUri) handleAssetGenerated('video', data.videoUri, updated.title);
              if (data.audioUri) handleAssetGenerated('audio', data.audioUri, updated.title);

              return updated;
          }
          return n;
      }));
  }, [handleAssetGenerated]);

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') => {
      const file = e.target.files?.[0];
      const targetId = replacementTargetRef.current;
      if (file && targetId) {
          try {
            const result = await runtime.uploadAsset(file, targetId);
            if (type === 'image') handleNodeUpdate(targetId, { image: result });
            else handleNodeUpdate(targetId, { videoUri: result });
          } catch (error) {
            handleNodeUpdate(targetId, {
              error: error instanceof Error ? error.message : '素材上传失败',
              status: NodeStatus.ERROR,
            });
          }
      }
      e.target.value = ''; setContextMenu(null); replacementTargetRef.current = null;
  };

  const handleNodeAction = useCallback(async (id: string, promptOverride?: string) => {
      const node = nodesRef.current.find(n => n.id === id); if (!node) return;
      handleNodeUpdate(id, { error: undefined });
      setNodes(p => p.map(n => n.id === id ? { ...n, status: NodeStatus.WORKING } : n));

      try {
          const inputs = node.inputs.map(i => nodesRef.current.find(n => n.id === i)).filter(Boolean) as AppNode[];

          const upstreamTexts = inputs.map(n => {
              if (n?.type === NodeType.PROMPT_INPUT) return n.data.prompt;
              if (n?.type === NodeType.VIDEO_ANALYZER) return n.data.analysis;
              return null;
          }).filter(t => t && t.trim().length > 0) as string[];

          let prompt = promptOverride || node.data.prompt || '';
          if (upstreamTexts.length > 0) {
              const combinedUpstream = upstreamTexts.join('\n');
              prompt = prompt ? `${combinedUpstream}\n${prompt}` : combinedUpstream;
          }

          if (node.type === NodeType.IMAGE_GENERATOR) {
               const inputImages: string[] = [];
               inputs.forEach(n => { if (n?.data.image) inputImages.push(n.data.image); });

               const isStoryboard = /分镜|storyboard|sequence|shots|frames|json/i.test(prompt);

               if (isStoryboard) {
                  try {
                      const storyboard = await runtime.planStoryboard(prompt, upstreamTexts.join('\n'));
                      if (storyboard.length > 1) {
                          const newNodes: AppNode[] = [];
                          const newConnections: Connection[] = [];
                          const COLUMNS = 3;
                          const gapX = 40; const gapY = 40;
                          const childWidth = node.width || 420;
                          const ratio = node.data.aspectRatio || '16:9';
                          const [rw, rh] = ratio.split(':').map(Number);
                          const childHeight = (childWidth * rh / rw);
                          const startX = node.x + (node.width || 420) + 150;
                          const startY = node.y;
                          const totalRows = Math.ceil(storyboard.length / COLUMNS);

                          storyboard.forEach((shotPrompt, index) => {
                              const col = index % COLUMNS;
                              const row = Math.floor(index / COLUMNS);
                              const posX = startX + col * (childWidth + gapX);
                              const posY = startY + row * (childHeight + gapY);
                              const newNodeId = `n-${Date.now()}-${index}`;
                              newNodes.push({
                                  id: newNodeId, type: NodeType.IMAGE_GENERATOR, x: posX, y: posY, width: childWidth, height: childHeight,
                                  title: `分镜 ${index + 1}`, status: NodeStatus.WORKING,
                                  data: { ...node.data, aspectRatio: ratio, prompt: shotPrompt, image: undefined, images: undefined, imageCount: 1 },
                                  inputs: [node.id]
                              });
                              newConnections.push({ from: node.id, to: newNodeId });
                          });

                          const groupPadding = 30;
                          const groupWidth = (Math.min(storyboard.length, COLUMNS) * childWidth) + ((Math.min(storyboard.length, COLUMNS) - 1) * gapX) + (groupPadding * 2);
                          const groupHeight = (totalRows * childHeight) + ((totalRows - 1) * gapY) + (groupPadding * 2);

                          setGroups(prev => [...prev, { id: `g-${Date.now()}`, title: '分镜生成组', x: startX - groupPadding, y: startY - groupPadding, width: groupWidth, height: groupHeight }]);
                          setNodes(prev => [...prev, ...newNodes]);
                          setConnections(prev => [...prev, ...newConnections]);
                          handleNodeUpdate(id, { status: NodeStatus.SUCCESS });

                          newNodes.forEach(async (n) => {
                               try {
                                   const res = await runtime.generateImage(
                                     n.data.prompt!,
                                     normalizeStudioImageModel(n.data.model),
                                     inputImages,
                                     {
                                       aspectRatio: n.data.aspectRatio,
                                       resolution: n.data.resolution,
                                       count: 1,
                                       nodeId: n.id,
                                     },
                                   );
                                   handleNodeUpdate(n.id, { image: res[0], images: res, status: NodeStatus.SUCCESS });
                               } catch (e: any) {
                                   handleNodeUpdate(n.id, { error: e.message, status: NodeStatus.ERROR });
                               }
                          });
                          return;
                      }
                  } catch (e) {
                      console.warn("Storyboard planning failed", e);
                  }
               }
              const res = await runtime.generateImage(
                prompt,
                normalizeStudioImageModel(node.data.model),
                inputImages,
                {
                  aspectRatio: node.data.aspectRatio || '16:9',
                  resolution: node.data.resolution,
                  count: node.data.imageCount,
                  nodeId: node.id,
                },
              );
              handleNodeUpdate(id, { image: res[0], images: res });

          } else if (node.type === NodeType.VIDEO_GENERATOR) {

              const strategy = await getGenerationStrategy(runtime, node, inputs, prompt);

              const res = await runtime.generateVideo(
                  strategy.finalPrompt,
                  normalizeStudioVideoModel(node.data.model),
                  {
                      aspectRatio: node.data.aspectRatio || '16:9',
                      resolution: node.data.resolution || '720p',
                      count: node.data.videoCount || 1,
                      generationMode: strategy.generationMode,
                      duration: node.data.duration || 5,
                      nodeId: node.id,
                      inputImage: strategy.inputImageForGeneration,
                      referenceImages: strategy.referenceImages,
                  },
              );
              handleNodeUpdate(id, { videoUri: res.uri, videoUris: res.uris, taskId: res.taskId });

          } else if (node.type === NodeType.AUDIO_GENERATOR) {
              const audioUri = await runtime.generateAudio(prompt, { nodeId: node.id });
              handleNodeUpdate(id, { audioUri: audioUri });

          } else if (node.type === NodeType.VIDEO_ANALYZER) {
             throw new Error('视频分析尚未接入安全的平台网关，请使用主站“视频反推”功能');
          } else if (node.type === NodeType.IMAGE_EDITOR) {
             const inputImages: string[] = [];
             inputs.forEach(n => { if (n?.data.image) inputImages.push(n.data.image); });
             const img = node.data.image || inputImages[0];
             if (!img) throw new Error('请先连接或上传一张待编辑图片');
             const res = await runtime.editImage(img, prompt, normalizeStudioImageModel(node.data.model), node.id);
             handleNodeUpdate(id, { image: res });
          }
          setNodes(p => p.map(n => n.id === id ? { ...n, status: NodeStatus.SUCCESS } : n));
      } catch (e: any) {
          handleNodeUpdate(id, { error: e.message });
          setNodes(p => p.map(n => n.id === id ? { ...n, status: NodeStatus.ERROR } : n));
      }
  }, [handleNodeUpdate, runtime]);


  const saveCurrentAsWorkflow = () => {
      const thumbnailNode = nodes.find(n => n.data.image);
      const thumbnail = thumbnailNode?.data.image || '';
      const newWf: Workflow = { id: `wf-${Date.now()}`, title: `工作流 ${new Date().toLocaleDateString()}`, thumbnail, nodes: JSON.parse(JSON.stringify(nodes)), connections: JSON.parse(JSON.stringify(connections)), groups: JSON.parse(JSON.stringify(groups)) };
      setWorkflows(prev => [newWf, ...prev]);
  };

  const saveGroupAsWorkflow = (groupId: string) => {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;
      const nodesInGroup = nodes.filter(n => { const w = n.width || 420; const h = n.height || getApproxNodeHeight(n); const cx = n.x + w/2; const cy = n.y + h/2; return cx > group.x && cx < group.x + group.width && cy > group.y && cy < group.y + group.height; });
      const nodeIds = new Set(nodesInGroup.map(n => n.id));
      const connectionsInGroup = connections.filter(c => nodeIds.has(c.from) && nodeIds.has(c.to));
      const thumbNode = nodesInGroup.find(n => n.data.image);
      const thumbnail = thumbNode ? thumbNode.data.image : '';
      const newWf: Workflow = { id: `wf-${Date.now()}`, title: group.title || '未命名工作流', thumbnail: thumbnail || '', nodes: JSON.parse(JSON.stringify(nodesInGroup)), connections: JSON.parse(JSON.stringify(connectionsInGroup)), groups: [JSON.parse(JSON.stringify(group))] };
      setWorkflows(prev => [newWf, ...prev]);
  };

  const loadWorkflow = (id: string | null) => {
      if (!id) {
          setSelectedWorkflowId(null);
          return;
      }
      const wf = workflows.find(w => w.id === id);
      if (wf) { saveHistory(); setNodes(JSON.parse(JSON.stringify(wf.nodes))); setConnections(JSON.parse(JSON.stringify(wf.connections))); setGroups(JSON.parse(JSON.stringify(wf.groups))); setSelectedWorkflowId(id); }
  };

  const createBasicWorkflow = () => {
      if (nodesRef.current.length > 0 && !window.confirm('将用基础工作流替换当前画布。当前内容仍可通过撤销恢复，是否继续？')) {
          return;
      }
      const workflow = createBasicScriptToVideoWorkflow();
      saveHistory();
      setNodes(workflow.nodes);
      setConnections(workflow.connections);
      setGroups(workflow.groups);
      setSelectedWorkflowId(workflow.id);
      setSelectedNodeIds([]);
      setSelectedGroupId(null);
      setScale(1);
      setPan({ x: 80, y: 100 });
  };

  const deleteWorkflow = (id: string) => {
      if (id === STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID) return;
      setWorkflows(prev => prev.filter(w => w.id !== id));
      if (selectedWorkflowId === id) setSelectedWorkflowId(null);
  };
  const renameWorkflow = (id: string, newTitle: string) => {
      if (id === STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID) return;
      setWorkflows(prev => prev.map(w => w.id === id ? { ...w, title: newTitle } : w));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelectedNodeIds(nodesRef.current.map(n => n.id)); return; }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { const lastSelected = selectedNodeIds[selectedNodeIds.length - 1]; if (lastSelected) { const nodeToCopy = nodesRef.current.find(n => n.id === lastSelected); if (nodeToCopy) { e.preventDefault(); setClipboard(JSON.parse(JSON.stringify(nodeToCopy))); } } return; }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') { if (clipboard) { e.preventDefault(); saveHistory(); const newNode: AppNode = { ...clipboard, id: `n-${Date.now()}-${Math.floor(Math.random()*1000)}`, x: clipboard.x + 50, y: clipboard.y + 50, status: NodeStatus.IDLE, inputs: [] }; setNodes(prev => [...prev, newNode]); setSelectedNodeIds([newNode.id]); } return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedGroupId) { saveHistory(); setGroups(prev => prev.filter(g => g.id !== selectedGroupId)); setSelectedGroupId(null); return; } if (selectedNodeIds.length > 0) { deleteNodes(selectedNodeIds); } }
    };
    const handleKeyDownSpace = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        if (e.code !== 'Space' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        e.preventDefault();
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
    };
    const releaseSpacePan = () => {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
    };
    const handleKeyUpSpace = (e: KeyboardEvent) => { if (e.code === 'Space') releaseSpacePan(); };
    window.addEventListener('keydown', handleKeyDown); window.addEventListener('keydown', handleKeyDownSpace); window.addEventListener('keyup', handleKeyUpSpace);
    const handleWindowBlur = () => {
        releaseSpacePan();
        setIsDraggingCanvas(false);
    };
    window.addEventListener('blur', handleWindowBlur);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keydown', handleKeyDownSpace); window.removeEventListener('keyup', handleKeyUpSpace); window.removeEventListener('blur', handleWindowBlur); };
  }, [selectedWorkflowId, selectedNodeIds, selectedGroupId, deleteNodes, undo, saveHistory, clipboard]);

  const handleCanvasDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const handleCanvasDrop = (e: React.DragEvent) => {
      e.preventDefault();
      const dropX = (e.clientX - pan.x) / scale;
      const dropY = (e.clientY - pan.y) / scale;
      const assetData = e.dataTransfer.getData('application/json');
      const workflowId = e.dataTransfer.getData('application/workflow-id');

      if (workflowId && workflows) {
          const wf = workflows.find(w => w.id === workflowId);
          if (wf) {
              saveHistory();
              const minX = Math.min(...wf.nodes.map(n => n.x));
              const minY = Math.min(...wf.nodes.map(n => n.y));
              const width = Math.max(...wf.nodes.map(n => n.x + (n.width||420))) - minX;
              const height = Math.max(...wf.nodes.map(n => n.y + 320)) - minY;
              const offsetX = dropX - (minX + width/2);
              const offsetY = dropY - (minY + height/2);
              const idMap = new Map<string, string>();
              const newNodes: AppNode[] = wf.nodes.map(n => { const newId = `n-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`; idMap.set(n.id, newId); return { ...n, id: newId, x: n.x + offsetX, y: n.y + offsetY, status: NodeStatus.IDLE, inputs: [] }; });
              newNodes.forEach((n, i) => { const original = wf.nodes[i]; n.inputs = original.inputs.map(oldId => idMap.get(oldId)).filter(Boolean) as string[]; });
              const newConnections = wf.connections.map(c => ({ from: idMap.get(c.from)!, to: idMap.get(c.to)! })).filter(c => c.from && c.to);
              const newGroups = (wf.groups || []).map(g => ({ ...g, id: `g-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, x: g.x + offsetX, y: g.y + offsetY }));
              setNodes(prev => [...prev, ...newNodes]); setConnections(prev => [...prev, ...newConnections]); setGroups(prev => [...prev, ...newGroups]);
          }
          return;
      }
      if (assetData) {
          try {
              const asset = JSON.parse(assetData);
              if (asset && asset.type) {
                  if (asset.type === 'image') addNode(NodeType.IMAGE_GENERATOR, dropX - 210, dropY - 180, { image: asset.src, prompt: asset.title });
                  else if (asset.type === 'video') addNode(NodeType.VIDEO_GENERATOR, dropX - 210, dropY - 180, { videoUri: asset.src });
              }
              return;
          } catch (err) { console.error("Drop failed", err); }
      }

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const files = Array.from(e.dataTransfer.files) as File[];
          const validFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));

          if (validFiles.length > 0) {
              const COLS = 3;
              const GAP = 40;
              const BASE_WIDTH = 420;
              const BASE_HEIGHT = 450;

              const startX = dropX - 210;
              const startY = dropY - 180;

              validFiles.forEach((file, index) => {
                  const col = index % COLS;
                  const row = Math.floor(index / COLS);

                  const xPos = startX + (col * (BASE_WIDTH + GAP));
                  const yPos = startY + (row * BASE_HEIGHT);

                  void runtime.uploadAsset(file).then((res) => {
                      if (file.type.startsWith('image/')) {
                          addNode(NodeType.IMAGE_GENERATOR, xPos, yPos, { image: res, prompt: file.name, status: NodeStatus.SUCCESS });
                      } else if (file.type.startsWith('video/')) {
                          addNode(NodeType.VIDEO_GENERATOR, xPos, yPos, { videoUri: res, prompt: file.name, status: NodeStatus.SUCCESS });
                      }
                  }).catch(error => console.error('[studio] asset upload failed', error));
              });
          }
      }
  };

  useEffect(() => {
      document.documentElement.dataset.studioTheme = canvasTheme;
      persistStudioCanvasTheme(canvasTheme);
  }, [canvasTheme]);

  const isDarkCanvas = canvasTheme === 'dark';
  const nextCanvasTheme: StudioCanvasTheme = isDarkCanvas ? 'light' : 'dark';
  const themeToggleLabel = isDarkCanvas ? '切换浅色背景' : '切换深色背景';

  return (
    <div
      className="studio-canvas w-screen h-screen overflow-hidden"
      data-studio-theme={canvasTheme}
    >
      {saveStatus === 'error' && <div role="alert" className="fixed bottom-5 left-1/2 z-[200] -translate-x-1/2 rounded-xl bg-red-950 px-5 py-3 text-sm text-white shadow-lg">
        画布保存失败，修改仍保留在本页，请勿关闭。
        <button type="button" className="ml-3 underline" onClick={() => void saveNow()}>重试保存</button>
      </div>}
      <div className="fixed left-5 top-5 z-[160] flex items-center gap-2">
        <button
          type="button"
          onClick={() => void leaveStudio()}
          className="studio-header-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold backdrop-blur-xl transition"
        >
          <ArrowLeft size={15} />
          返回分集
        </button>
        <button
          type="button"
          aria-label={themeToggleLabel}
          aria-pressed={isDarkCanvas}
          title={themeToggleLabel}
          onClick={() => setCanvasTheme(nextCanvasTheme)}
          className="studio-header-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold backdrop-blur-xl transition"
        >
          {isDarkCanvas ? <Sun size={15} /> : <Moon size={15} />}
          {isDarkCanvas ? '浅色背景' : '深色背景'}
        </button>
        <div
          className="studio-canvas-chip studio-canvas-pan-hint pointer-events-none inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium"
          title="按住空格并拖动鼠标可移动画布"
        >
          <Hand size={14} />
          <span>按住空格拖动画布</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void leaveStudio('/credits')}
        className="studio-header-button fixed right-5 top-5 z-[160] inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold backdrop-blur-xl transition"
        title="查看创作点数明细"
        aria-label={`可用创作点数 ${creditBalance ?? '加载中'}`}
      >
        <Coins size={15} />
        <span>可用创作点数</span>
        <strong className="font-mono text-[13px]">{creditBalance ?? '--'}</strong>
      </button>
      <div
          className={`studio-canvas-content w-full h-full overflow-hidden selection:bg-cyan-500/30 ${isDraggingCanvas ? 'cursor-grabbing' : isSpacePressed ? 'cursor-grab-override' : 'cursor-default'}`}
          onMouseDownCapture={handleCanvasMouseDownCapture} onMouseDown={handleCanvasMouseDown} onWheel={handleWheel}
          onDoubleClick={(e) => { e.preventDefault(); if (e.detail > 1 && !selectionRect) { setContextMenu({ visible: true, x: e.clientX, y: e.clientY, id: '' }); setContextMenuTarget({ type: 'create' }); } }}
          onContextMenu={(e) => { e.preventDefault(); if(e.target === e.currentTarget) setContextMenu(null); }}
          onDragOver={handleCanvasDragOver} onDrop={handleCanvasDrop}
      >
          <div className="absolute inset-0 noise-bg" />
          <div className="studio-canvas-grid absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, var(--studio-grid-dot) 1px, transparent 1px)', backgroundSize: `${40 * scale}px ${40 * scale}px`, backgroundPosition: `${Math.round(pan.x)}px ${Math.round(pan.y)}px` }} />

          <div className={`absolute inset-0 flex flex-col items-center justify-center transition-all duration-700 ease-[${SPRING}] z-50 pointer-events-none ${nodes.length > 0 ? 'opacity-0 scale-105' : 'opacity-100 scale-100'}`}>
                {/* ... (Welcome Screen) ... */}
                <div className="flex flex-col items-center justify-center mb-10 select-none animate-in fade-in slide-in-from-bottom-8 duration-1000">
                    <div className="relative">
                        <div className="relative z-10 flex items-center gap-4 px-4 pb-2">
                            <img
                              src={isDarkCanvas
                                ? '/static/branding/chuangju-logo-on-dark.svg?v=20260824-chuangju-v1'
                                : '/static/branding/chuangju-logo-on-light.svg?v=20260824-chuangju-v1'}
                              alt="创剧"
                              className="h-20 w-auto max-w-[68vw] object-contain drop-shadow-sm md:h-28"
                              draggable={false}
                            />
                            <span className={`hidden text-xl font-semibold tracking-[0.28em] sm:inline md:text-2xl ${
                              isDarkCanvas ? 'text-white/70' : 'text-slate-700'
                            }`}>
                              STUDIO
                            </span>
                        </div>
                        <div className="absolute -inset-10 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-blue-500/20 blur-[60px] opacity-20 pointer-events-none mix-blend-screen"></div>
                    </div>
                    <div className="flex items-center gap-4 mt-4">
                        <div className="h-px w-12 bg-gradient-to-r from-transparent to-zinc-600"></div>
                        <span className="text-[11px] font-bold tracking-[0.6em] text-zinc-500 uppercase">Welcome</span>
                        <div className="h-px w-12 bg-gradient-to-l from-transparent to-zinc-600"></div>
                    </div>
                </div>

                <div className="flex items-center gap-2 mb-6 text-zinc-500 text-xs font-medium tracking-wide opacity-60">
                    <div className="studio-canvas-chip px-1.5 py-0.5 rounded-md text-[10px] flex items-center gap-1">
                        <MousePointerClick size={10} />
                        <span>双击</span>
                    </div>
                    <span>画布自由生成，或查看工作流模板</span>
                </div>

                <div className={`studio-welcome-actions flex items-center gap-1.5 p-1.5 rounded-[18px] backdrop-blur-xl shadow-2xl ${nodes.length > 0 ? 'pointer-events-none' : 'pointer-events-auto'}`}>
                    <button onClick={createBasicWorkflow} className="studio-welcome-action flex items-center gap-2.5 px-5 py-3 rounded-[14px] bg-cyan-500/15 transition-all group shadow-sm hover:shadow-md hover:-translate-y-0.5 duration-300">
                        <LayoutTemplate size={16} className="text-cyan-400" />
                        <span className="text-[13px] font-medium tracking-wide">一键创建基础工作流</span>
                    </button>

                    <button onClick={() => addNode(NodeType.IMAGE_GENERATOR)} className="studio-welcome-action flex items-center gap-2.5 px-5 py-3 rounded-[14px] transition-all group shadow-sm hover:shadow-md hover:-translate-y-0.5 duration-300">
                        <ImageIcon size={16} className="text-zinc-500 transition-colors group-hover:text-cyan-400" />
                        <span className="text-[13px] font-medium tracking-wide">文字生图</span>
                    </button>

                     <button onClick={() => addNode(NodeType.VIDEO_GENERATOR)} className="studio-welcome-action flex items-center gap-2.5 px-5 py-3 rounded-[14px] transition-all group shadow-sm hover:shadow-md hover:-translate-y-0.5 duration-300">
                        <Film size={16} className="text-zinc-500 transition-colors group-hover:text-purple-400" />
                        <span className="text-[13px] font-medium tracking-wide">文生视频</span>
                    </button>

                    <button onClick={() => addNode(NodeType.VIDEO_GENERATOR, undefined, undefined, { generationMode: 'FIRST_LAST_FRAME' })} className="studio-welcome-action flex items-center gap-2.5 px-5 py-3 rounded-[14px] transition-all group shadow-sm hover:shadow-md hover:-translate-y-0.5 duration-300">
                        <Link size={16} className="text-zinc-500 transition-colors group-hover:text-emerald-400" />
                        <span className="text-[13px] font-medium tracking-wide">首尾帧</span>
                    </button>
                </div>
            </div>

          <input type="file" ref={replaceVideoInputRef} className="hidden" accept="video/*" onChange={(e) => handleReplaceFile(e, 'video')} />
          <input type="file" ref={replaceImageInputRef} className="hidden" accept="image/*" onChange={(e) => handleReplaceFile(e, 'image')} />

          <div
            style={{ position: 'absolute', left: Math.round(pan.x), top: Math.round(pan.y), width: '100%', height: '100%' }}
            className="w-full h-full"
          >
            <div style={{ zoom: scale === 1 ? undefined : scale, width: '100%', height: '100%' }} className="relative w-full h-full">
              {/* Groups Layer */}
              {groups.map(g => (
                  <div
                      key={g.id}
                      data-selected={selectedGroupId === g.id}
                      className={`studio-group absolute rounded-[32px] border transition-all ${(draggingGroup?.id === g.id || draggingNodeParentGroupId === g.id) ? 'duration-0' : 'duration-300'} ${selectedGroupId === g.id ? 'border-cyan-500/30 bg-cyan-500/5' : ''}`}
                      style={{ left: g.x, top: g.y, width: g.width, height: g.height }}
                      onMouseDown={(e) => {
                          e.stopPropagation(); setSelectedGroupId(g.id);
                          const childNodes = nodes.filter(n => { const b = getNodeBounds(n); const cx = b.x + b.width/2; const cy = b.y + b.height/2; return cx>g.x && cx<g.x+g.width && cy>g.y && cy<g.y+g.height; }).map(n=>({id:n.id, startX:n.x, startY:n.y}));
                          dragGroupRef.current = { id: g.id, startX: g.x, startY: g.y, mouseStartX: e.clientX, mouseStartY: e.clientY, childNodes };
                          setActiveGroupNodeIds(childNodes.map(c => c.id)); setDraggingGroup({ id: g.id });
                      }}
                      onContextMenu={e => { e.stopPropagation(); setContextMenu({visible:true, x:e.clientX, y:e.clientY, id:g.id}); setContextMenuTarget({type:'group', id:g.id}); }}
                  >
                      <div className="studio-group-label absolute -top-8 left-4 text-xs font-bold uppercase tracking-widest">{g.title}</div>
                  </div>
              ))}

              {/* Connections Layer */}
              <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-0" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
                  {connections.map((conn) => {
                      const f = nodes.find(n => n.id === conn.from), t = nodes.find(n => n.id === conn.to);
                      if (!f || !t) return null;
                      const fHeight = f.height || getApproxNodeHeight(f); const tHeight = t.height || getApproxNodeHeight(t);
                      const fx = f.x + (f.width||420) + 3; let fy = f.y + fHeight/2; const tx = t.x - 3; let ty = t.y + tHeight/2;
                      if (Math.abs(fy - ty) < 0.5) ty += 0.5;
                      if (isNaN(fx) || isNaN(fy) || isNaN(tx) || isNaN(ty)) return null;
                      const d = `M ${fx} ${fy} C ${fx + (tx-fx)*0.5} ${fy} ${tx - (tx-fx)*0.5} ${ty} ${tx} ${ty}`;
                      return (
                          <g key={`${conn.from}-${conn.to}`} className="pointer-events-auto group/line">
                              <path d={d} stroke="url(#gradient)" strokeWidth="3" fill="none" strokeOpacity="0.5" className="transition-colors duration-300 group-hover/line:stroke-white group-hover/line:stroke-opacity-40" />
                              <path d={d} stroke="transparent" strokeWidth="15" fill="none" style={{ cursor: 'pointer' }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, id: `${conn.from}-${conn.to}` }); setContextMenuTarget({ type: 'connection', from: conn.from, to: conn.to }); }} />
                          </g>
                      );
                  })}
                  <defs><linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#22d3ee" stopOpacity="0.5" /><stop offset="100%" stopColor="#a855f7" stopOpacity="0.5" /></linearGradient></defs>
                  {connectionStart && (() => {
                      let startX = 0, startY = 0;
                      if (connectionStart.id === 'smart-sequence-dock') {
                          startX = (connectionStart.x - pan.x) / scale; startY = (connectionStart.y - pan.y) / scale;
                      } else {
                          const startNode = nodes.find(n => n.id === connectionStart.id); if (!startNode) return null;
                          const startHeight = startNode.height || getApproxNodeHeight(startNode); startX = startNode.x + (startNode.width || 420) + 3; startY = startNode.y + startHeight / 2;
                      }
                      const endX = (mousePos.x - pan.x) / scale; const endY = (mousePos.y - pan.y) / scale;
                      return <path d={`M ${startX} ${startY} L ${endX} ${endY}`} stroke="var(--studio-connection)" strokeWidth="2" strokeDasharray="4,4" fill="none" />;
                  })()}
              </svg>

              {nodes.map(node => (
              <Node
                  key={node.id} node={node} onUpdate={handleNodeUpdate} onAction={handleNodeAction} onDelete={(id) => deleteNodes([id])} onExpand={setExpandedMedia} onCrop={(id, img) => { setCroppingNodeId(id); setImageToCrop(img); }}
                  onNodeMouseDown={(e, id) => {
                      e.stopPropagation();
                      if (e.shiftKey || e.metaKey || e.ctrlKey) { setSelectedNodeIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]); } else { setSelectedNodeIds([id]); }
                      const n = nodes.find(x => x.id === id);
                      if (n) {
                          const w = n.width || 420; const h = n.height || getApproxNodeHeight(n); const cx = n.x + w/2; const cy = n.y + 160;
                          const pGroup = groups.find(g => { return cx > g.x && cx < g.x + g.width && cy > g.y && cy < g.y + g.height; });
                          let siblingNodeIds: string[] = [];
                          if (pGroup) { siblingNodeIds = nodes.filter(other => { if (other.id === id) return false; const b = getNodeBounds(other); const ocx = b.x + b.width/2; const ocy = b.y + b.height/2; return ocx > pGroup.x && ocx < pGroup.x + pGroup.width && ocy > pGroup.y && ocy < pGroup.y + pGroup.height; }).map(s => s.id); }
                          dragNodeRef.current = { id, startX: n.x, startY: n.y, mouseStartX: e.clientX, mouseStartY: e.clientY, parentGroupId: pGroup?.id, siblingNodeIds, nodeWidth: w, nodeHeight: h };
                          setDraggingNodeParentGroupId(pGroup?.id || null); setDraggingNodeId(id);
                      }
                  }}
                  onPortMouseDown={(e, id, type) => { e.stopPropagation(); setConnectionStart({ id, x: e.clientX, y: e.clientY }); }}
                  onPortMouseUp={(e, id, type) => {
                      e.stopPropagation();
                      const start = connectionStartRef.current;
                      if (start && start.id !== id) {
                          if (start.id === 'smart-sequence-dock') { } else { setConnections(p => [...p, { from: start.id, to: id }]); setNodes(p => p.map(n => n.id === id ? { ...n, inputs: [...n.inputs, start.id] } : n)); }
                      }
                      setConnectionStart(null);
                  }}
                  onNodeContextMenu={(e, id) => { e.stopPropagation(); e.preventDefault(); setContextMenu({ visible: true, x: e.clientX, y: e.clientY, id }); setContextMenuTarget({ type: 'node', id }); }}
                  onResizeMouseDown={(e, id, w, h) => {
                      e.stopPropagation(); const n = nodes.find(x => x.id === id);
                      if (n) {
                          const cx = n.x + w/2; const cy = n.y + 160;
                          const pGroup = groups.find(g => { return cx > g.x && cx < g.x + g.width && cy > g.y && cy < g.y + g.height; });
                          setDraggingNodeParentGroupId(pGroup?.id || null);
                          let siblingNodeIds: string[] = [];
                          if (pGroup) { siblingNodeIds = nodes.filter(other => { if (other.id === id) return false; const b = getNodeBounds(other); const ocx = b.x + b.width/2; const ocy = b.y + b.height/2; return ocx > pGroup.x && ocx < pGroup.x + pGroup.width && ocy > pGroup.y && ocy < pGroup.y + pGroup.height; }).map(s => s.id); }
                          resizeContextRef.current = { nodeId: id, initialWidth: w, initialHeight: h, startX: e.clientX, startY: e.clientY, parentGroupId: pGroup?.id || null, siblingNodeIds };
                      }
                      setResizingNodeId(id); setInitialSize({ width: w, height: h }); setResizeStartPos({ x: e.clientX, y: e.clientY });
                  }}
                  isSelected={selectedNodeIds.includes(node.id)}
                  inputAssets={node.inputs.map(i => nodes.find(n => n.id === i)).filter(n => n && (n.data.image || n.data.videoUri || n.data.croppedFrame)).slice(0, 6).map(n => ({ id: n!.id, type: (n!.data.croppedFrame || n!.data.image) ? 'image' : 'video', src: n!.data.croppedFrame || n!.data.image || n!.data.videoUri! }))}
                  onInputReorder={(nodeId, newOrder) => { const node = nodes.find(n => n.id === nodeId); if (node) { setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, inputs: newOrder } : n)); } }}
                  isDragging={draggingNodeId === node.id} isResizing={resizingNodeId === node.id} isConnecting={!!connectionStart} isGroupDragging={activeGroupNodeIds.includes(node.id)}
              />
              ))}

              {selectionRect && <div className="absolute border border-cyan-500/40 bg-cyan-500/10 rounded-lg pointer-events-none" style={{ left: (Math.min(selectionRect.startX, selectionRect.currentX) - pan.x) / scale, top: (Math.min(selectionRect.startY, selectionRect.currentY) - pan.y) / scale, width: Math.abs(selectionRect.currentX - selectionRect.startX) / scale, height: Math.abs(selectionRect.currentY - selectionRect.startY) / scale }} />}
            </div>
          </div>

          {contextMenu && (
              <div className="studio-node-menu fixed z-[100] backdrop-blur-xl rounded-2xl shadow-2xl p-1.5 min-w-[160px] animate-in fade-in zoom-in-95 duration-200 origin-top-left" style={{ top: contextMenu.y, left: contextMenu.x }} onMouseDown={(e) => e.stopPropagation()}>
                  {contextMenuTarget?.type === 'node' && (
                      <>
                          <button className="studio-node-menu-item w-full text-left px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-2 transition-colors" onClick={() => { const targetNode = nodes.find(n => n.id === contextMenu.id); if (targetNode) setClipboard(JSON.parse(JSON.stringify(targetNode))); setContextMenu(null); }}>
                              <Copy size={12} /> 复制节点
                          </button>
                          {(() => { const targetNode = nodes.find(n => n.id === contextMenu.id); if (targetNode) { const isVideo = targetNode.type === NodeType.VIDEO_GENERATOR || targetNode.type === NodeType.VIDEO_ANALYZER; const isImage = targetNode.type === NodeType.IMAGE_GENERATOR || targetNode.type === NodeType.IMAGE_EDITOR; if (isVideo || isImage) { return ( <button className="studio-node-menu-item w-full text-left px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-2 transition-colors" onClick={() => { replacementTargetRef.current = contextMenu.id || null; if (isVideo) replaceVideoInputRef.current?.click(); else replaceImageInputRef.current?.click(); setContextMenu(null); }}> <RefreshCw size={12} /> 替换素材 </button> ); } } return null; })()}
                          <button className="w-full text-left px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 rounded-lg flex items-center gap-2 transition-colors mt-1" onClick={() => { deleteNodes([contextMenuTarget.id]); setContextMenu(null); }}><Trash2 size={12} /> 删除节点</button>
                      </>
                  )}
                  {contextMenuTarget?.type === 'create' && (
                      <>
                          <div className="studio-node-muted px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider">创建新节点</div>
                          {[NodeType.PROMPT_INPUT, NodeType.IMAGE_GENERATOR, NodeType.VIDEO_GENERATOR, NodeType.AUDIO_GENERATOR, NodeType.IMAGE_EDITOR].map(t => { const ItemIcon = getNodeIcon(t); return ( <button key={t} className="studio-node-menu-item w-full text-left px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-2.5 transition-colors" onClick={() => { addNode(t, (contextMenu.x-pan.x)/scale, (contextMenu.y-pan.y)/scale); setContextMenu(null); }}> <ItemIcon size={12} className="text-cyan-400" /> {getNodeNameCN(t)} </button> ); })}
                      </>
                  )}
                  {contextMenuTarget?.type === 'group' && (
                      <>
                           <button className="studio-node-menu-item w-full text-left px-3 py-2 text-xs font-medium rounded-lg flex items-center gap-2 transition-colors mb-1" onClick={() => { if (contextMenu.id) saveGroupAsWorkflow(contextMenu.id); setContextMenu(null); }}> <FolderHeart size={12} className="text-cyan-400" /> 保存为工作流 </button>
                           <button className="w-full text-left px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 rounded-lg flex items-center gap-2 transition-colors" onClick={() => { setGroups(p => p.filter(g => g.id !== contextMenu.id)); setContextMenu(null); }}> <Trash2 size={12} /> 删除分组 </button>
                      </>
                  )}
                  {contextMenuTarget?.type === 'connection' && (
                      <button className="w-full text-left px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 rounded-lg flex items-center gap-2 transition-colors" onClick={() => { setConnections(prev => prev.filter(c => c.from !== contextMenuTarget.from || c.to !== contextMenuTarget.to)); setNodes(prev => prev.map(n => n.id === contextMenuTarget.to ? { ...n, inputs: n.inputs.filter(i => i !== contextMenuTarget.from) } : n)); setContextMenu(null); }}> <Unplug size={12} /> 删除连接线 </button>
                  )}
              </div>
          )}

          {croppingNodeId && imageToCrop && <ImageCropper imageSrc={imageToCrop} onCancel={() => {setCroppingNodeId(null); setImageToCrop(null);}} onConfirm={(b) => {
            const nodeId = croppingNodeId;
            void runtime.uploadDataUrl(b, `studio-crop-${nodeId}.png`, nodeId)
              .then(url => handleNodeUpdate(nodeId, {croppedFrame: url}))
              .catch(error => handleNodeUpdate(nodeId, { error: error instanceof Error ? error.message : '裁剪结果上传失败' }));
            setCroppingNodeId(null);
            setImageToCrop(null);
          }} />}
          <ExpandedView media={expandedMedia} onClose={() => setExpandedMedia(null)} />
          {isSketchEditorOpen && <SketchEditor onClose={() => setIsSketchEditorOpen(false)} onGenerate={handleSketchResult} />}
          <SmartSequenceDock
             isOpen={isMultiFrameOpen}
             onClose={() => setIsMultiFrameOpen(false)}
             onGenerate={handleMultiFrameGenerate}
             onConnectStart={(e, type) => { e.preventDefault(); e.stopPropagation(); setConnectionStart({ id: 'smart-sequence-dock', x: e.clientX, y: e.clientY }); }}
          />
          <SonicStudio
            isOpen={isSonicStudioOpen}
            onClose={() => setIsSonicStudioOpen(false)}
            history={assetHistory.filter(a => a.type === 'audio')}
            onGenerate={(src, prompt) => handleAssetGenerated('audio', src, prompt)}
          />
          <SidebarDock
              onAddNode={addNode}
              onUndo={undo}
              isChatOpen={isChatOpen}
              onToggleChat={() => setIsChatOpen(!isChatOpen)}
              isMultiFrameOpen={isMultiFrameOpen}
              onToggleMultiFrame={() => setIsMultiFrameOpen(!isMultiFrameOpen)}
              isSonicStudioOpen={isSonicStudioOpen}
              onToggleSonicStudio={() => setIsSonicStudioOpen(!isSonicStudioOpen)}
              assetHistory={assetHistory}
              onHistoryItemClick={(item) => { const type = item.type.includes('image') ? NodeType.IMAGE_GENERATOR : NodeType.VIDEO_GENERATOR; const data = item.type === 'image' ? { image: item.src } : { videoUri: item.src }; addNode(type, undefined, undefined, data); }}
              onDeleteAsset={(id) => setAssetHistory(prev => prev.filter(a => a.id !== id))}
              workflows={workflows}
              selectedWorkflowId={selectedWorkflowId}
              onSelectWorkflow={loadWorkflow}
              onCreateBasicWorkflow={createBasicWorkflow}
              onSaveWorkflow={saveCurrentAsWorkflow}
              onDeleteWorkflow={deleteWorkflow}
              onRenameWorkflow={renameWorkflow}
          />

          <AssistantPanel isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

          <div className="studio-canvas-toolbar absolute bottom-8 right-8 flex items-center gap-3 px-4 py-2 backdrop-blur-2xl rounded-full z-50 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <button onClick={() => setScale(s => snapCanvasScale(Math.max(MIN_CANVAS_SCALE, s - 0.1)))} className="studio-canvas-toolbar-button p-1.5 transition-colors rounded-full"><Minus size={14} strokeWidth={3} /></button>
              <div className="flex items-center gap-2 min-w-[100px]">
                   <input type="range" min={MIN_CANVAS_SCALE} max={MAX_CANVAS_SCALE} step="0.05" value={scale} onChange={(e) => setScale(snapCanvasScale(parseFloat(e.target.value)))} className="studio-canvas-toolbar-range w-24 h-1 rounded-full cursor-pointer" />
                   <span className="studio-canvas-toolbar-button text-[10px] font-bold w-8 text-right tabular-nums cursor-pointer" onClick={() => setScale(1)} title="Reset Zoom">{Math.round(scale * 100)}%</span>
              </div>
              <button onClick={() => setScale(s => snapCanvasScale(Math.min(MAX_CANVAS_SCALE, s + 0.1)))} className="studio-canvas-toolbar-button p-1.5 transition-colors rounded-full"><Plus size={14} strokeWidth={3} /></button>
              <button onClick={handleFitView} className="studio-canvas-toolbar-button p-1.5 transition-colors rounded-full ml-2 border-l pl-3" title="适配视图">
                  <Scan size={14} strokeWidth={3} />
              </button>
          </div>
      </div>
    </div>
  );
};
