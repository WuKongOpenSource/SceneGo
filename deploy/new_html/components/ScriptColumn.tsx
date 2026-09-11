import React, { useState, useRef, useEffect } from 'react';
import { ProjectFile } from '../types';
import { ScrollText, FileSignature, LayoutDashboard, Users, MapPin, Tags, ListPlus, Sparkles, Wand2, Split, Merge, Edit, Save, X, Undo2, Redo2, FileText, CheckCircle, Clock, AlertOctagon, Download, FileSpreadsheet } from 'lucide-react';
import {
  findVideoScriptShotBlock,
  parseHierarchicalShotNumber,
} from '../utils/scriptPipelineParsers';

interface ScriptColumnProps {
  selectedFile: ProjectFile | undefined;
  checkedCount: number;
  onGenerateStoryboard: (fileId: string) => Promise<void>;
  onExtractMetadata: (targetFileId?: string) => Promise<void>;
  onRefineScript: (selection: string, instruction: string) => Promise<void>;
  onRestructure: (selection: string, instruction: string, type: 'split' | 'merge') => Promise<void>;
  onUpdateScript: (newContent: string) => void;
  onUpdateStoryboardItems?: (items: any[]) => void;
  isProcessing: boolean;


  onExtractShots: () => Promise<void>;
  isShotExtracting: boolean;
  aiModel?: any;
  onRewrite?: (targetFileId?: string) => Promise<void>;

  isExpanded: boolean;
  onToggleExpand: () => void;
  highlightedTextSegments: Set<string>;
  highlightedItemIds: Set<string>;
  onSelectionChange: (selection: string | null) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;

}

