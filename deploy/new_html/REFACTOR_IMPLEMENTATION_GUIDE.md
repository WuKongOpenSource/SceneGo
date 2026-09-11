# 分镜工作流重构实现指南

## 📋 目录

1. [概述](#概述)
2. [新数据流](#新数据流)
3. [文件修改清单](#文件修改清单)
4. [详细实现步骤](#详细实现步骤)
5. [测试建议](#测试建议)
6. [常见问题](#常见问题)

---

## 概述

### 改动目标

将原来的"一次性生成所有分镜"改为"分阶段生成"：

**阶段1**: 提取分镜结构（只有originalText和scriptSegment）  
**阶段2**: 为每个分镜补充详细信息（imagePrompt、videoPrompt等）

### 核心优势

✅ **数据结构更清晰** - 分镜基础信息与详细信息分离  
✅ **用户可控性更强** - 可以在提取后预览、编辑分镜结构  
✅ **渐进式渲染** - 每生成一个分镜就显示一个  
✅ **更好的错误处理** - 单个分镜失败不影响其他分镜  

---

## 新数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ 第一栏：文件列表（FileColumn）                                    │
│ - 用户上传/选择文本文件                                           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 第二栏：文字脚本（ViewerColumn）                                  │
│ - 显示原始文本                                                    │
│ - 用户点击 [AI改写] 按钮                                          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 第三栏：分镜脚本（ScriptColumn）                                  │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🔄 流式输出改写后的剧本文本                                   │ │
│ │ （使用 aiRewriteNovelToScript 的 onStream 回调）             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                           ↓                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✅ 输出完成，显示完整剧本文本                                 │ │
│ │ [提取分镜和场景描述] 按钮                                     │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                           ↓                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🔄 调用 aiExtractShotsFromScript                             │ │
│ │ 返回: { items: [{ originalText, scriptSegment }] }          │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                           ↓                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✅ 解析JSON，创建分镜对象数组                                 │ │
│ │ 显示为可选择的文本段落（支持高亮、编辑）                      │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 第四栏：镜头设计（StoryboardColumn）                              │
│ - 用户点击 [生成当前分镜] 按钮                                    │
│                           ↓                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🔄 for循环每个分镜：                                          │ │
│ │   - 调用 aiGenerateShotDetails(originalText, scriptSegment) │ │
│ │   - 返回: { imagePrompt, videoPrompt, dialogue, ... }       │ │
│ │   - 拼接到对应分镜对象                                        │ │
│ │   - 立即渲染该分镜卡片                                        │ │
│ │   - 更新进度条 (i/total)                                      │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                           ↓                                       │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ✅ 所有分镜生成完成                                           │ │
│ │ 显示完整的分镜卡片列表                                        │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 文件修改清单

### ✅ 已完成

- [x] `types.ts` - 更新StoryboardItem类型
- [x] `aiModelService.ts` - 添加新的AI调用函数

### 📝 待修改

- [ ] `App.tsx` - 核心数据流逻辑
- [ ] `ViewerColumn.tsx` - 改写按钮行为
- [ ] `ScriptColumn.tsx` - 提取分镜功能 + UI交互
- [ ] `StoryboardColumn.tsx` - 循环生成逻辑

---

## 详细实现步骤

### 第一步：修改 App.tsx

#### 1.1 添加新的状态管理

```typescript
// 在 App.tsx 的 state 声明区域添加：

const [isShotExtracting, setIsShotExtracting] = useState(false); // 提取分镜loading
const [shotGenerationProgress, setShotGenerationProgress] = useState<{current: number; total: number} | null>(null); // 生成进度
```

#### 1.2 修改 handleRewrite 函数（支持流式输出到ScriptColumn）

```typescript
const handleRewrite = useCallback(async (targetFileId?: string) => {
    setIsProcessing(true);
    
    const idsToRewrite = targetFileId 
        ? [targetFileId] 
        : checkedFileIds.size > 0 
            ? Array.from(checkedFileIds) 
            : selectedFileId 
                ? [selectedFileId] 
                : [];

    for (const id of idsToRewrite) {
        try {
            updateFileStatus(id, FileStatus.Processing);
            const file = files.find(f => f.id === id);
            if (!file) continue;

            // 🔧 关键改动：使用 onStream 回调实时更新 scriptContent
            let streamedContent = '';
            const finalScript = await aiRewriteNovelToScript(
                aiModel, 
                file.originalContent, 
                (chunk) => {
                    // 流式更新
                    streamedContent += chunk;
                    setFiles(prevFiles => prevFiles.map(f => 
                        f.id === id 
                            ? { ...f, scriptContent: streamedContent, status: FileStatus.Processing } 
                            : f
                    ));
                }
            );

            // ✅ 流式输出完成，更新最终状态
            updateFileWithHistory(id, (f) => ({
                ...f,
                scriptContent: finalScript,
                status: FileStatus.Idle
            }));

        } catch (error) {
            console.error(`Rewrite failed for ${id}`, error);
            updateFileStatus(id, FileStatus.Error);
            alert(`改写失败: ${(error as Error).message}`);
        }
    }
    
    setIsProcessing(false);
}, [files, checkedFileIds, selectedFileId, aiModel, updateFileStatus, updateFileWithHistory]);
```

#### 1.3 新增 handleExtractShots 函数

```typescript
/**
 * 🆕 从剧本中提取分镜和场景描述
 */
const handleExtractShots = useCallback(async () => {
    if (!selectedFile?.scriptContent) {
        alert('请先生成剧本内容');
        return;
    }

    setIsShotExtracting(true);
    try {
        console.log('📤 开始提取分镜...');
        
        // 调用AI提取分镜
        const result = await aiExtractShotsFromScript(aiModel, selectedFile.scriptContent);
        
        console.log('✅ 提取成功，分镜数量:', result.items.length);
        
        // 转换为StoryboardItem数组
        const storyboardItems: StoryboardItem[] = result.items.map((item, index) => ({
            id: uuidv4(),
            shotNumber: index + 1,
            originalText: item.originalText,
            scriptSegment: item.scriptSegment,
            timestamp: Date.now(),
            // 其他字段为空，等待后续生成
            imagePrompt: undefined,
            videoPrompt: undefined,
            dialogue: undefined,
            characters: undefined,
            scene: undefined
        }));
        
        // 更新到文件的storyboard
        updateFileWithHistory(selectedFile.id, (f) => ({
            ...f,
            storyboard: { items: storyboardItems }
        }));
        
        console.log('✅ 分镜已保存到状态');
        
    } catch (error) {
        console.error('❌ 提取分镜失败:', error);
        alert(`提取分镜失败: ${(error as Error).message}`);
    } finally {
        setIsShotExtracting(false);
    }
}, [selectedFile, aiModel, updateFileWithHistory]);
```

#### 1.4 修改 handleGenerateStoryboard（改为循环模式）

```typescript
/**
 * 🔧 修改为循环模式：逐个生成分镜详情
 */
const handleGenerateStoryboard = useCallback(async (fileId: string) => {
    const file = files.find(f => f.id === fileId);
    
    if (!file?.storyboard?.items || file.storyboard.items.length === 0) {
        alert('请先提取分镜和场景描述');
        return;
    }

    setIsProcessing(true);
    setShotGenerationProgress({ current: 0, total: file.storyboard.items.length });

    try {
        const updatedItems: StoryboardItem[] = [];
        
        // 🔄 for循环逐个生成
        for (let i = 0; i < file.storyboard.items.length; i++) {
            const item = file.storyboard.items[i];
            
            console.log(`🎬 正在生成第 ${i + 1}/${file.storyboard.items.length} 个分镜...`);
            
            try {
                // 调用AI生成详细信息
                const details = await aiGenerateShotDetails(
                    aiModel,
                    item.originalText,
                    item.scriptSegment,
                    // 可选：用户自定义要求（可以从UI获取）
                    undefined
                );
                
                // 拼接到当前分镜
                const completeItem: StoryboardItem = {
                    ...item,
                    ...details,
                    timestamp: Date.now()
                };
                
                updatedItems.push(completeItem);
                
                // ✅ 立即更新状态，渲染当前分镜
                updateFileWithHistory(fileId, (f) => ({
                    ...f,
                    storyboard: { items: updatedItems }
                }));
                
                // 更新进度
                setShotGenerationProgress({ current: i + 1, total: file.storyboard.items.length });
                
                console.log(`✅ 第 ${i + 1} 个分镜生成完成`);
                
            } catch (error) {
                console.error(`❌ 第 ${i + 1} 个分镜生成失败:`, error);
                // 失败时保留原始数据，继续下一个
                updatedItems.push(item);
            }
        }
        
        console.log('🎉 所有分镜生成完成！');
        
    } catch (error) {
        console.error('❌ 批量生成失败:', error);
        alert(`生成失败: ${(error as Error).message}`);
    } finally {
        setIsProcessing(false);
        setShotGenerationProgress(null);
    }
}, [files, aiModel, updateFileWithHistory]);
```

#### 1.5 传递新的props到子组件

```typescript
// 在 renderContent() 中传递新的props：

{visibleColumns[2] && (
<div ...>
    <ScriptColumn 
        selectedFile={selectedFile}
        checkedCount={checkedFileIds.size}
        onGenerateStoryboard={handleGenerateStoryboard}
        onExtractMetadata={handleExtractMetadata}
        onRefineScript={handleRefineScript}
        onRestructure={handleRestructure}
        onUpdateScript={handleUpdateScript}
        isProcessing={isProcessing}
        
        // 🆕 新增props
        onExtractShots={handleExtractShots}
        isShotExtracting={isShotExtracting}
        
        isExpanded={!isFullView && visibleColumns[2]}
        onToggleExpand={() => {}}
        highlightedTextSegments={highlightedScriptSegments}
        highlightedItemIds={highlightedStoryboardItemIds}
        onSelectionChange={handleScriptSelectionChange}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
    />
</div>
)}

{visibleColumns[3] && (
<div ...>
    <StoryboardColumn 
        selectedFile={selectedFile}
        onGenerateStoryboard={handleGenerateStoryboard}
        isProcessing={isProcessing}
        
        // 🆕 新增props
        generationProgress={shotGenerationProgress}
        
        isExpanded={!isFullView && visibleColumns[3]}
        onToggleExpand={() => {}}
        onHighlightScript={handleStoryboardSelectionChange}
        onSaveVersion={handleSaveVersion}
        onRestoreVersion={handleRestoreVersion}
        onRestructure={handleRestructure}
        onRegenerateSingleShot={handleRegenerateSingleShot}
        materialLibrary={materialLibrary}
        onUpdateMaterialSelection={handleUpdateMaterialSelection}
        onExport={handleExportStoryboard}
    />
</div>
)}
```

---

### 第二步：修改 ScriptColumn.tsx

#### 2.1 更新接口定义

```typescript
interface ScriptColumnProps {
  selectedFile: ProjectFile | undefined;
  checkedCount: number;
  onGenerateStoryboard: (fileId: string) => Promise<void>;
  onExtractMetadata: (fileId: string) => Promise<void>;
  onRefineScript: (selection: string, instruction: string) => Promise<void>;
  onRestructure: (selection: string, instruction: string, type: 'split' | 'merge') => Promise<void>;
  onUpdateScript: (fileId: string, content: string) => void;
  isProcessing: boolean;
  
  // 🆕 新增props
  onExtractShots: () => Promise<void>;
  isShotExtracting: boolean;
  
  isExpanded: boolean;
  onToggleExpand: () => void;
  highlightedTextSegments: Set<string>;
  highlightedItemIds: Set<string>;
  onSelectionChange: (segments: Set<string>, items: Set<string>) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}
```

#### 2.2 添加"提取分镜和场景描述"按钮

```typescript
export const ScriptColumn: React.FC<ScriptColumnProps> = ({
  selectedFile,
  onExtractShots,
  isShotExtracting,
  isProcessing,
  // ... 其他props
}) => {
  // ... 现有代码

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-900 to-gray-950">
      {/* Header */}
      <div className="bg-gray-900/70 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-yellow-500" />
            <h3 className="font-bold text-white">分镜脚本</h3>
          </div>
        </div>

        {/* 🆕 提取分镜按钮 */}
        {selectedFile?.scriptContent && !selectedFile?.storyboard && (
          <button
            onClick={onExtractShots}
            disabled={isShotExtracting || isProcessing}
            className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-sm transition-all ${
              isShotExtracting || isProcessing
                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-lg shadow-purple-900/50'
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
                <span>提取分镜和场景描述</span>
              </>
            )}
          </button>
        )}

        {/* 已有分镜时显示提示 */}
        {selectedFile?.storyboard && (
          <div className="flex items-center gap-2 px-3 py-2 bg-green-900/20 border border-green-500/30 rounded text-xs text-green-400">
            <CheckCircle className="w-4 h-4" />
            <span>已提取 {selectedFile.storyboard.items.length} 个分镜</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {selectedFile?.scriptContent ? (
          <div className="p-6">
            {/* 🔧 这里可以添加文本选择、高亮等功能 */}
            <pre className="whitespace-pre-wrap font-serif text-gray-300 leading-relaxed">
              {selectedFile.scriptContent}
            </pre>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-gray-600">
            <ScrollText className="w-12 h-12 mb-4 opacity-20" />
            <p>等待生成剧本内容...</p>
          </div>
        )}
      </div>
    </div>
  );
};
```

#### 2.3 （可选）添加文本高亮和编辑功能

如果需要支持框选文本高亮和编辑，可以参考以下实现：

```typescript
// 在ScriptColumn中添加：

const [selectedText, setSelectedText] = useState<string>('');
const [selectionRange, setSelectionRange] = useState<{start: number; end: number} | null>(null);
const [showPromptModal, setShowPromptModal] = useState(false);

const handleTextSelection = () => {
  const selection = window.getSelection();
  const text = selection?.toString() || '';
  
  if (text.trim()) {
    setSelectedText(text);
    // 可以在这里显示编辑弹窗或高亮该段文本
    console.log('选中文本:', text);
  }
};

// 在textarea或pre元素上添加：
<pre 
  onMouseUp={handleTextSelection}
  onTouchEnd={handleTextSelection}
  className="..."
>
  {selectedFile.scriptContent}
</pre>
```

---

### 第三步：修改 StoryboardColumn.tsx

#### 3.1 更新接口定义

```typescript
interface StoryboardColumnProps {
  selectedFile: ProjectFile | undefined;
  onGenerateStoryboard: (fileId: string) => Promise<void>;
  isProcessing: boolean;
  
  // 🆕 新增props
  generationProgress: { current: number; total: number } | null;
  
  isExpanded: boolean;
  onToggleExpand: () => void;
  onHighlightScript: (segments: Set<string>, items: Set<string>) => void;
  onSaveVersion: (fileId: string, versionName: string) => void;
  onRestoreVersion: (fileId: string, versionId: string) => void;
  onRestructure: (selection: string, instruction: string, type: 'split' | 'merge') => Promise<void>;
  onRegenerateSingleShot: (selection: string, instruction?: string) => Promise<void>;
  materialLibrary: MaterialLibrary;
  onUpdateMaterialSelection: (fileId: string, itemId: string, tagName: string, materialId: string) => void;
  onExport: () => void;
}
```

#### 3.2 添加进度显示

```typescript
export const StoryboardColumn: React.FC<StoryboardColumnProps> = ({
  selectedFile,
  onGenerateStoryboard,
  isProcessing,
  generationProgress,
  // ... 其他props
}) => {
  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-900 to-gray-950">
      {/* Header */}
      <div className="bg-gray-900/70 border-b border-gray-800 px-6 py-4">
        {/* ... 现有header内容 */}

        {/* 🆕 进度显示 */}
        {generationProgress && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
              <span>正在生成分镜详情...</span>
              <span>{generationProgress.current} / {generationProgress.total}</span>
            </div>
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-300"
                style={{ width: `${(generationProgress.current / generationProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* 生成按钮 */}
        {selectedFile?.storyboard && (
          <button
            onClick={() => onGenerateStoryboard(selectedFile.id)}
            disabled={isProcessing}
            className={`w-full mt-3 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-bold text-sm transition-all ${
              isProcessing
                ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                : 'bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white shadow-lg shadow-green-900/50'
            }`}
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                <span>生成中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>生成当前分镜</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Content - 分镜卡片列表 */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
        {selectedFile?.storyboard?.items.map((item, index) => (
          <div 
            key={item.id}
            className="bg-gray-800/50 border border-gray-700 rounded-lg p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-400">
                镜头 #{item.shotNumber || index + 1}
              </span>
              {item.imagePrompt ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <Clock className="w-4 h-4 text-gray-600" />
              )}
            </div>

            {/* 场景描述 */}
            <div className="text-sm text-gray-300 mb-2">
              {item.scriptSegment}
            </div>

            {/* 详细信息（如果已生成） */}
            {item.imagePrompt && (
              <div className="mt-3 space-y-2 text-xs">
                <div>
                  <span className="text-gray-500">图像提示：</span>
                  <p className="text-gray-400 mt-1">{item.imagePrompt}</p>
                </div>
                {item.dialogue && (
                  <div>
                    <span className="text-gray-500">台词：</span>
                    <p className="text-gray-400 mt-1">{item.dialogue}</p>
                  </div>
                )}
                {item.characters && item.characters.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">角色：</span>
                    {item.characters.map(char => (
                      <span key={char} className="px-2 py-0.5 bg-indigo-900/30 text-indigo-400 rounded">
                        {char}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

### 第四步：修改 ViewerColumn.tsx（可选，较小改动）

如果需要"改写"按钮触发ScriptColumn的流式输出，实际上App.tsx中的handleRewrite已经实现了流式更新。ViewerColumn不需要大的改动。

但如果想要更明确的视觉反馈，可以添加：

```typescript
// 在ViewerColumn的改写按钮上添加提示
<button
  onClick={handleMainAction}
  disabled={isProcessing || (!selectedFile && checkedCount === 0)}
  className="..."
  title="改写后的内容将在右侧分镜脚本栏实时显示"
>
  {getButtonText()}
</button>
```

---

## 测试建议

### 单元测试

1. **测试aiExtractShotsFromScript**
   ```typescript
   const testScript = `【场景：测试场景】
   （测试动作描述）
   角色A："测试台词"`;
   
   const result = await aiExtractShotsFromScript(AiModel.Gemini, testScript);
   console.log('提取结果:', result);
   ```

2. **测试aiGenerateShotDetails**
   ```typescript
   const details = await aiGenerateShotDetails(
     AiModel.Gemini,
     '【场景：测试场景】',
     '测试场景描述'
   );
   console.log('详情结果:', details);
   ```

### 集成测试

1. **完整流程测试**
   - 上传文本 → 改写 → 提取分镜 → 生成详情
   - 验证每个阶段的数据格式
   - 验证UI是否正确渲染

2. **边界情况测试**
   - 空文本
   - 超长文本（>10000字）
   - 网络错误时的重试
   - 中途取消操作

3. **性能测试**
   - 大量分镜（>50个）的生成时间
   - 流式输出的流畅度
   - 内存占用情况

---

## 常见问题

### Q1: AI返回的JSON格式不正确怎么办？

**A**: 在解析前先清理：

```typescript
const cleanResponse = response
  .replace(/```json\n?/g, '')
  .replace(/```\n?/g, '')
  .trim();

try {
  return JSON.parse(cleanResponse);
} catch (error) {
  console.error('JSON解析失败:', cleanResponse);
  throw new Error('AI返回格式错误，请重试');
}
```

### Q2: 如何处理单个分镜生成失败？

**A**: 在for循环中使用try-catch，失败时保留原始数据：

```typescript
for (let i = 0; i < items.length; i++) {
  try {
    const details = await aiGenerateShotDetails(...);
    updatedItems.push({ ...item, ...details });
  } catch (error) {
    console.error(`分镜${i+1}失败:`, error);
    // 保留原始数据，继续下一个
    updatedItems.push(item);
  }
}
```

### Q3: 如何添加"取消生成"功能？

**A**: 使用AbortController：

```typescript
const abortController = new AbortController();

// 在for循环前
setAbortController(abortController);

// 在循环中检查
for (let i = 0; i < items.length; i++) {
  if (abortController.signal.aborted) {
    console.log('用户取消生成');
    break;
  }
  // ... 生成逻辑
}

// 添加取消按钮
<button onClick={() => abortController.abort()}>取消</button>
```

### Q4: 如何保存/恢复进度？

**A**: 已生成的分镜会实时保存到state，刷新页面会丢失。建议：

1. 使用App.tsx的自动保存功能（已有的saveToBackend）
2. 或在每个分镜生成后手动调用保存
3. 从后端恢复时检查哪些分镜已有imagePrompt

### Q5: 如何优化大量分镜的生成速度？

**A**: 可以考虑：

1. **并发生成**（谨慎使用，避免API限流）
   ```typescript
   const batchSize = 3;
   for (let i = 0; i < items.length; i += batchSize) {
     const batch = items.slice(i, i + batchSize);
     await Promise.all(batch.map(item => generateDetails(item)));
   }
   ```

2. **优先生成可见分镜**
   - 先生成前5个
   - 其余在后台生成

3. **缓存已生成的分镜**
   - 检查item.imagePrompt是否存在
   - 存在则跳过

---

## 实现检查清单

使用以下清单确保实现完整：

### 数据层
- [ ] types.ts 已更新StoryboardItem
- [ ] aiModelService.ts 已添加两个新函数
- [ ] AI Prompt 测试通过

### App.tsx
- [ ] handleRewrite 支持流式输出
- [ ] handleExtractShots 实现完成
- [ ] handleGenerateStoryboard 改为循环模式
- [ ] 新状态变量已添加
- [ ] props 正确传递到子组件

### ScriptColumn.tsx
- [ ] 接口props已更新
- [ ] "提取分镜"按钮已添加
- [ ] loading状态显示
- [ ] 已提取分镜的提示显示

### StoryboardColumn.tsx
- [ ] 接口props已更新
- [ ] 进度条显示
- [ ] 分镜卡片渲染
- [ ] 区分已生成/未生成状态

### 测试
- [ ] AI函数单独测试
- [ ] 完整流程测试
- [ ] 错误处理测试
- [ ] UI交互测试

---

## 下一步优化建议

实现基础功能后，可以考虑：

1. **高级编辑功能**
   - 框选文本高亮
   - 双击编辑scriptSegment
   - 分镜合并/拆分UI

2. **批量操作**
   - 选中多个分镜重新生成
   - 批量应用风格设置

3. **模板系统**
   - 保存常用的生成参数
   - 快速应用到新项目

4. **导出功能**
   - 导出分镜表（PDF/Excel）
   - 导出JSON数据

---

## 总结

这个重构的核心思路是**分阶段、渐进式生成**，给用户更多控制权。实现时注意：

1. **先实现核心流程**：提取 → 显示 → 生成
2. **再添加交互功能**：编辑、高亮、合并拆分
3. **最后优化体验**：进度显示、错误处理、性能优化

如有问题，请随时参考本文档或提问！🚀

