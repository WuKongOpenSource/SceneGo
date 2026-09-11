

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ProjectFile, StoryboardItem, FileVersion, ScriptStoryboardVersion } from '../types';
import { LayoutDashboard, Film, Image as ImageIcon, Copy, Users, MapPin, Download, RefreshCw, Lock, Unlock, Trash2, PlusCircle, AlertOctagon, MessageSquare, Edit2, Check, X, Undo2, Redo2, ArrowRight, Save, History, Clock, Plus, FolderInput, Sparkles, CheckCircle, Box, Coins, LoaderCircle } from 'lucide-react';
import { buildStoryboardSegmentGroups, buildStoryboardSegmentLookup } from '../utils/storyboardSegments';
import { getVersionStoryboardSnapshots } from '../utils/storyboardSnapshots';
import { formatScriptModelHistoryLabel } from '../services/scriptModelCatalogService';

interface StoryboardColumnProps {
  selectedFile: ProjectFile | undefined;
  onGenerateStoryboard: (fileId: string) => Promise<void>;
  isProcessing: boolean;


  generationProgress: { current: number; total: number } | null;
  processingType?: 'rewrite' | 'generate-shots' | null;
  aiModel?: any;

  isExpanded: boolean;
  onToggleExpand: () => void;
  onHighlightScript: (selectedIds: Set<string>) => void;
  highlightedItemIds: Set<string>;
  onLockItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onRegenerateItem: (id: string, instruction?: string) => void;
  onUpdateItem: (id: string, updates: Partial<StoryboardItem>) => void;
  onExport: () => void;
  isExporting?: boolean;
  isWorkflowScript?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onSaveVersion: (name: string) => Promise<void> | void;
  onRestoreStoryboard: (version: FileVersion) => void;
  onDeleteVersion: (versionId: string) => Promise<void> | void;
  scriptVersions?: ScriptStoryboardVersion[];
  currentScriptVersionId?: string;
  generationCreditCost?: number;
  onRestoreScriptVersion?: (version: ScriptStoryboardVersion) => void;
  onImportProject?: () => void;
  onInsertShot: (position: number, shotData: Omit<StoryboardItem, 'id'>) => Promise<void>;
  onInsertShotWithAI: (position: number, originalText: string) => Promise<void>;
  onClose?: () => void;
  cardMode?: boolean;

}