export const ScriptColumn: React.FC<ScriptColumnProps> = ({
  selectedFile,
  checkedCount,
  onGenerateStoryboard,
  onExtractMetadata,
  onRefineScript,
  onRestructure,
  onUpdateScript,
  onUpdateStoryboardItems,
  isProcessing,


  onExtractShots,
  isShotExtracting,
  aiModel,
  onRewrite,

  highlightedTextSegments,
  highlightedItemIds,
  onSelectionChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo

}) => {
  const [selection, setSelection] = useState<string | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number } | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [activeInstruction, setActiveInstruction] = useState<string>('');
  const [activeActionType, setActiveActionType] = useState<'refine' | 'expand' | 'split' | 'merge'>('refine');
  const [isEditMode, setIsEditMode] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);


  const [editingShotId, setEditingShotId] = useState<string | null>(null);
  const [editingScriptSegment, setEditingScriptSegment] = useState<string>('');
  const [showShotPromptModal, setShowShotPromptModal] = useState(false);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);


  const hasScript = selectedFile?.scriptContent;




  const getShotNumberStr = (sn: string | number | undefined | null): string => {
    if (sn === undefined || sn === null) return '';
    return typeof sn === 'string' ? sn : String(sn);
  };


  const exportStoryboardToExcel = () => {
    if (!selectedFile?.storyboard?.items) return;

    const items = selectedFile.storyboard.items;


    const headers = ['镜号', '镜头描述', '画面描述', '转场', '时间', '人声', '音效', '人物名称', '场景名称', '道具名称'];


    const parseOriginalText = (text: string) => {
      const result: Record<string, string> = {};


      const fieldPatterns: Record<string, RegExp> = {
        '取景': /取景[:：]\s*(.+?)(?:\n|$)/,
        '角度': /(?:摄像机)?角度[:：]\s*(.+?)(?:\n|$)/,
        '运动': /(?:镜头)?运动[:：]\s*(.+?)(?:\n|$)/,
        '机位': /机位[:：]\s*(.+?)(?:\n|$)/,
        '站位与构图': /站位与构图[:：]\s*(.+?)(?:\n|$)/,
        '动作与神态': /动作与神态[:：]\s*(.+?)(?:\n|$)/,
        '氛围与特效': /氛围与特效[:：]\s*(.+?)(?:\n|$)/,
        '人声': /人声[:：]\s*(.+?)(?:\n|$)/,
        '音效': /音效[:：]\s*(.+?)(?:\n|$)/,
        '转场': /转场[:：]\s*(.+?)(?:\n|$)/,
        '时间': /(?:时长|时间)[:：]\s*(.+?)(?:\n|$)/,
        '人物名称': /人物名称[:：]\s*(.+?)(?:\n|$)/,
        '场景名称': /场景名称[:：]\s*(.+?)(?:\n|$)/,
        '道具名称': /道具名称[:：]\s*(.+?)(?:\n|$)/,
      };

      for (const [field, pattern] of Object.entries(fieldPatterns)) {
        const match = text.match(pattern);
        if (match) {
          result[field] = match[1].trim();
        }
      }

      return result;
    };


    const rows = items.map((item, index) => {
      const parsed = parseOriginalText(item.originalText);


      const 镜头描述Parts = [];
      if (parsed['取景']) 镜头描述Parts.push(`【取景】${parsed['取景']}`);
      if (parsed['角度']) 镜头描述Parts.push(`【角度】${parsed['角度']}`);
      if (parsed['运动']) 镜头描述Parts.push(`【运动】${parsed['运动']}`);
      if (parsed['机位']) 镜头描述Parts.push(`【机位】${parsed['机位']}`);
      const 镜头描述 = 镜头描述Parts.join(' ');


      const 画面描述Parts = [];
      if (parsed['站位与构图']) 画面描述Parts.push(`【站位与构图】${parsed['站位与构图']}`);
      if (parsed['动作与神态']) 画面描述Parts.push(`【动作与神态】${parsed['动作与神态']}`);
      if (parsed['氛围与特效']) 画面描述Parts.push(`【氛围与特效】${parsed['氛围与特效']}`);
      const 画面描述 = 画面描述Parts.join('\n');


      const 转场 = parsed['转场'] || '';


      let 人声 = parsed['人声'] || item.dialogue || '';
      if (!人声.trim()) 人声 = '(无台词)';
      else if (!人声.startsWith('【人声】')) 人声 = `【人声】${人声}`;


      let 人物名称 = parsed['人物名称'] || (item.characters || []).join('、');
      if (!人物名称.trim()) 人物名称 = '(群演)';


      const 场景名称 = parsed['场景名称'] || item.scene || '';
      const 道具名称 = parsed['道具名称'] || (item.props || []).join('、');

      const row = [
        getShotNumberStr(item.shotNumber).replace(/镜头0?/, '') || `${index + 1}`.padStart(3, '0'),
        镜头描述,
        画面描述,
        转场,
        parsed['时间'] || item.duration || '',
        人声,
        parsed['音效'] || '',
        人物名称,
        场景名称,
        道具名称
      ];


      return row.map(cell => {
        const cellStr = String(cell || '');
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(',');
    });


    const csvContent = '\ufeff' + [headers.join(','), ...rows].join('\n'); // BOM for Excel UTF-8


    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedFile.name.replace(/\.[^.]+$/, '')}_分镜表.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };


  const findMatchingOriginalTexts = (selectedText: string): string[] => {
    if (!selectedFile?.storyboard || !selectedText || selectedText.length < 2) return [];

    const matched: string[] = [];


    const seln = selectedText.trim();
    if (seln.length >= 3) {
      for (const item of selectedFile.storyboard.items) {
        const blk = item.videoScriptBlock;
        if (blk && blk.trim() && blk.includes(seln)) {
          matched.push(blk);
          return matched;
        }
      }
    }


    const shotMatch = selectedText.match(/镜头\s*\d+(?:\s*[-－—]\s*\d+)?/);
    if (shotMatch) {
      const shotNo = parseHierarchicalShotNumber(shotMatch[0]);
      const item = selectedFile.storyboard.items.find(i => {
        const itemShotNo = parseHierarchicalShotNumber(getShotNumberStr(i.shotNumber));
        return shotNo && itemShotNo
          && shotNo.localShotNo === itemShotNo.localShotNo
          && (shotNo.segmentNo === null || itemShotNo.segmentNo === null || shotNo.segmentNo === itemShotNo.segmentNo);
      });
      if (item) {
        matched.push(getShotNumberStr(item.shotNumber) || item.originalText || item.scriptSegment);
        return matched;
      }
    }


    const content = selectedFile.scriptContent || '';
    const selectionIndex = content.indexOf(selectedText);
    if (selectionIndex !== -1) {

      const beforeText = content.substring(0, selectionIndex);
      const shotMatches = [...beforeText.matchAll(/镜头\s*\d+(?:\s*[-－—]\s*\d+)?/g)];
      if (shotMatches.length > 0) {
        const lastMatch = shotMatches[shotMatches.length - 1];
        const shotNo = parseHierarchicalShotNumber(lastMatch[0]);
        const item = selectedFile.storyboard.items.find(i => {
          const itemShotNo = parseHierarchicalShotNumber(getShotNumberStr(i.shotNumber));
          return shotNo && itemShotNo
            && shotNo.localShotNo === itemShotNo.localShotNo
            && (shotNo.segmentNo === null || itemShotNo.segmentNo === null || shotNo.segmentNo === itemShotNo.segmentNo);
        });
        if (item) {
          matched.push(getShotNumberStr(item.shotNumber) || item.originalText || item.scriptSegment);
          return matched;
        }
      }
    }


    selectedFile.storyboard.items.forEach(item => {
      const originalText = item.originalText || item.scriptSegment;
      if (originalText && originalText.includes(selectedText)) {
        matched.push(originalText);
      }
    });

    return matched;
  };


  useEffect(() => {
    if (isEditMode) return;

    let selectionTimeout: NodeJS.Timeout | null = null;
    let isSelecting = false;

    const handleMouseDown = () => {
      isSelecting = true;

      setToolbarPosition(null);
    };

    const handleMouseUp = () => {
      if (!isSelecting) return;
      isSelecting = false;


      setTimeout(() => {
        const activeSelection = window.getSelection();

        if (!activeSelection || activeSelection.isCollapsed || !contentRef.current?.contains(activeSelection.anchorNode)) {
          setSelection(null);
          setToolbarPosition(null);
          onSelectionChange(null);
          return;
        }

        const text = activeSelection.toString().trim();
        if (text.length === 0) {
          setSelection(null);
          setToolbarPosition(null);
          onSelectionChange(null);
          return;
        }


        const matchedTexts = findMatchingOriginalTexts(text);


        if (matchedTexts.length > 0) {
          onSelectionChange(matchedTexts[0]);
        } else {
          onSelectionChange(text);
        }


        setSelection(text);
        const range = activeSelection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        if (rect.width > 0 && rect.height > 0) {

          const toolbarHeight = 180;
          const gap = 15;

          setToolbarPosition({
            top: rect.top - toolbarHeight - gap,
            left: rect.left + (rect.width / 2)
          });
        }
      }, 50);
    };

    const handleSelectionChange = () => {

      if (isSelecting || showInput) return;

      if (selectionTimeout) {
        clearTimeout(selectionTimeout);
      }

      selectionTimeout = setTimeout(() => {
        const activeSelection = window.getSelection();

      if (!activeSelection || activeSelection.isCollapsed || !contentRef.current?.contains(activeSelection.anchorNode)) {
         setSelection(null);
         setToolbarPosition(null);
          onSelectionChange(null);
         return;
      }

      const text = activeSelection.toString().trim();
        if (text.length === 0) {
          setSelection(null);
          setToolbarPosition(null);
          onSelectionChange(null);
          return;
        }


        const matchedTexts = findMatchingOriginalTexts(text);
        if (matchedTexts.length > 0) {
          onSelectionChange(matchedTexts[0]);
        } else {
          onSelectionChange(text);
        }

        setSelection(text);
        const range = activeSelection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        if (rect.width > 0 && rect.height > 0) {
             setToolbarPosition({
                top: rect.top - 60,
                left: rect.left + (rect.width / 2)
            });
        }
      }, 200);
    };

    if (contentRef.current) {
      contentRef.current.addEventListener('mousedown', handleMouseDown);
      contentRef.current.addEventListener('mouseup', handleMouseUp);
    }
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      if (contentRef.current) {
        contentRef.current.removeEventListener('mousedown', handleMouseDown);
        contentRef.current.removeEventListener('mouseup', handleMouseUp);
      }
      document.removeEventListener('selectionchange', handleSelectionChange);
      if (selectionTimeout) clearTimeout(selectionTimeout);
    };
  }, [onSelectionChange, isEditMode, showInput, selectedFile]);

  const handleToolbarAction = (instruction: string, type: 'refine' | 'expand' | 'split' | 'merge') => {
    setActiveInstruction(instruction);
    setActiveActionType(type);
    setShowInput(true);
  };

  const cancelAction = () => {
      setShowInput(false);
      setInputValue('');
  };

  const submitAction = () => {
    if (selection) {
        const fullInstruction = activeInstruction
            ? `${activeInstruction} ${inputValue ? `(额外要求: ${inputValue})` : ''}`
            : inputValue;

        if (fullInstruction) {
            if (activeActionType === 'split' || activeActionType === 'merge') {
                onRestructure(selection, fullInstruction, activeActionType);
            } else {
                onRefineScript(selection, fullInstruction);
            }

            window.getSelection()?.removeAllRanges();
            setSelection(null);
            setToolbarPosition(null);
            setShowInput(false);
            setInputValue('');
        }
    }
  };

  // Generated tags stay inline so browser text selections remain contiguous.
  const renderMarkdown = (text: string): string => {
    let html = text;


    const escapeHtml = (str: string) => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    html = escapeHtml(html);





    html = html.replace(/\*\*\s*([^*]+?)\s*\*\*/g, '<strong class="font-bold text-cyan-300">$1</strong>');


    html = html.replace(/\*([^*]+?)\*/g, '<em class="italic text-emerald-300">$1</em>');


    html = html.replace(/【([^】]+)】/g, '<span class="text-primary font-semibold">【$1】</span>');


    html = html.replace(/（([^）]+)）/g, '<span class="text-n200">（$1）</span>');

    return html;
  };


  const renderScriptContentWithHighlight = () => {
    const content = selectedFile?.scriptContent || '';
    if (!content) return '';


    if (!selectedFile?.storyboard || highlightedItemIds.size === 0) {
      return renderMarkdown(content);
    }


    const MARK_START = '###HLSTART###';
    const MARK_END = '###HLEND###';
    let markedContent = content;

    // Block identity avoids highlighting the wrong shot when numbers repeat by segment.
    const highlightBlocks = Array.from(new Set(
      selectedFile.storyboard.items
        .filter(item => highlightedItemIds.has(item.id))
        .map(item => (item.videoScriptBlock || '').trim())
        .filter(b => b.length > 0)
    ));
    if (highlightBlocks.length > 0) {
      for (const blk of highlightBlocks) {
        const idx = markedContent.indexOf(blk);
        if (idx !== -1) {
          markedContent = markedContent.slice(0, idx) + MARK_START + blk + MARK_END + markedContent.slice(idx + blk.length);
        }
      }
      let html = renderMarkdown(markedContent);
      html = html.replace(
        new RegExp(`${MARK_START}([\\s\\S]*?)${MARK_END}`, 'g'),
        `<mark class="bg-yellow-500/20 text-yellow-50" style="user-select: text; padding: 0.125rem 0.25rem; border-left: 3px solid rgb(234 179 8); background-color: rgba(234 179 8 / 0.15);">$1</mark>`
      );
      return html;
    }

    // Historical records without block identity fall back to the full shot number.
    const highlightShotNumbers = selectedFile.storyboard.items
      .filter(item => highlightedItemIds.has(item.id))
      .map(item => getShotNumberStr(item.shotNumber))
      .filter(sn => sn && sn.trim());

    if (highlightShotNumbers.length === 0) {
      return renderMarkdown(content);
    }


    highlightShotNumbers.forEach(shotNumber => {
      const shotBlock = findVideoScriptShotBlock(markedContent, shotNumber);
      if (shotBlock && !shotBlock.includes(MARK_START)) {
        markedContent = markedContent.replace(shotBlock, `${MARK_START}${shotBlock}${MARK_END}`);
      }
    });


    let htmlContent = renderMarkdown(markedContent);


    htmlContent = htmlContent.replace(
      new RegExp(`${MARK_START}([\\s\\S]*?)${MARK_END}`, 'g'),
      `<mark class="bg-yellow-500/20 text-yellow-50" style="user-select: text; padding: 0.125rem 0.25rem; border-left: 3px solid rgb(234 179 8); background-color: rgba(234 179 8 / 0.15);">$1</mark>`
    );

    return htmlContent;
  };

  return (
    <div className="flex flex-col h-full bg-n0 border-r border-n40 relative">
      <div className="h-[52px] px-4 border-b border-n40 bg-n0 flex-shrink-0 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-n700 uppercase tracking-wider flex items-center gap-2">
            3. 分镜脚本
            </h2>
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 border-r border-n40 pr-2 mr-1">
                     <button onClick={onUndo} disabled={!canUndo} className="p-1.5 text-n100 hover:text-n800 disabled:opacity-30 rounded hover:bg-n20">
                         <Undo2 className="w-4 h-4" />
                     </button>
                     <button onClick={onRedo} disabled={!canRedo} className="p-1.5 text-n100 hover:text-n800 disabled:opacity-30 rounded hover:bg-n20">
                         <Redo2 className="w-4 h-4" />
                     </button>
                 </div>

                {hasScript && (
                  <button
                    onClick={() => setIsEditMode(!isEditMode)}
                    className={`p-1.5 rounded transition-colors ${isEditMode ? 'bg-primary text-white' : 'text-n100 hover:text-n800 hover:bg-n20'}`}
                    title={isEditMode ? "完成编辑" : "手动编辑剧本"}
                  >
                      {isEditMode ? <Save className="w-4 h-4" /> : <Edit className="w-4 h-4" />}
                  </button>
                )}
            </div>
      </div>


      <div className="h-[52px] px-3 border-b border-n40 bg-n0 flex items-center">

           {hasScript && !selectedFile?.storyboard && (
               <button
               onClick={onExtractShots}
               disabled={isShotExtracting || isProcessing}
               className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-xs transition-all ${
                 isShotExtracting || isProcessing
                   ? 'bg-n0 text-n100 cursor-not-allowed'
                   : 'bg-gradient-to-r from-primary to-pink-600 hover:from-primary-hover hover:to-pink-500 text-white shadow-lg shadow-purple-900/50'
               }`}
             >
               {isShotExtracting ? (
                 <>
                   <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                   <span>提取中...</span>
                 </>
               ) : (
                 <>
                   <LayoutDashboard className="w-4 h-4" />
                   <span>提取分镜</span>
                 </>
               )}
               </button>
           )}


          {selectedFile?.storyboard && (
            <div className="w-full flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-g50 border border-g75 rounded-lg text-xs text-success">
                <LayoutDashboard className="w-4 h-4" />
                <span>已提取 {selectedFile.storyboard.items.length} 个分镜</span>
              </div>


              <button
                onClick={() => exportStoryboardToExcel()}
                className="flex items-center gap-1.5 px-3 py-2 bg-b50 hover:bg-blue-600 border border-b75 rounded-lg text-xs text-b400 hover:text-white transition-all"
                title="导出分镜表格"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>导出Excel</span>
              </button>
            </div>
          )}


          {!hasScript && onRewrite && (
            <button
              onClick={() => onRewrite(selectedFile?.id)}
              disabled={isProcessing}
              className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-xs transition-all ${
                isProcessing
                  ? 'bg-n0 text-n100 cursor-not-allowed'
                  : 'bg-gradient-to-r from-primary to-purple-600 hover:from-primary-hover hover:to-purple-500 text-white shadow-lg shadow-indigo-900/50'
              }`}
            >
              {isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  <span>AI改写中...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  <span>AI 分镜脚本改写</span>
                </>
              )}
            </button>
          )}
          {!hasScript && !onRewrite && (
            <div className="w-full text-center text-xs text-n100">等待剧本生成...</div>
          )}
      </div>

      <div
        className="flex-1 overflow-y-auto bg-n20 relative custom-scrollbar"
        ref={contentRef}
        onClick={(e) => {
          // The editor owns selection state while direct text editing is active.
          if (isEditMode) return;


          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('p-6')) {
            window.getSelection()?.removeAllRanges();
            setSelection(null);
            setToolbarPosition(null);
          }
        }}
      >
        {hasScript ? (
          <>
            {isEditMode ? (
                <textarea
                    className="font-document w-full h-full p-6 bg-n0 text-sm text-n700 leading-relaxed resize-none focus:outline-none focus:bg-n0 border border-primary focus:border-primary focus:ring-2 focus:ring-primary/20"
                    value={selectedFile.scriptContent || ''}
                    onChange={(e) => onUpdateScript(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    spellCheck={false}
                    autoFocus
                    placeholder="在此编辑剧本内容..."
                    style={{ userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}
                />
            ) : selectedFile?.storyboard?.items && selectedFile.storyboard.items.length > 0 ? (

                <div className="p-6 space-y-6 pb-20 relative">
                    <div
                      className="font-document text-sm whitespace-pre-wrap text-n700 leading-relaxed border-l-2 border-success pl-4 selection:bg-primary-light selection:text-n800 relative"
                      style={{ userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}
                      dangerouslySetInnerHTML={{ __html: renderScriptContentWithHighlight() }}
                    />


                    <div className="mt-6 p-4 bg-primary-light border border-primary rounded-lg">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-success" />
                        <span className="text-sm text-n700">
                          已提取 <strong className="text-primary">{selectedFile.storyboard.items.length}</strong> 个分镜段落
                        </span>

                      </div>
                      <p className="text-xs text-n100 mt-2">
                        💡 选择文本片段可查看对应分镜的场景描述
                      </p>
                    </div>
                </div>
            ) : (

                <div className="p-6 space-y-6 pb-20">

                    <div
                      className="font-document text-sm whitespace-pre-wrap text-n700 leading-relaxed border-l-2 border-success pl-4 selection:bg-primary-light selection:text-n800"
                      style={{ userSelect: 'text', WebkitUserSelect: 'text' }}
                      dangerouslySetInnerHTML={{ __html: renderScriptContentWithHighlight() }}
                    />

                    {(selectedFile.extractedCharacters.length > 0 || selectedFile.extractedScenes.length > 0 || (selectedFile.extractedProps || []).length > 0) && (
                        <div className="mt-8 pt-6 border-t border-n40 space-y-4">
                            <h3 className="text-xs font-bold text-n100 uppercase flex items-center gap-2">
                                <Tags className="w-3 h-3" />
                                数据库标签提取
                            </h3>

                            {selectedFile.extractedCharacters.length > 0 && (
                                <div>
                                    <span className="text-[10px] text-primary font-bold mb-2 block">角色 (Characters)</span>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedFile.extractedCharacters.map((char, i) => (
                                            <span key={i} className="px-2 py-1 bg-primary-light border border-primary rounded text-[10px] text-primary">
                                                {char}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {selectedFile.extractedScenes.length > 0 && (
                                <div>
                                    <span className="text-[10px] text-orange-400 font-bold mb-2 block">场景 (Scenes)</span>
                                    <div className="flex flex-wrap gap-2">
                                        {selectedFile.extractedScenes.map((scene, i) => (
                                            <span key={i} className="px-2 py-1 bg-orange-50 border border-orange-200 rounded text-[10px] text-orange-600">
                                                {scene}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {(selectedFile.extractedProps || []).length > 0 && (
                                <div>
                                    <span className="text-[10px] text-yellow-600 font-bold mb-2 block">道具 (Props)</span>
                                    <div className="flex flex-wrap gap-2">
                                        {(selectedFile.extractedProps || []).map((prop, i) => (
                                            <span key={i} className="px-2 py-1 bg-y50 border border-y75 rounded text-[10px] text-warning">
                                                {prop}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
          </>
        ) : selectedFile ? (
          <div className="h-full flex flex-col items-center justify-center text-n100">
            <FileSignature className="w-12 h-12 mb-4 opacity-20" />
            <p>暂无剧本内容</p>
            <p className="text-xs mt-2">请在"文字脚本"栏点击改写</p>
          </div>
        ) : (
           <div className="h-full flex flex-col items-center justify-center text-n100">
            <ScrollText className="w-12 h-12 mb-4 opacity-20" />
            <p>请选择文件查看剧本</p>
          </div>
        )}
      </div>

      {!isEditMode && selection && toolbarPosition && (
          <div
            style={{ top: toolbarPosition.top, left: toolbarPosition.left, transform: 'translate(-50%, -100%)' }}
            className="fixed z-50 bg-n0 rounded-lg shadow-bottom border border-n40 p-1.5 flex flex-col gap-2 min-w-[280px] max-w-[320px] animate-in fade-in zoom-in-95 duration-200"
            onMouseDown={(e) => e.preventDefault()}
          >
             {!showInput ? (
                 <>

                 <div className="flex items-center gap-1 justify-between">
                    <button onClick={() => handleToolbarAction('润色文字', 'refine')} className="flex flex-col items-center gap-1 p-2 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors flex-1">
                        <Wand2 className="w-4 h-4 text-primary" />
                        <span>润色</span>
                    </button>
                    <button onClick={() => handleToolbarAction('扩写这一段，增加细节', 'expand')} className="flex flex-col items-center gap-1 p-2 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors flex-1">
                        <Sparkles className="w-4 h-4 text-success" />
                        <span>扩写</span>
                    </button>
                    <button onClick={() => handleToolbarAction('拆分这个分镜，使其更细致', 'split')} className="flex flex-col items-center gap-1 p-2 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors flex-1">
                        <Split className="w-4 h-4 text-orange-400" />
                        <span>拆分</span>
                    </button>
                    <button
                      onClick={() => {

                        const matchedShots = selectedFile?.storyboard?.items.filter(item =>
                          item.originalText.includes(selection || '') ||
                          (selection && selection.length > 30 && item.originalText.substring(0, 100).includes(selection.substring(0, 30)))
                        ) || [];

                        if (matchedShots.length > 1) {
                          handleToolbarAction(`合并这${matchedShots.length}个镜头为一个`, 'merge');
                        } else {
                          alert('合并操作需要选择多个镜头的文字');
                        }
                      }}
                      className="flex flex-col items-center gap-1 p-2 hover:bg-n20 rounded text-xs text-n700 hover:text-n800 transition-colors flex-1"
                    >
                        <Merge className="w-4 h-4 text-b400" />
                        <span>合并</span>
                    </button>
                 </div>


                 {selectedFile?.storyboard?.items && (() => {

                   const matchedShots = selectedFile.storyboard?.items.filter(item =>
                     item.originalText.includes(selection || '') ||
                     (selection && selection.length > 50 && item.originalText.substring(0, 50).includes(selection.substring(0, 50))) ||
                     item.scriptSegment.includes(selection || '')
                   ) || [];

                   if (matchedShots.length === 0) return null;

                   return (
                     <div className="w-full flex items-center gap-2 px-2 py-2 bg-n20 border-t border-n40">
                       <span className="text-[10px] text-n100">
                         匹配到 <strong className="text-primary">{matchedShots.length}</strong> 个分镜
                       </span>
                       <button
                         onClick={() => {
                           if (matchedShots.length === 1) {

                             setSelectedShotId(matchedShots[0].id);
                             setShowShotPromptModal(true);
                           } else {

                             setSelectedShotId(matchedShots[0].id);
                             setShowShotPromptModal(true);
                           }

                           setToolbarPosition(null);
                           setSelection(null);
                         }}
                         className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-primary-light hover:bg-primary-light border border-primary rounded text-primary hover:text-white transition-colors"
                       >
                         <FileText className="w-3.5 h-3.5" />
                         <span className="text-xs font-medium">
                           查看详情 {matchedShots.length > 1 ? `(${matchedShots.length}个)` : ''}
                         </span>
                       </button>
                     </div>
                   );
                 })()}
                 </>
             ) : (
                 <div className="flex flex-col gap-2 p-2">
                     <div className="flex items-center justify-between border-b border-n40 pb-2 mb-1">
                        <span className="text-[10px] font-bold text-n300 uppercase">
                            {activeActionType === 'split' ? '拆分分镜' : activeActionType === 'merge' ? '合并分镜' : activeActionType === 'expand' ? '文本扩写' : '文本润色'}
                        </span>
                        <button onClick={cancelAction} className="text-n100 hover:text-n800"><X className="w-3 h-3" /></button>
                     </div>

                     <span className="text-[10px] text-n100">具体要求:</span>
                     <textarea
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder={
                            activeActionType === 'split' ? "例：拆分成3个镜头，先特写眼神，再拉远..." :
                            activeActionType === 'merge' ? "例：合并为一个长镜头，强调氛围..." :
                            "输入您的具体修改要求..."
                        }
                        autoFocus
                        rows={3}
                        className="w-full bg-n0 border border-n40 rounded px-2 py-1.5 text-xs text-n800 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                submitAction();
                            }
                            if (e.key === 'Escape') {
                                cancelAction();
                            }
                        }}
                     />
                     <div className="flex gap-2 mt-1">
                        <button onClick={cancelAction} className="flex-1 py-1.5 bg-n30 hover:bg-n20 rounded text-[10px] text-n700 font-medium">取消</button>
                        <button onClick={submitAction} className="flex-1 py-1.5 bg-primary hover:bg-primary-hover rounded text-[10px] text-white font-bold">确认执行</button>
                     </div>
                 </div>
             )}

             <div className="absolute left-1/2 -translate-x-1/2 -bottom-1.5 w-3 h-3 bg-n0 border-b border-r border-n40 rotate-45 z-10"></div>
          </div>
      )}


      {showShotPromptModal && selectedShotId && selectedFile?.storyboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm" onClick={() => setShowShotPromptModal(false)}>
          <div className="bg-n0 border border-n40 rounded-md w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col shadow-bottom m-4" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-n40 flex items-center justify-between sticky top-0 bg-n0 z-10">
              <h3 className="text-lg font-semibold text-n800 flex items-center gap-2">
                <LayoutDashboard className="w-5 h-5 text-primary" />
                分镜场景描述
                {(() => {
                  const currentIndex = selectedFile.storyboard.items.findIndex(i => i.id === selectedShotId);
                  const totalShots = selectedFile.storyboard.items.length;
                  return currentIndex >= 0 ? (
                    <span className="text-sm text-n100 ml-2">
                      ({currentIndex + 1} / {totalShots})
                    </span>
                  ) : null;
                })()}
              </h3>
              <div className="flex items-center gap-2">

                {(() => {
                  const currentIndex = selectedFile.storyboard.items.findIndex(i => i.id === selectedShotId);
                  return (
                    <>
                      <button
                        onClick={() => {
                          if (currentIndex > 0) {
                            setSelectedShotId(selectedFile.storyboard.items[currentIndex - 1].id);
                          }
                        }}
                        disabled={currentIndex <= 0}
                        className="p-1 hover:bg-n20 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="上一个分镜"
                      >
                        <svg className="w-5 h-5 text-n300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => {
                          if (currentIndex < selectedFile.storyboard.items.length - 1) {
                            setSelectedShotId(selectedFile.storyboard.items[currentIndex + 1].id);
                          }
                        }}
                        disabled={currentIndex >= selectedFile.storyboard.items.length - 1}
                        className="p-1 hover:bg-n20 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        title="下一个分镜"
                      >
                        <svg className="w-5 h-5 text-n300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </>
                  );
                })()}
                <button
                  onClick={() => setShowShotPromptModal(false)}
                  className="p-1 hover:bg-n20 rounded transition-colors"
                >
                  <X className="w-5 h-5 text-n300" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {(() => {
                const shot = selectedFile.storyboard.items.find(i => i.id === selectedShotId);
                if (!shot) return null;

                const hasDetails = !!shot.imagePrompt;

                return (
                  <>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-bold text-n300">镜头编号:</span>
                        <span className="text-n800 text-lg">#{shot.shotNumber || selectedFile.storyboard.items.indexOf(shot) + 1}</span>
                      </div>
                      {hasDetails ? (
                        <span className="px-2 py-1 bg-g50 text-success rounded text-xs flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          已生成详情
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-n0 text-n100 rounded text-xs flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          待生成详情
                        </span>
                      )}
                    </div>


                    <div>
                      <label className="text-xs font-bold text-n300 block mb-2">
                        场景描述（AI提炼的视觉描述）
                      </label>
                      {editingShotId === shot.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editingScriptSegment}
                            onChange={(e) => setEditingScriptSegment(e.target.value)}
                            className="w-full p-3 bg-n0 border border-primary rounded text-sm text-n700 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                            rows={4}
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                if (selectedFile) {
                                  const updatedItems = selectedFile.storyboard!.items.map(i =>
                                    i.id === shot.id ? { ...i, scriptSegment: editingScriptSegment } : i
                                  );
                                  onUpdateScript(JSON.stringify({ items: updatedItems }));
                                }
                                setEditingShotId(null);
                              }}
                              className="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded transition-all"
                            >
                              保存修改
                            </button>
                            <button
                              onClick={() => setEditingShotId(null)}
                              className="px-4 py-2 bg-n30 hover:bg-n20 text-n800 text-sm rounded transition-all"
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="relative group">
                          <div className="p-3 bg-n0 rounded text-sm text-n700 border border-n40 leading-relaxed">
                            {shot.scriptSegment}
                          </div>
                          <button
                            onClick={() => {
                              setEditingShotId(shot.id);
                              setEditingScriptSegment(shot.scriptSegment);
                            }}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1.5 bg-n30 hover:bg-n20 rounded transition-all"
                            title="编辑场景描述"
                          >
                            <Edit className="w-4 h-4 text-n700" />
                          </button>
                        </div>
                      )}
                    </div>


                    <div>
                      <label className="text-xs font-bold text-n300 block mb-2">原文段落（剧本原文）</label>
                      <details className="bg-n0 rounded border border-n40">
                        <summary className="p-3 cursor-pointer text-xs text-n300 hover:text-n700 select-none">
                          点击展开/收起原文
                        </summary>
                        <div className="p-3 pt-0 text-xs text-n300 max-h-48 overflow-y-auto custom-scrollbar">
                          {shot.originalText}
                        </div>
                      </details>
                    </div>


                    {hasDetails ? (
                      <div className="space-y-4 pt-4 border-t border-n40">
                        <h4 className="text-sm font-bold text-n700 flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-success" />
                          生成的详细信息
                        </h4>


                        {shot.imagePrompt && (
                          <div>
                            <label className="text-xs font-bold text-n300 block mb-2">图像生成提示词</label>
                            <div className="p-3 bg-n0 rounded text-sm text-n700 border border-n40 leading-relaxed">
                              {shot.imagePrompt}
                            </div>
                          </div>
                        )}


                        {shot.videoPrompt && (
                          <div>
                            <label className="text-xs font-bold text-n300 block mb-2">视频生成提示词</label>
                            <div className="p-3 bg-n0 rounded text-sm text-n700 border border-n40 leading-relaxed">
                              {shot.videoPrompt}
                            </div>
                          </div>
                        )}


                        {shot.dialogue && (
                          <div>
                            <label className="text-xs font-bold text-n300 block mb-2">台词</label>
                            <div className="p-3 bg-n0 rounded text-sm text-n700 border border-n40 italic">
                              "{shot.dialogue}"
                            </div>
                          </div>
                        )}


                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {shot.characters && shot.characters.length > 0 && (
                            <div>
                              <label className="text-xs font-bold text-n300 block mb-2">角色</label>
                              <div className="flex flex-wrap gap-1.5">
                                {shot.characters.map(char => (
                                  <span key={char} className="px-2 py-1 bg-primary-light text-primary rounded text-xs border border-primary">
                                    {char}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {shot.scene && (
                            <div>
                              <label className="text-xs font-bold text-n300 block mb-2">场景</label>
                              <div className="px-2 py-1 bg-n0 text-n700 rounded text-xs border border-n40">
                                📍 {shot.scene}
                              </div>
                            </div>
                          )}
                          {shot.props && shot.props.length > 0 && (
                            <div>
                              <label className="text-xs font-bold text-n300 block mb-2">道具</label>
                              <div className="flex flex-wrap gap-1.5">
                                {shot.props.map(prop => (
                                  <span key={prop} className="px-2 py-1 bg-y50 text-warning rounded text-xs border border-y75">
                                    {prop}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (

                      <div className="p-4 bg-b50 border border-b75 rounded-lg">
                        <div className="flex items-start gap-3">
                          <AlertOctagon className="w-5 h-5 text-b400 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <h4 className="text-sm font-bold text-b400 mb-1">尚未生成详细信息</h4>
                            <p className="text-xs text-b400 leading-relaxed">
                              此分镜仅提取了场景描述。
                              <br/>
                              请前往右侧 <strong className="text-b400">"镜头设计"</strong> 栏，点击 <strong className="text-b400">"一键生成分镜详情"</strong> 按钮，
                              <br/>
                              为所有分镜生成图像提示词、视频提示词、角色标签等详细信息。
                            </p>
                          </div>
                        </div>
                      </div>
                    )}


                    <div className="pt-4 border-t border-n40">
                      <label className="text-xs font-bold text-n300 block mb-3">快速操作（当前分镜）</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={async () => {

                            const instruction = prompt('请输入润色要求（可选）：', '使其更生动形象');
                            if (instruction !== null) {
                              try {
                                const { aiRefineScriptSegment } = await import('../services/aiModelService');
                                const refined = await aiRefineScriptSegment(
                                  aiModel,
                                  shot.scriptSegment,
                                  instruction || '使其更生动形象',
                                  selectedFile.scriptContent || ''
                                );

                                const updatedItems = selectedFile.storyboard!.items.map(i =>
                                  i.id === shot.id ? { ...i, scriptSegment: refined } : i
                                );
                                if (onUpdateStoryboardItems) {
                                  onUpdateStoryboardItems(updatedItems);
                                }
                                alert('✅ 润色完成！');
                              } catch (error) {
                                alert('❌ 润色失败: ' + (error as Error).message);
                              }
                            }
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-primary-light hover:bg-primary-light border border-primary text-primary hover:text-white rounded transition-all"
                        >
                          <Wand2 className="w-4 h-4" />
                          <span className="text-sm">润色</span>
                        </button>
                        <button
                          onClick={async () => {

                            const instruction = prompt('请输入扩写要求（可选）：', '增加更多细节描述');
                            if (instruction !== null) {
                              try {
                                const { aiRefineScriptSegment } = await import('../services/aiModelService');
                                const expanded = await aiRefineScriptSegment(
                                  aiModel,
                                  shot.scriptSegment,
                                  instruction || '扩写这一段，增加细节',
                                  selectedFile.scriptContent || ''
                                );

                                const updatedItems = selectedFile.storyboard!.items.map(i =>
                                  i.id === shot.id ? { ...i, scriptSegment: expanded } : i
                                );
                                if (onUpdateStoryboardItems) {
                                  onUpdateStoryboardItems(updatedItems);
                                }
                                alert('✅ 扩写完成！');
                              } catch (error) {
                                alert('❌ 扩写失败: ' + (error as Error).message);
                              }
                            }
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-g50 hover:bg-g75 border border-g75 text-success rounded transition-all"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span className="text-sm">扩写</span>
                        </button>
                        <button
                          onClick={async () => {

                            const count = prompt('拆分为几个镜头？', '2');
                            if (count && parseInt(count) > 1) {
                              try {
                                const { aiRestructureShot } = await import('../services/aiModelService');
                                const result = await aiRestructureShot(
                                  aiModel,
                                  shot.originalText || shot.scriptSegment,
                                  `拆分为${count}个独立镜头`,
                                  'split'
                                );


                                if (result.newStoryboardItems && result.newStoryboardItems.length > 0 && onUpdateStoryboardItems) {
                                  const currentIndex = selectedFile.storyboard!.items.findIndex(i => i.id === shot.id);
                                  const newItems = result.newStoryboardItems.map((item: any, idx: number) => ({
                                    id: `${Date.now()}-${idx}`,
                                    shotNumber: item.shotNumber || item.shotId || `${currentIndex + 1 + idx}`,
                                    originalText: item.originalText || shot.originalText,
                                    scriptSegment: item.scriptSegment || '',
                                    imagePrompt: item.imagePrompt,
                                    videoPrompt: item.videoPrompt,
                                    dialogue: item.dialogue,
                                    characters: item.characters,
                                    scene: item.scene,
                                    timestamp: Date.now()
                                  }));


                                  const updatedItems = [
                                    ...selectedFile.storyboard!.items.slice(0, currentIndex),
                                    ...newItems,
                                    ...selectedFile.storyboard!.items.slice(currentIndex + 1)
                                  ];

                                  onUpdateStoryboardItems(updatedItems);
                                  setShowShotPromptModal(false);
                                  alert(`✅ 拆分完成！已生成 ${newItems.length} 个新镜头`);
                                } else {
                                  alert('❌ 拆分失败: 未返回有效的分镜数据');
                                }
                              } catch (error) {
                                alert('❌ 拆分失败: ' + (error as Error).message);
                              }
                            }
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-orange-50 hover:bg-orange-200 border border-orange-200 text-orange-600 rounded transition-all"
                        >
                          <Split className="w-4 h-4" />
                          <span className="text-sm">拆分</span>
                        </button>
                        <button
                          onClick={() => {

                            alert('请在分镜脚本中框选多个镜头的文字，然后点击工具条的"合并"按钮');
                          }}
                          className="flex items-center justify-center gap-2 px-4 py-2 bg-b50 hover:bg-b75 border border-b75 text-primary rounded transition-all"
                        >
                          <Merge className="w-4 h-4" />
                          <span className="text-sm">合并</span>
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
