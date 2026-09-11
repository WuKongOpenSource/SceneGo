import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../../WorkspaceApp.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');
const generationPageSource = readFileSync(resolve(__dirname, '../../components/GenerationPage.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');
const storyboardColumnSource = readFileSync(resolve(__dirname, '../../components/StoryboardColumn.tsx'), 'utf-8')
  .replace(/\r\n/g, '\n');

describe('WorkspaceApp script workflow persistence', () => {
  it('protects the final script file without silently clearing its content', () => {
    expect(source).toContain('if (files.length <= 1)');
    expect(source).toContain('每个分集至少需要保留一个剧本文件，最后一个剧本不能删除。请先新建或上传另一个剧本。');
    expect(source).not.toMatch(/if \(files\.length <= 1\) \{[\s\S]{0,500}originalContent: ''/);
  });

  it('persists only the script record whose content changed', () => {
    expect(source).toContain('savedScriptSignaturesRef.current[file.id] === signature');
    expect(source).toContain('updateEpisodeScriptById(propEpisodeId, file.id');
  });

  it('generates and persists a source-bound story summary after file import', () => {
    expect(source).toContain('const sourceHash = await sha256Text(text)');
    expect(source).toContain("story_summary_status: 'pending'");
    expect(source).toContain('const summary = await generateStorySummary(text');
    expect(source).toContain('story_summary: summary');
    expect(source).toContain('story_summary_source_sha256: sourceHash');
    expect(source).toContain("story_summary_status: 'failed'");
    expect(source).toContain('已导入，但故事概要生成失败；可在配乐页重试');
  });

  it('persists the one-sentence create idea into the matching episode before showing the script workspace', () => {
    expect(source).toContain('readCreateIdeaSeed(sessionStorage, propEpisodeId)');
    expect(source).toContain('original_content: pendingCreateIdea.sentence');
    expect(source).toContain("original_content: pendingCreateIdea?.sentence || ''");
    expect(source).toContain('if (pendingCreateIdeaHandled) clearCreateIdeaSeed(sessionStorage)');
  });

  it('replaces the active storyboard design only after archiving the previous current design', () => {
    expect(source).toContain('const archiveActiveStoryboardIfPresent = useCallback');
    expect(source).toContain('const replaceActiveStoryboardDesign = useCallback');
    expect(source).toContain('await archiveActiveStoryboardIfPresent(fileId, { name: options.archiveName })');
    expect(source).toContain('batchCreateStoryboardItems(');
    expect(source).toContain("(file.storyboard?.items || []).filter(item => !item.isPlaceholder)");
  });

  it('exports the current script by adopting it first without replacing persisted storyboards', () => {
    expect(source).toContain('const exportFileId = selectedFileId || activeScriptId');
    expect(source).toContain('filesRef.current.find(file => file.id === exportFileId)');
    expect(source).toContain('await activateWorkflowScript(exportFileId)');
    expect(source).toContain('await syncStoryboardItems(\n            eid,\n            buildStoryboardDbPayload(exportableItems)');
    expect(source).toContain('preserve_existing_storyboards: true');
    expect(source).toContain('item_id: item.id');
    expect(source).toContain("const charSet = new Set<string>();");
    expect(source).toContain("'meta:bindings-initialized'");
    expect(source).toContain("...buildDefaultBindingSnapshot(item.characters || [], item.scene || '', item.props || [])");
    expect(source).toContain('storyboard_items: []');
    expect(source).toContain("buildScriptAssetDescriptionRows(\n            'character'");
    expect(source).toContain('characters: characterRows');
    expect(source).toContain('scenes: sceneRows');
    expect(source).toContain('props: propRows');
    expect(source).not.toContain("charNames.map(n => ({ name: n, description: '' }))");
    expect(source).not.toContain('当前浏览的不是本集后续采用剧本，请先在文件列表中设为后续采用。');
    expect(storyboardColumnSource).toContain('导出到角色和场景');
    expect(storyboardColumnSource).not.toContain("'全部导出'");
  });

  it('downloads a complete JSON workspace backup from the file column', () => {
    expect(source).toContain("format: 'ostory-project-backup'");
    expect(source).toContain('const BACKUP_STORYBOARD_PAGE_SIZE = 200');
    expect(source).toContain('offset: storyboardRows.length');
    expect(source).toContain('mapWorkspaceStoryboardRowsToItems(persistedRows)');
    expect(source).toContain('files: exportedFiles');
    expect(source).toContain('material_library: materialLibraryRef.current');
    expect(source).toContain('script_conversations: exportedConversations');
    expect(source).toContain('JSON.stringify(payload, null, 2)');
    expect(source).toContain('onExportProject={handleExportProject}');
    expect(source).toContain('window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)');
  });

  it('appends persistent storyboard snapshots after generation and manual saves', () => {
    expect(source).toContain('const persistStoryboardSnapshot = useCallback');
    expect(source).toContain('waitForRemote?: boolean');
    expect(source).toContain('if (options.waitForRemote === false)');
    expect(source).toContain('void persistRemoteSnapshot().catch');
    expect(source).toContain('resolvePersistableStoryboardVersion(conversation, options.version)');
    expect(source).toContain('await persistRemoteSnapshot();');
    expect(source).toContain('applyLocalSnapshot();');
    expect(source).toContain('{ [STORYBOARD_SNAPSHOTS_METADATA_KEY]: snapshots }');
    expect(source).toContain("source: 'auto'");
    expect(source).toContain("source: 'manual'");
    expect(source).toContain('collectConversationStoryboardSnapshots(mergedConversation)');
    expect(source).toContain('handleConversationGenerateDesign(version, { autoSnapshot: false })');
  });

  it('waits for manual snapshot persistence and keeps save failures visible', () => {
    expect(source).toMatch(/source: 'manual',\n\s*\}\);/);
    expect(generationPageSource).toContain('await onSaveVersion(versionName.trim());');
    expect(generationPageSource).toContain("setVersionSaveError(error instanceof Error ? error.message : '存档保存失败，请稍后重试');");
    expect(generationPageSource).toContain("{isSavingVersion ? '保存中...' : '确认保存'}");
    expect(generationPageSource).toContain('setShowHistory(true);');
  });

  it('offers persistent writing and the master four-column quick pipeline', () => {
    expect(source).toContain("readScriptWorkspaceMode(localStorage, scriptWorkspaceUsername)");
    expect(source).toContain("writeScriptWorkspaceMode(localStorage, scriptWorkspaceUsername, mode)");
    expect(source).toContain("scriptWorkspaceMode === 'writing'");
    expect(source).toContain('data-testid="quick-script-workspace"');
    expect(source).toContain('<QuickScriptSourceColumn');
    expect(source).toContain('<QuickScriptVersionColumn');
    expect(source).toContain('onSplitScript={handleSplitScript}');
    expect(source).toContain('onGenerateVideoScript={handleGenerateVideoScript}');
    expect(source).toContain('onExtractStoryboardPrompts={handleExtractStoryboardPrompts}');
    expect(source).toContain('onRunThreeStage={handleRunThreeStagePipeline}');
    expect(source).toContain("scriptWorkspaceMode === 'reverse'");
    expect(source).toContain('data-testid="video-reverse-workspace"');
    expect(source).toContain('onEditVersion={handleConversationEditVersion}');
    expect(source).toContain('handleConversationGenerateDesign(version, { openDrawer: false })');
    expect(source).toContain('version={quickPipelineVersion}');
    expect(source).toContain('versions={quickAvailableVersions}');
    expect(source).toContain('onSelectVersion={handleQuickSelectVersion}');
    expect(source).toContain('selectedFile={selectedFile}');
    expect(source).not.toContain('onSend={handleRewrite}');
    expect(source).not.toContain('onSend={handleIterateScript}');
  });

  it('shares generated script content between writing and quick modes without overwriting history', () => {
    expect(source).toContain('function mergeScriptConversationWithLocalFile');
    expect(source).toContain('normalizeScriptContentForCompare(version.content) === localContent');
    expect(source).toContain("!matchingVersion.id.startsWith('legacy_')");
    expect(source).toContain('currentVersionId: localVersion.id');
    expect(source).toContain('const rawSelectedConversation = selectedFileId ? scriptConversations[selectedFileId] : undefined');
    expect(source).toContain('() => mergeScriptConversationWithLocalFile(selectedFile, rawSelectedConversation)');
    expect(source).toContain('const quickPipelineVersion = quickAvailableVersions.find');
    expect(source).toContain('buildLocalScriptVersionStoryboardItems(file)');
    expect(source).toContain('const syncScriptConversationFromFile = useCallback');
    expect(source).toContain('messages: [...current.messages.filter(item => item.id !== message.id), message]');
    expect(source).toContain('versions: [...current.versions.filter(item => item.id !== selectedVersion.id), selectedVersion]');
    expect(source).toContain('mergeScriptConversationWithLocalFile(file, scriptConversations[fileId])');
  });

  it('refreshes writing mode without dropping quick versions created during a stale history request', () => {
    expect(source).toContain('function mergePersistedScriptConversation');
    expect(source).toContain('const cachedOnlyMessages = cached.messages.filter');
    expect(source).toContain('const cachedOnlyVersions = cached.versions.filter');
    expect(source).toContain('cached.currentVersionId && !persistedVersionIds.has(cached.currentVersionId)');
    expect(source).toContain('const refreshScriptConversationForWriting = useCallback');
    expect(source).toContain("if (mode === 'writing' && selectedFileId && !selectedFileId.startsWith('local_'))");
    expect(source).toContain('void refreshScriptConversationForWriting(selectedFileId)');
    expect(source).toContain('mergePersistedScriptConversation(latestFile, conversation, prev[selectedFileId])');
  });

  it('uses the generation prompt initially and a scope-locked iteration prompt for revisions', () => {
    expect(source).toContain('const { aiGenerateStoryboardScript } = await loadAiModelService()');
    expect(source).toContain('result = await aiGenerateStoryboardScript(');
    expect(source).toContain('result = await handleIterateScript(');
    expect(source).toContain('selectScriptIterationBaseVersion(conversation)');
    expect(source).toContain('buildScriptVersionChainContext(conversation, currentVersion)');
    expect(source).toContain('baseVersionId: isFirstTurn ? undefined : currentVersion?.id');
    expect(source).toContain('stabilizeScriptIterationResult(generationSource, normalizedCandidate, generationRequirements)');
    expect(source).toContain('appendStreamChunk');
    expect(source).toContain('const normalizedCandidate = normalizeGeneratedVideoScript(rawFinalContent)');
    expect(source).toContain('parseVideoScriptGroups(content).map(group => [group.groupNo, group.sharedVideoPrompt])');
    expect(source).toContain('const videoPrompt = groupPrompts.get(segmentNo) || item.videoPrompt');
    expect(source).toContain("stage: 'directStoryboardScript'");
    expect(source).toContain("const billingInput = isFirstTurn\n      ? content");
    expect(source).not.toContain('pipelineService.generateEpisodeVideoScript');
    expect(source).not.toContain('pipelineService.iterateEpisodeVideoScript');
    expect(source).not.toContain('assertValidVideoScript(normalizedContent)');
  });

  it('reconciles rejection clicks when the server says the version was already confirmed', () => {
    expect(source).toContain("rejection.outcome === 'already_confirmed'");
    expect(source).toContain('currentVersionId: rejection.currentVersionId || current.currentVersionId');
    expect(source).toContain('scriptContent: rejected.content');
  });

  it('runs quick generation through the retained master three-stage handlers', () => {
    expect(source).toContain('const handleSplitScript = useCallback');
    expect(source).toContain('const handleGenerateVideoScript = useCallback');
    expect(source).toContain('const handleExtractStoryboardPrompts = useCallback');
    expect(source).toContain('const handleRunThreeStagePipeline = useCallback');
    expect(source).toContain('const splitOk = await handleSplitScript(file.id)');
    expect(source).toContain('const videoScriptVersion = await handleGenerateVideoScript(file.id)');
    expect(source).toContain('await handleExtractStoryboardPrompts(file.id, { sourceVersion: videoScriptVersion })');
    expect(source).toContain('if (!splitOk) return;');
    expect(source).toContain("throw new Error('模型未返回可用的剧本分段')");
    expect(source).toContain('splitScriptIntoValidatedSegments(aiModel, file.originalContent');
    expect(source).toContain("if (progress.stage === 'split')");
    expect(source).toContain('generateVideoScriptForSegments(');
    expect(source).toContain("await assertEnoughCredits('script_model_call'");
    expect(source).toContain("featureKey: 'script_model_call'");
    expect(source).toContain("operation: 'quick_video_script'");
    expect(source).toContain('createScriptVersion(propEpisodeId, file.id');
    expect(source).toContain('setCurrent: false');
    expect(source).toContain('clearActiveStoryboardDesign(file.id');
    expect(source).toContain('onRunThreeStage={handleRunThreeStagePipeline}');
    expect(source).not.toContain('handleQuickThreeStageGenerate');
  });

  it('keeps the file rail fixed when switching between writing and quick mode', () => {
    expect(source).toContain('data-testid="quick-script-workspace"');
    expect(source).toContain('className="workflow-stage-sidebar relative h-full w-[280px] flex-shrink-0 overflow-hidden border-r border-n40"');
    expect(source).toContain('data-testid="quick-script-canvas"');
    expect(source).toContain("style={{ width: 0, flex: '1 1 0%' }}");
    expect(source).toContain('data-testid="quick-script-columns"');
    expect(source).toContain('className="flex h-full w-full min-w-[900px] max-w-none gap-2 overflow-hidden bg-n20 p-2"');
  });

  it('presents the three quick work areas as separate cards on a quiet canvas', () => {
    expect(source.match(/data-testid="quick-script-card-panel"/g)).toHaveLength(3);
    expect(source).toContain('data-panel="source"');
    expect(source).toContain('data-panel="version"');
    expect(source).toContain('data-panel="design"');
    expect(source).toContain('rounded-md border border-n40 bg-n0 shadow-card');
    expect(source).toContain('cardMode');
  });
});