export const StoryboardColumn: React.FC<StoryboardColumnProps> = ({
  selectedFile,
  processingType,
  onGenerateStoryboard,
  onHighlightScript,
  highlightedItemIds,
  onLockItem,
  onDeleteItem,
  onRegenerateItem,
  onUpdateItem,
  onExport,
  isExporting,
  isWorkflowScript = false,
  isProcessing,


  generationProgress,
  aiModel,

  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSaveVersion,
  onRestoreStoryboard,
  onDeleteVersion,
  scriptVersions = [],
  currentScriptVersionId,
  generationCreditCost,
  onRestoreScriptVersion,
  onImportProject,
  onInsertShot,
  onInsertShotWithAI,
  onClose,
  cardMode = false,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [regenInputId, setRegenInputId] = useState<string | null>(null);
  const [regenInstruction, setRegenInstruction] = useState('');

  const [showHistory, setShowHistory] = useState(false);
  const [isNamingVersion, setIsNamingVersion] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [isSavingVersion, setIsSavingVersion] = useState(false);



  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<Array<{
    id: string;
    name: string;
    config: {
      userRequirements?: string;
      defaultStyle?: string;
      aspectRatio?: string;
      imageSize?: string;
    };
    timestamp: number;
  }>>([]);
  const [currentTemplate, setCurrentTemplate] = useState<string>('');


  useEffect(() => {
    const saved = localStorage.getItem('storyboard_templates');
    if (saved) {
      try {
        setSavedTemplates(JSON.parse(saved));
      } catch (e) {
        console.error('加载模板失败:', e);
      }
    }
  }, []);


  const saveTemplate = (name: string, config: any) => {
    const newTemplate = {
      id: Date.now().toString(),
      name,
      config,
      timestamp: Date.now()
    };
    const updated = [...savedTemplates, newTemplate];
    setSavedTemplates(updated);
    localStorage.setItem('storyboard_templates', JSON.stringify(updated));
    console.log('✅ 模板已保存:', name);
  };

  const [addingTagToItem, setAddingTagToItem] = useState<string | null>(null);
  const [tagInputType, setTagInputType] = useState<'character' | 'scene' | 'prop'>('character');
  const [tagInputValue, setTagInputValue] = useState('');


  const [showInsertModal, setShowInsertModal] = useState(false);
  const [insertPosition, setInsertPosition] = useState<number>(-1);
  const [insertMode, setInsertMode] = useState<'manual' | 'ai'>('manual');
  const [showScriptSelector, setShowScriptSelector] = useState(false);
  const [newShotData, setNewShotData] = useState({
    originalText: '',
    scriptSegment: '',
    imagePrompt: '',
    videoPrompt: '',
    dialogue: '',
    characters: '',
    scene: '',
    props: ''
  });


  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const loadingSteps = [
    'AI正在分析剧本结构',
    '正在做文本映射',
    '正在提取场景信息',
    '正在提取人物角色',
    '正在生成视频提示词',
    '正在生成图像提示词',
    '正在优化镜头衔接',
    '正在完善分镜细节'
  ];


  useEffect(() => {
    if (isProcessing) {
      setLoadingStepIndex(0);
      const interval = setInterval(() => {
        setLoadingStepIndex(prev => (prev + 1) % loadingSteps.length);
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [isProcessing]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };


  useEffect(() => {
    if (highlightedItemIds.size > 0) {
      const firstId = Array.from(highlightedItemIds)[0];
      const container = scrollContainerRef.current;
      const target = itemRefs.current.get(firstId);
      if (!container || !target) return;

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const centeredTop = container.scrollTop
        + targetRect.top
        - containerRect.top
        - Math.max(0, (container.clientHeight - targetRect.height) / 2);
      const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTo({
        top: Math.min(Math.max(0, centeredTop), maxScrollTop),
        behavior: 'smooth',
      });
    }
  }, [highlightedItemIds]);

  const handleCardClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();

    const newSet = new Set(highlightedItemIds);
    if (e.metaKey || e.ctrlKey) {
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
    } else {
        if (newSet.has(id) && newSet.size === 1) {

        } else {
            newSet.clear();
            newSet.add(id);
        }
    }

    onHighlightScript(newSet);

  };


  const handleOpenInsertModal = (position: number) => {
    setInsertPosition(position);
    setShowInsertModal(true);
    setInsertMode('manual');
    setNewShotData({
      originalText: '',
      scriptSegment: '',
      imagePrompt: '',
      videoPrompt: '',
      dialogue: '',
      characters: '',
      scene: '',
      props: ''
    });
  };


  const handleInsertShot = async () => {
    if (!newShotData.originalText.trim()) {
      alert('请填写对应的原文段落');
      return;
    }

    if (insertMode === 'manual') {

      if (!newShotData.scriptSegment.trim()) {
        alert('请填写场景描述');
        return;
      }

      await onInsertShot(insertPosition, {
        originalText: newShotData.originalText.trim(),
        scriptSegment: newShotData.scriptSegment.trim(),
        imagePrompt: newShotData.imagePrompt.trim(),
        videoPrompt: newShotData.videoPrompt.trim(),
        dialogue: newShotData.dialogue.trim(),
        characters: newShotData.characters.split(',').map(c => c.trim()).filter(c => c),
        scene: newShotData.scene.trim(),
        props: newShotData.props.split(',').map(p => p.trim()).filter(p => p)
      });
    } else {

      await onInsertShotWithAI(insertPosition, newShotData.originalText.trim());
    }

    setShowInsertModal(false);
  };

  const handleStartRegen = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setRegenInputId(id);
      setRegenInstruction('');
  };

  const handleConfirmRegen = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      onRegenerateItem(id, regenInstruction);
      setRegenInputId(null);
  };

  const handleCancelRegen = (e: React.MouseEvent) => {
      e.stopPropagation();
      setRegenInputId(null);
  };

  const handleSaveClick = () => {
      setIsNamingVersion(true);
      const count = selectedFile?.versions?.length || 0;
      setVersionName(`镜头设计存档 v${count + 1} - ${new Date().toLocaleTimeString('zh-CN', {hour: '2-digit', minute:'2-digit'})}`);
  };

  const submitVersionSave = async () => {
      if (!versionName.trim() || isSavingVersion) return;
      setIsSavingVersion(true);
      try {
          await onSaveVersion(versionName.trim());
          setIsNamingVersion(false);
      } catch (error) {
          console.error('保存镜头设计版本失败:', error);
          alert(`保存失败：${error instanceof Error ? error.message : String(error)}`);
      } finally {
          setIsSavingVersion(false);
      }
  };

  const handleAddTagClick = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setAddingTagToItem(id);
      setTagInputType('character');
      setTagInputValue('');
  };

  const submitAddTag = (item: StoryboardItem) => {
      if (!tagInputValue.trim()) {
          setAddingTagToItem(null);
          return;
      }

      if (tagInputType === 'character') {
          if (!item.characters.includes(tagInputValue.trim())) {
             onUpdateItem(item.id, { characters: [...item.characters, tagInputValue.trim()] });
          }
      } else if (tagInputType === 'scene') {
          onUpdateItem(item.id, { scene: tagInputValue.trim() });
      } else {
          const currentProps = item.props || [];
          if (!currentProps.includes(tagInputValue.trim())) {
             onUpdateItem(item.id, { props: [...currentProps, tagInputValue.trim()] });
          }
      }
      setAddingTagToItem(null);
      setTagInputValue('');
  };

  const handleRemoveCharacter = (e: React.MouseEvent, item: StoryboardItem, charName: string) => {
      e.stopPropagation();
      if (confirm(`确定删除角色标签 "${charName}" 吗？`)) {
          onUpdateItem(item.id, { characters: item.characters.filter(c => c !== charName) });
      }
  };

  const handleRemoveProp = (e: React.MouseEvent, item: StoryboardItem, propName: string) => {
      e.stopPropagation();
      if (confirm(`确定删除道具标签 "${propName}" 吗？`)) {
          onUpdateItem(item.id, { props: (item.props || []).filter(p => p !== propName) });
      }
  };

  const segmentGroups = useMemo(
    () => buildStoryboardSegmentGroups(
      selectedFile?.storyboard?.items || [],
      selectedFile?.scriptSegments || [],
    ),
    [selectedFile?.scriptSegments, selectedFile?.storyboard?.items],
  );
  const segmentLookup = useMemo(
    () => buildStoryboardSegmentLookup(
      selectedFile?.storyboard?.items || [],
      selectedFile?.scriptSegments || [],
    ),
    [selectedFile?.scriptSegments, selectedFile?.storyboard?.items],
  );
  const storyboardPromptStage = selectedFile?.generationStages?.storyboardPrompt;
  const isStoryboardPromptRunning = storyboardPromptStage?.status === 'running';

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-n0" data-card-mode={cardMode || undefined}>
       <div className={`flex h-14 flex-shrink-0 items-center justify-between bg-n0 px-4 ${cardMode ? 'border-b border-n40/70' : 'border-b border-n40'}`}>
            <h2 className="text-sm font-semibold text-n700 flex items-center gap-2">
                镜头设计
            </h2>
             <div className="flex items-center gap-2">


                 {/* Version Controls - Always visible if file selected */}
                 <div className={`mr-1 flex items-center gap-2 pr-2 ${cardMode ? '' : 'border-r border-n40'}`}>
                     <button
                         onClick={handleSaveClick}
                         disabled={!selectedFile}
                         className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-n700 hover:text-white bg-n0 hover:bg-primary rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                         title="保存当前分镜版本"
                     >
                         <Save className="w-3.5 h-3.5" />
                         <span>保存</span>
                     </button>

                     <button
                         onClick={() => setShowHistory(!showHistory)}
                         disabled={!selectedFile}
                         className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed
                            ${showHistory ? 'bg-primary text-white' : 'bg-n0 text-n700 hover:text-n800 hover:bg-n20'}`}
                         title="查看历史版本"
                     >
                         <History className="w-3.5 h-3.5" />
                         <span>历史版本</span>
                     </button>
                 </div>

                 {/* Undo/Redo */}
                 <div className={`flex items-center gap-1 pr-2 ${cardMode ? '' : 'border-r border-n40'}`}>
                     <button onClick={onUndo} disabled={!canUndo} className="p-1.5 text-n100 hover:text-n800 disabled:opacity-30 rounded hover:bg-n20">
                         <Undo2 className="w-4 h-4" />
                     </button>
                     <button onClick={onRedo} disabled={!canRedo} className="p-1.5 text-n100 hover:text-n800 disabled:opacity-30 rounded hover:bg-n20">
                         <Redo2 className="w-4 h-4" />
                     </button>
                 </div>

                {selectedFile?.storyboard && (
                    <>
                    <button
                        onClick={onExport}
                        disabled={isExporting}
                        title={isWorkflowScript ? '将本集采用剧本导出到后续流程' : '导出时会自动设为本集主剧本'}
                        className={`flex items-center gap-1 text-[10px] text-white px-3 py-1.5 rounded shadow-sm transition-colors font-semibold ${isExporting ? 'bg-n100 cursor-not-allowed' : 'bg-primary hover:bg-primary-hover'}`}
                    >
                        {isExporting ? '正在导出...' : '导出到角色和场景'}
                        {!isExporting && <ArrowRight className="w-3 h-3" />}
                      </button>
                    </>
                )}
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    title="关闭镜头设计"
                    aria-label="关闭镜头设计"
                    className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded text-n300 hover:bg-n20 hover:text-n800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
            </div>
      </div>


      <div className={`flex h-[52px] items-center bg-n0 px-3 ${cardMode ? '' : 'border-b border-n40'}`}>
        {selectedFile?.storyboard ? (
          <div className="w-full flex items-center gap-2 px-3 py-2 bg-primary-light border border-primary rounded-lg text-xs text-primary">
            <Film className="w-4 h-4" />
            <span>共 {segmentGroups.length} 个分段 · {selectedFile.storyboard.items.filter(i => !i.isPlaceholder).length} 个镜头</span>
            {Number.isFinite(generationCreditCost) && Number(generationCreditCost) > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 rounded border border-warning/30 bg-y50 px-2 py-1 text-[10px] font-medium text-warning" title="当前版本剧本生成与镜头设计生成合计扣除创作点数">
                <Coins className="h-3.5 w-3.5" /> 本次消耗 {generationCreditCost} 创作点数
              </span>
            )}
          </div>
        ) : (
          <div className="flex w-full items-center justify-center">
            <div
              className={`inline-flex min-w-[190px] items-center justify-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                isStoryboardPromptRunning
                  ? 'border-primary/30 bg-primary-light text-primary shadow-sm'
                  : 'border-n40 bg-n20 text-n100'
              }`}
            >
              {isStoryboardPromptRunning && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              <span>
                {isStoryboardPromptRunning
                  ? `正在生成镜头设计 ${storyboardPromptStage?.completed ?? 0}/${storyboardPromptStage?.total ?? '?'}`
                  : '等待镜头设计生成…'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Save Version Modal/Popover */}
      {isNamingVersion && (
          <div className="absolute top-14 right-4 z-50 bg-n0 border border-n40 shadow-bottom rounded-lg p-3 w-64 animate-in fade-in slide-in-from-top-2">
              <h4 className="text-xs font-bold text-n700 mb-1">保存当前版本</h4>
              <p className="text-[10px] text-n100 mb-2">每次保存都会创建独立存档，不覆盖已有版本</p>
              <input
                  type="text"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs text-n800 mb-2 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  autoFocus
                  onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitVersionSave();
                      if (e.key === 'Escape') setIsNamingVersion(false);
                  }}
              />
              <div className="flex gap-2">
                  <button disabled={isSavingVersion} onClick={() => setIsNamingVersion(false)} className="flex-1 py-1 bg-n30 text-n700 text-xs rounded hover:bg-n20 disabled:opacity-50">取消</button>
                  <button disabled={isSavingVersion} onClick={() => void submitVersionSave()} className="flex-1 py-1 bg-primary text-white text-xs rounded hover:bg-primary-hover disabled:opacity-50">
                    {isSavingVersion ? '保存中...' : '确认保存'}
                  </button>
              </div>
          </div>
      )}

      {/* History List Panel */}
      {showHistory && selectedFile && (
          <div className="absolute top-[52px] right-0 bottom-0 w-80 bg-n0 border-l border-n40 z-40 flex flex-col shadow-bottom animate-in slide-in-from-right duration-200">
               <div className="p-3 border-b border-n40 flex flex-col gap-1 bg-n0">
                   <div className="flex items-center justify-between">
                   <h3 className="text-xs font-bold text-n700 flex items-center gap-2">
                       <Clock className="w-4 h-4 text-primary" />
                           历史版本
                   </h3>
                   <button onClick={() => setShowHistory(false)} className="text-n100 hover:text-n800">
                       <X className="w-4 h-4" />
                   </button>
                   </div>
                   <p className="text-[10px] text-n100">包含剧本、分镜、提示词等所有内容</p>
               </div>
               <div className="flex-1 overflow-y-auto p-2 space-y-2">
                   {scriptVersions.length > 0 && (
                     <section className="space-y-2">
                       <div className="px-1 pt-1 text-[10px] font-semibold text-n300">分镜脚本版本</div>
                       {[...scriptVersions].reverse().map(version => {
                         const isCurrent = version.id === currentScriptVersionId;
                         const designHistoryCount = getVersionStoryboardSnapshots(version).length;
                         const modelLabel = formatScriptModelHistoryLabel(version.modelName, version.modelAlias);
                         return (
                           <div key={version.id} className={`rounded-lg border p-3 transition-colors ${isCurrent ? 'border-success/40 bg-success-light' : 'border-n40 bg-n30 hover:bg-n20'}`}>
                             <div className="mb-2 flex items-start justify-between gap-2">
                               <div className="min-w-0">
                                 <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-n700">
                                   <span>分镜脚本 V{version.versionNo}</span>
                                   {isCurrent && (
                                     <span className="inline-flex items-center gap-1 rounded border border-success/30 bg-n0 px-1.5 py-0.5 text-[9px] font-medium text-success">
                                       <Check className="h-3 w-3" /> 当前采用
                                     </span>
                                   )}
                                 </div>
                                 <div className="mt-1 text-[10px] text-n100">
                                   {version.storyboardItems.length} 个脚本分镜 · {designHistoryCount} 个镜头设计版本
                                   {modelLabel ? ` · ${modelLabel}` : ''}
                                 </div>
                                 <div className="mt-0.5 font-mono text-[10px] text-n100">
                                   {new Date(version.createdAt).toLocaleString()}
                                 </div>
                               </div>
                             </div>
                             <button
                               type="button"
                               onClick={() => {
                                 if (!isCurrent && onRestoreScriptVersion && confirm(`确定恢复分镜脚本 V${version.versionNo} 吗？\n恢复后它将成为本集当前采用版本。`)) {
                                   onRestoreScriptVersion(version);
                                   setShowHistory(false);
                                 }
                               }}
                               disabled={isCurrent || !onRestoreScriptVersion || designHistoryCount === 0}
                               className="flex w-full items-center justify-center gap-1 rounded border border-primary bg-primary-light py-1.5 text-[10px] text-primary transition-colors hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:border-n40 disabled:bg-n20 disabled:text-n100"
                             >
                               <RefreshCw className="h-3 w-3" />
                               {isCurrent ? '当前版本' : designHistoryCount > 0 ? '恢复最近镜头设计' : '无镜头设计历史'}
                             </button>
                           </div>
                         );
                       })}
                     </section>
                   )}

                   {selectedFile.versions && selectedFile.versions.length > 0 && (
                     <section className="space-y-2">
                       <div className="px-1 pt-2 text-[10px] font-semibold text-n300">镜头设计存档</div>
                       {[...selectedFile.versions].reverse().map(ver => (
                           <div key={ver.id} className="bg-n30 border border-n40 rounded-lg p-3 hover:bg-n20 transition-colors group">
                               <div className="flex justify-between items-start mb-2">
                                   <div>
                                       <div className="flex items-center gap-1.5 text-xs font-bold text-n700">
                                         <span>{ver.name}</span>
                                         <span className={`rounded border px-1 py-0.5 text-[9px] font-medium ${ver.source === 'auto' ? 'border-primary/30 bg-primary-light text-primary' : 'border-n40 bg-n0 text-n300'}`}>
                                           {ver.source === 'auto' ? '自动' : '手动'}
                                         </span>
                                       </div>
                                       <div className="text-[10px] text-n100 font-mono mt-0.5">
                                           {new Date(ver.timestamp).toLocaleString()}
                                       </div>
                                   </div>
                               </div>
                               <div className="flex items-center gap-2">
                                   <button
                                      onClick={() => {
                                          if(confirm(`确定要加载存档 "${ver.name}" 吗？\n当前未保存的修改将丢失。`)) {
                                              onRestoreStoryboard(ver);
                                              setShowHistory(false);
                                          }
                                      }}
                                      disabled={!ver.data.storyboard}
                                      className="flex-1 py-1.5 bg-primary-light hover:bg-primary border border-primary rounded text-[10px] text-primary hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1 group-hover:border-primary"
                                   >
                                       <RefreshCw className="w-3 h-3" />
                                       {ver.data.storyboard ? '恢复此版本' : '无数据'}
                                   </button>

                                   <button
                                      onClick={async () => {
                                          if(confirm(`确定要删除存档 "${ver.name}" 吗？\n此操作不可恢复。`)) {
                                              try {
                                                await onDeleteVersion(ver.id);
                                              } catch (error) {
                                                console.error('删除镜头设计版本失败:', error);
                                                alert(`删除失败：${error instanceof Error ? error.message : String(error)}`);
                                              }
                                          }
                                      }}
                                      className="p-1.5 bg-r50 hover:bg-danger border border-r75 rounded text-danger hover:text-white transition-colors flex items-center justify-center"
                                      title="删除此版本"
                                   >
                                       <Trash2 className="w-3 h-3" />
                                   </button>
                               </div>
                           </div>
                       ))}
                     </section>
                   )}

                   {scriptVersions.length === 0 && (!selectedFile.versions || selectedFile.versions.length === 0) && (
                       <div className="flex flex-col items-center justify-center py-10 text-n100 gap-2">
                           <History className="w-8 h-8 opacity-20" />
                           <div className="text-center text-xs">
                               暂无历史版本<br/>
                               生成或编辑分镜脚本后会自动保存版本
                           </div>
                       </div>
                   )}
               </div>
          </div>
      )}

      {selectedFile?.storyboard && selectedFile.storyboard.items.length > 0 ? (

        <div
          ref={scrollContainerRef}
          className={`custom-scrollbar relative min-h-0 flex-1 overflow-y-auto bg-n20 ${cardMode ? 'space-y-3 p-3' : 'space-y-4 p-4'}`}
          data-testid="storyboard-design-scroll-container"
        >


          {isProcessing && generationProgress && (
            <div className="sticky top-0 z-40 -mx-4 -mt-4 mb-4 p-4 bg-n0 backdrop-blur-sm border-b border-n40 shadow-bottom">
              <div className="flex items-center gap-4">
                <Film className="w-5 h-5 text-primary animate-spin" style={{ animationDuration: '3s' }} />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-n800">
                      正在生成分镜详情...
                    </span>
                    <span className="text-xs text-n300">
                      {generationProgress.current} / {generationProgress.total}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-n0 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-purple-600 transition-all duration-300"
                      style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
                <span className="text-lg font-bold text-primary">
                  {Math.round((generationProgress.current / generationProgress.total) * 100)}%
                </span>
              </div>
            </div>
          )}


          <button
            onClick={() => handleOpenInsertModal(0)}
            className="w-full py-2 border border-dashed border-n40 hover:border-primary rounded-lg text-n100 hover:text-primary transition-all flex items-center justify-center gap-2 text-xs bg-n0 hover:bg-n20"
          >
            <Plus className="w-3 h-3" />
            在此插入新分镜
          </button>

          {selectedFile.storyboard.items.map((item, idx) => {
            const isHighlighted = highlightedItemIds.has(item.id);
            const isGenerating = isProcessing && generationProgress && idx >= generationProgress.current;
            const hasDetails = !!item.imagePrompt;
            const segmentInfo = segmentLookup.get(item.id);


            if (isGenerating && !hasDetails) {
              return (
                <React.Fragment key={item.id}>
                  <div className="border-2 border-dashed border-primary rounded-md p-6 flex flex-col items-center justify-center bg-n30 gap-3 animate-pulse">
                    <div className="relative">
                      <div className="absolute inset-0 bg-primary rounded-full blur-md opacity-20 animate-pulse" />
                      <Sparkles className="w-8 h-8 text-primary relative animate-spin" style={{ animationDuration: '2s' }} />
                    </div>
                    <span className="text-sm font-medium text-n300">
                      {segmentInfo ? `${segmentInfo.segmentLabel} · ${segmentInfo.localShotLabel}` : `镜头 #${idx + 1}`} 生成中...
                    </span>
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                      <div className="w-1.5 h-1.5 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                  </div>


                  <button
                    onClick={() => handleOpenInsertModal(idx + 1)}
                    className="w-full py-2 border border-dashed border-n40 hover:border-primary rounded-lg text-n100 hover:text-primary transition-all flex items-center justify-center gap-2 text-xs bg-n0 hover:bg-n20"
                  >
                    <Plus className="w-3 h-3" />
                    在此插入新分镜
                  </button>
                </React.Fragment>
              );
            }

            if (item.isPlaceholder) {
                return (
                    <div
                        key={item.id}
                        className="border-2 border-dashed border-n40 rounded-md p-4 flex flex-col items-center justify-center text-n100 bg-n30 gap-2 hover:border-n40 transition-colors"
                    >
                         <AlertOctagon className="w-6 h-6 text-n100" />
                         <span className="text-xs font-mono">缺失分镜 (Placeholder)</span>
                         <p className="text-[10px] text-n100 text-center line-clamp-2 max-w-[80%]">"{item.scriptSegment}"</p>

                    </div>
                );
            }

            return (
              <React.Fragment key={item.id}>
              <div
                  ref={(el) => {
                    if (el) itemRefs.current.set(item.id, el);
                    else itemRefs.current.delete(item.id);
                  }}
                  className={`group relative bg-n0 border rounded-md overflow-hidden transition-all duration-300 shadow-card
                    ${isHighlighted
                        ? 'border-primary bg-primary-light/20 shadow-[0_0_12px_rgba(99,102,241,0.18)] ring-1 ring-primary/40'
                        : 'border-n40 hover:border-primary hover:shadow-atlas'
                    }
                  `}
                  onClick={(e) => handleCardClick(e, item.id)}
              >
                  {/* Shot Header */}
                  <div className={`px-3 py-2 border-b flex justify-between items-center
                      ${isHighlighted ? 'bg-primary-light border-primary' : 'bg-n0 border-n40'}
                  `}>
                      <div className="flex items-center gap-2">
                        {segmentInfo && (
                          <span className="inline-flex items-baseline gap-1 rounded border border-warning/30 bg-y50 px-1.5 py-0.5 text-[10px] font-semibold text-n500">
                            分段 <span className="font-mono text-warning">{String(segmentInfo.segmentNo).padStart(2, '0')}</span>
                          </span>
                        )}
                        <span className={`text-xs font-bold transition-colors ${isHighlighted ? 'text-primary' : 'text-n300 group-hover:text-primary'}`}>
                            {segmentInfo?.localShotLabel || `镜头 ${String(idx + 1).padStart(2, '0')}`}
                        </span>
                        {item.isLocked && <Lock className="w-3 h-3 text-warning" />}
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button
                            onClick={(e) => { e.stopPropagation(); onLockItem(item.id); }}
                            className={`p-1 rounded hover:bg-n20 ${item.isLocked ? 'text-warning' : 'text-n100 hover:text-warning'}`}
                            title={item.isLocked ? "解锁" : "锁定 (防止修改)"}
                         >
                             {item.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                         </button>

                         <button
                            onClick={(e) => { e.stopPropagation(); onDeleteItem(item.id); }}
                            className="p-1 rounded hover:bg-n20 text-n100 hover:text-danger"
                            title="删除 (保留剧本占位)"
                         >
                             <Trash2 className="w-3 h-3" />
                         </button>
                      </div>
                  </div>

                  <div className="p-3 space-y-3">

                      {/* Tags Section */}
                      <div className="flex flex-wrap gap-2 mb-2 items-center">
                          {item.characters && item.characters.map((char, i) => (
                              <div
                                key={`c-${i}`}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary-light border border-primary text-[9px] text-primary hover:bg-r50 hover:border-r75 hover:text-danger cursor-pointer transition-colors group/tag"
                                onClick={(e) => handleRemoveCharacter(e, item, char)}
                                title="点击删除角色"
                              >
                                  <Users className="w-2.5 h-2.5" />
                                  {char}
                                  <X className="w-2 h-2 opacity-0 group-hover/tag:opacity-100" />
                              </div>
                          ))}
                          {item.scene && (
                              <div
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-50 border border-orange-200 text-[9px] text-orange-600 cursor-pointer hover:bg-orange-200"
                                onClick={(e) => { e.stopPropagation(); setAddingTagToItem(item.id); setTagInputType('scene'); setTagInputValue(item.scene); }}
                                title="点击修改场景"
                              >
                                  <MapPin className="w-2.5 h-2.5" />
                                  {item.scene}
                              </div>
                          )}
                          {(item.props || []).map((prop, i) => (
                              <div
                                key={`p-${i}`}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-y50 border border-y75 text-[9px] text-warning hover:bg-r50 hover:border-r75 hover:text-danger cursor-pointer transition-colors group/tag"
                                onClick={(e) => handleRemoveProp(e, item, prop)}
                                title="点击删除道具"
                              >
                                  <Box className="w-2.5 h-2.5" />
                                  {prop}
                                  <X className="w-2 h-2 opacity-0 group-hover/tag:opacity-100" />
                              </div>
                          ))}

                          {/* Add Tag Button */}
                          <button
                            onClick={(e) => handleAddTagClick(e, item.id)}
                            className="p-0.5 rounded bg-n0 text-n100 hover:text-n800 hover:bg-n20 transition-colors"
                            title="手动添加标签"
                          >
                             <Plus className="w-3 h-3" />
                          </button>
                      </div>

                       {/* Tag Adding Input */}
                      {addingTagToItem === item.id && (
                          <div className="mb-2 p-2 bg-n0 rounded border border-primary flex flex-col gap-2 animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
                              <div className="flex gap-2">
                                  <button
                                    onClick={() => setTagInputType('character')}
                                    className={`flex-1 text-[9px] py-1 rounded border ${tagInputType === 'character' ? 'bg-primary text-white border-primary' : 'bg-n30 text-n300 border-n40'}`}
                                  >
                                      角色 (Character)
                                  </button>
                                  <button
                                    onClick={() => setTagInputType('scene')}
                                    className={`flex-1 text-[9px] py-1 rounded border ${tagInputType === 'scene' ? 'bg-orange-600 text-white border-orange-500' : 'bg-n30 text-n300 border-n40'}`}
                                  >
                                      场景 (Scene)
                                  </button>
                                  <button
                                    onClick={() => setTagInputType('prop')}
                                    className={`flex-1 text-[9px] py-1 rounded border ${tagInputType === 'prop' ? 'bg-yellow-600 text-white border-yellow-500' : 'bg-n30 text-n300 border-n40'}`}
                                  >
                                      道具 (Prop)
                                  </button>
                              </div>
                              <div className="flex gap-1">
                                <input
                                    type="text"
                                    autoFocus
                                    value={tagInputValue}
                                    onChange={(e) => setTagInputValue(e.target.value)}
                                    placeholder={tagInputType === 'character' ? "输入角色名..." : tagInputType === 'scene' ? "输入场景名..." : "输入道具名..."}
                                    className="flex-1 bg-n0 border border-n40 rounded px-2 py-1 text-xs text-n800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitAddTag(item);
                                        if (e.key === 'Escape') setAddingTagToItem(null);
                                    }}
                                />
                                <button onClick={() => submitAddTag(item)} className="px-2 bg-success hover:bg-green-500 text-white rounded"><Check className="w-3 h-3" /></button>
                                <button onClick={() => setAddingTagToItem(null)} className="px-2 bg-n30 hover:bg-n20 text-n800 rounded"><X className="w-3 h-3" /></button>
                              </div>
                          </div>
                      )}

                      {/* Editable Dialogue */}
                      <div className="space-y-1">
                          <div className="flex items-center justify-between">
                               <span className="text-[10px] font-bold text-success flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" />
                                  人物台词
                               </span>
                          </div>
                          <textarea
                              className="w-full text-xs text-n700 bg-n30 p-2 rounded border border-n40 resize-none focus:outline-none focus:border-success focus:bg-n0"
                              rows={2}
                              value={item.dialogue || ''}
                              onChange={(e) => onUpdateItem(item.id, { dialogue: e.target.value })}
                              placeholder="无对白..."
                              disabled={item.isLocked}
                          />
                      </div>

                      {/* Editable Image Prompt */}
                      <div className="space-y-1">
                          <div className="flex items-center justify-between">
                               <span className="text-[10px] font-bold text-cyan-500 flex items-center gap-1">
                                  <ImageIcon className="w-3 h-3" />
                                  生图 Prompt
                               </span>
                               <button onClick={(e) => { e.stopPropagation(); copyToClipboard(item.imagePrompt); }} className="text-n100 hover:text-n800">
                                  <Copy className="w-3 h-3" />
                               </button>
                          </div>
                          <textarea
                              data-testid={`storyboard-image-prompt-${item.id}`}
                              className="w-full min-h-[144px] max-h-[320px] text-xs leading-5 text-n700 bg-n30 p-2 rounded border border-n40 resize-y focus:outline-none focus:border-cyan-500/50 focus:bg-n0"
                              rows={6}
                              value={item.imagePrompt}
                              onChange={(e) => onUpdateItem(item.id, { imagePrompt: e.target.value })}
                              disabled={item.isLocked}
                          />
                      </div>

                      {/* Editable Video Prompt */}
                      <div className="space-y-1">
                           <div className="flex items-center justify-between">
                               <span className="text-[10px] font-bold text-primary flex items-center gap-1">
                                  <Film className="w-3 h-3" />
                                  视频 Prompt
                               </span>
                               <button onClick={(e) => { e.stopPropagation(); copyToClipboard(item.videoPrompt); }} className="text-n100 hover:text-n800">
                                  <Copy className="w-3 h-3" />
                               </button>
                          </div>
                          <textarea
                              data-testid={`storyboard-video-prompt-${item.id}`}
                              className="w-full min-h-[192px] max-h-[400px] text-xs leading-5 text-n700 bg-n30 p-2 rounded border border-n40 resize-y focus:outline-none focus:border-primary focus:bg-n0"
                              rows={9}
                              value={item.videoPrompt}
                              onChange={(e) => onUpdateItem(item.id, { videoPrompt: e.target.value })}
                              disabled={item.isLocked}
                          />
                      </div>

                      {/* Inline Regeneration Input */}
                      {regenInputId === item.id && (
                          <div className="mt-2 p-2 bg-n0 rounded border border-primary animate-in fade-in slide-in-from-top-2">
                              <span className="text-[10px] text-n300 block mb-1">重绘修改要求:</span>
                              <input
                                type="text"
                                autoFocus
                                className="w-full bg-n0 border border-n40 rounded px-2 py-1 text-xs text-n800 mb-2 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                placeholder="例: 将镜头改为仰视，增加下雨效果..."
                                value={regenInstruction}
                                onChange={(e) => setRegenInstruction(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="flex gap-2">
                                  <button onClick={(e) => handleCancelRegen(e)} className="flex-1 py-1 text-[10px] bg-n30 hover:bg-n20 rounded text-n700">取消</button>
                                  <button onClick={(e) => handleConfirmRegen(e, item.id)} className="flex-1 py-1 text-[10px] bg-primary hover:bg-primary-hover rounded text-white font-bold">确认重绘</button>
                              </div>
                          </div>
                      )}
                  </div>
              </div>


              <button
                key={`insert-after-${item.id}`}
                onClick={() => handleOpenInsertModal(idx + 1)}
                className="w-full py-2 border border-dashed border-n40 hover:border-primary rounded-lg text-n100 hover:text-primary transition-all flex items-center justify-center gap-2 text-xs bg-n0 hover:bg-n20"
              >
                <Plus className="w-3 h-3" />
                在此插入新分镜
              </button>
            </React.Fragment>
            );
          })}

        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-n100 p-6 text-center bg-n20">

             {isProcessing && processingType === 'rewrite' ? (

                <div className="flex flex-col items-center justify-center gap-6">

                    <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-primary to-purple-500 rounded-full blur-xl opacity-30 animate-pulse" />
                        <div className="relative bg-gradient-to-br from-n30 to-n0 p-6 rounded-full border-2 border-primary shadow-bottom">
                            <Film className="w-12 h-12 text-primary animate-spin" style={{ animationDuration: '3s' }} />
                        </div>
                    </div>


                    <div className="space-y-2">
                        <p className="text-lg font-medium text-n800">正在改写剧本...</p>
                        <p className="text-xs text-n100">AI正在优化剧本结构</p>
                    </div>


                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                        <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                        <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                    </div>
                </div>
             ) : selectedFile?.storyboard?.items?.length > 0 ? (


                null
             ) : selectedFile?.scriptContent ? (

                <>
                <LayoutDashboard className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-sm text-n300 mb-4">剧本已就绪，请先在左侧"分镜脚本"栏提取分镜</p>
                <p className="text-xs text-n100 mb-4">或从历史版本恢复</p>
                     <button
                        onClick={() => setShowHistory(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-light hover:bg-primary border border-primary rounded-lg text-primary hover:text-white transition-all"
                     >
                         <History className="w-4 h-4" />
                  从历史版本恢复
                     </button>
                </>
            ) : (
                <>
                <LayoutDashboard className="w-12 h-12 mb-4 opacity-20" />
                <p className="mb-4">请先选择一个文件</p>
                </>
            )}
        </div>
      )}


      {showInsertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm" onClick={() => setShowInsertModal(false)}>
          <div className="bg-n0 border border-n40 rounded-md w-full max-w-2xl max-h-[85vh] overflow-y-auto flex flex-col shadow-bottom m-4" onClick={(e) => e.stopPropagation()}>

            <div className="p-4 border-b border-n40 flex items-center justify-between sticky top-0 bg-n0 z-10">
              <h3 className="text-lg font-semibold text-n800 flex items-center gap-2">
                <Plus className="w-5 h-5 text-primary" />
                插入新分镜 {insertPosition === 0 ? '(开头)' : `(位置 ${insertPosition})`}
              </h3>
              <button onClick={() => setShowInsertModal(false)} className="text-n300 hover:text-n800">
                <X className="w-5 h-5" />
              </button>
            </div>


            <div className="p-4 border-b border-n40 bg-n20">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setInsertMode('manual')}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                    insertMode === 'manual'
                      ? 'bg-primary text-white'
                      : 'bg-n0 text-n300 hover:bg-n20'
                  }`}
                >
                  ✍️ 手动填写
                </button>
                <button
                  onClick={() => setInsertMode('ai')}
                  className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                    insertMode === 'ai'
                      ? 'bg-primary text-white'
                      : 'bg-n0 text-n300 hover:bg-n20'
                  }`}
                >
                  🤖 AI生成
                </button>
              </div>
              <p className="text-xs text-n100 mt-2">
                {insertMode === 'manual' ? '手动填写所有字段' : '只需填写原文段落，AI将自动生成其他内容'}
              </p>
            </div>


            <div className="p-4 space-y-4">

              <div>
                <label className="block text-sm font-medium text-n700 mb-2 flex items-center justify-between">
                  <span>对应的原文段落 <span className="text-danger">*</span></span>
                  <button
                    type="button"
                    onClick={() => setShowScriptSelector(!showScriptSelector)}
                    className="text-xs px-3 py-1 bg-primary hover:bg-primary-hover text-white rounded transition-all flex items-center gap-1"
                  >
                    <FolderInput className="w-3 h-3" />
                    {showScriptSelector ? '关闭选择器' : '从脚本中选择'}
                  </button>
                </label>

                {showScriptSelector && (
                  <div className="mb-3 p-3 bg-n20 border border-primary rounded max-h-48 overflow-y-auto">
                    <p className="text-xs text-n100 mb-2">点击选择段落：</p>
                    {selectedFile?.storyboard?.items.map((item, idx) => {
                      const segmentInfo = segmentLookup.get(item.id);
                      return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setNewShotData({...newShotData, originalText: item.originalText || item.scriptSegment});
                          setShowScriptSelector(false);
                        }}
                        className="w-full text-left p-2 mb-2 bg-n0 hover:bg-primary-light border border-n40 hover:border-primary rounded transition-all text-xs text-n300 hover:text-n800"
                      >
                        <span className="font-mono text-warning">{segmentInfo?.segmentLabel || '分段 01'}</span>
                        <span className="ml-2 text-primary font-mono">{segmentInfo?.localShotLabel || `镜头 ${String(idx + 1).padStart(2, '0')}`}</span>
                        <span className="ml-2 line-clamp-2">{(item.originalText || item.scriptSegment).substring(0, 100)}...</span>
                      </button>
                    )})}
                  </div>
                )}

                <textarea
                  value={newShotData.originalText}
                  onChange={(e) => setNewShotData({...newShotData, originalText: e.target.value})}
                  className="w-full h-24 bg-n0 border border-n40 rounded px-3 py-2 text-n700 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                  placeholder="点击上方按钮从脚本中选择，或手动输入..."
                />
              </div>

              {insertMode === 'manual' && (
                <>

                  <div>
                    <label className="block text-sm font-medium text-n700 mb-2">
                      场景描述 <span className="text-danger">*</span>
                    </label>
                    <textarea
                      value={newShotData.scriptSegment}
                      onChange={(e) => setNewShotData({...newShotData, scriptSegment: e.target.value})}
                      className="w-full h-20 bg-n0 border border-n40 rounded px-3 py-2 text-n700 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                      placeholder="简洁的场景和动作描述..."
                    />
                  </div>


                  <div>
                    <label className="block text-sm font-medium text-n700 mb-2">
                      图像提示词 (imagePrompt)
                    </label>
                    <textarea
                      value={newShotData.imagePrompt}
                      onChange={(e) => setNewShotData({...newShotData, imagePrompt: e.target.value})}
                      className="w-full h-20 bg-n0 border border-n40 rounded px-3 py-2 text-n700 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none font-mono"
                      placeholder="英文图像生成提示词..."
                    />
                  </div>


                  <div>
                    <label className="block text-sm font-medium text-n700 mb-2">
                      视频提示词 (videoPrompt)
                    </label>
                    <textarea
                      value={newShotData.videoPrompt}
                      onChange={(e) => setNewShotData({...newShotData, videoPrompt: e.target.value})}
                      className="w-full h-20 bg-n0 border border-n40 rounded px-3 py-2 text-n700 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                      placeholder="中文视频生成提示词..."
                    />
                  </div>


                  <div>
                    <label className="block text-sm font-medium text-n700 mb-2">
                      人物台词 (dialogue)
                    </label>
                    <textarea
                      value={newShotData.dialogue}
                      onChange={(e) => setNewShotData({...newShotData, dialogue: e.target.value})}
                      className="w-full h-16 bg-n0 border border-n40 rounded px-3 py-2 text-n700 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                      placeholder="角色对话..."
                    />
                  </div>


                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-n700 mb-2">
                        角色 (逗号分隔)
                      </label>
                      <input
                        type="text"
                        value={newShotData.characters}
                        onChange={(e) => setNewShotData({...newShotData, characters: e.target.value})}
                        className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-n700 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        placeholder="角色1, 角色2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-n700 mb-2">
                        场景位置
                      </label>
                      <input
                        type="text"
                        value={newShotData.scene}
                        onChange={(e) => setNewShotData({...newShotData, scene: e.target.value})}
                        className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-n700 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        placeholder="场景名称"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-n700 mb-2">
                        道具 (逗号分隔)
                      </label>
                      <input
                        type="text"
                        value={newShotData.props}
                        onChange={(e) => setNewShotData({...newShotData, props: e.target.value})}
                        className="w-full bg-n0 border border-n40 rounded px-3 py-2 text-n700 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                        placeholder="扇子, 武器"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>


            <div className="p-4 border-t border-n40 flex items-center justify-end gap-3 sticky bottom-0 bg-n0">
              <button
                onClick={() => setShowInsertModal(false)}
                className="px-4 py-2 text-sm text-n300 hover:text-n800 hover:bg-n20 rounded transition-all"
              >
                取消
              </button>
              <button
                onClick={handleInsertShot}
                disabled={isProcessing}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary-hover text-white rounded transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {insertMode === 'manual' ? '✅ 插入分镜' : '🤖 AI生成并插入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
