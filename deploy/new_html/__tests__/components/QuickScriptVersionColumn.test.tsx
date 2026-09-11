// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickScriptVersionColumn } from '../../components/QuickScriptVersionColumn';
import { FileStatus, type ProjectFile, type ScriptStoryboardVersion } from '../../types';

afterEach(cleanup);

const item = {
  id: 'shot-1',
  shotNumber: '镜头1-1',
  originalText: '镜头1-1\n主角推门进入。',
  scriptSegment: '主角推门进入。',
  videoPrompt: '',
  imagePrompt: '',
  dialogue: '',
  characters: [],
};

const file = {
  id: 'script-1',
  name: '分集剧本',
  originalContent: '文字剧本',
  scriptContent: '镜头1-1\n主角推门进入。',
  storyboard: null,
  extractedCharacters: [],
  extractedScenes: [],
  extractedProps: [],
  status: FileStatus.Completed,
  lastUpdated: Date.now(),
  versions: [],
} as ProjectFile;

const version = {
  id: 'version-1',
  scriptId: 'script-1',
  versionNo: 1,
  content: '镜头1-1\n主角推门进入。',
  storyboardItems: [item],
  source: 'ai',
  status: 'ready',
  modelAlias: 'DK金丹',
  modelName: 'deepseek-v4-flash',
  createdAt: Date.now(),
  updatedAt: Date.now(),
} as ScriptStoryboardVersion;

describe('QuickScriptVersionColumn', () => {
  it('uses version-safe edit, export and design callbacks', async () => {
    const onEditVersion = vi.fn().mockResolvedValue(undefined);
    const onGenerateDesign = vi.fn().mockResolvedValue(undefined);
    const onExportVersion = vi.fn();

    render(
      <QuickScriptVersionColumn
        selectedFile={file}
        version={version}
        isSending={false}
        error={null}
        highlightedItemIds={new Set()}
        onDismissError={vi.fn()}
        onSelectItemIds={vi.fn()}
        onEditVersion={onEditVersion}
        onGenerateDesign={onGenerateDesign}
        onExportVersion={onExportVersion}
      />,
    );

    expect(screen.getByText('deepseek-v4-flash · 快速写作模型')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /分镜1-1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '生成镜头设计' }));
    expect(onGenerateDesign).toHaveBeenCalledWith(version);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(onExportVersion).toHaveBeenCalledWith(version);

    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    const editor = screen.getByLabelText('编辑分镜脚本');
    expect(editor).toHaveClass('font-document');
    expect(editor).not.toHaveClass('font-mono');
    fireEvent.change(editor, {
      target: { value: '镜头1-1\n主角缓慢推门进入。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版' }));

    await waitFor(() => expect(onEditVersion).toHaveBeenCalledWith(
      version,
      '镜头1-1\n主角缓慢推门进入。',
    ));
  });

  it('switches visible script versions without regenerating design', () => {
    const onSelectVersion = vi.fn();
    const version2 = {
      ...version,
      id: 'version-2',
      versionNo: 2,
      content: '镜头1-1\n主角停在门口。',
      storyboardItems: [{ ...item, id: 'shot-v2', originalText: '镜头1-1\n主角停在门口。' }],
    } as ScriptStoryboardVersion;

    render(
      <QuickScriptVersionColumn
        selectedFile={file}
        version={version2}
        versions={[version, version2]}
        currentVersionId={version2.id}
        isSending={false}
        error={null}
        highlightedItemIds={new Set()}
        onDismissError={vi.fn()}
        onSelectItemIds={vi.fn()}
        onSelectVersion={onSelectVersion}
        onEditVersion={vi.fn()}
        onGenerateDesign={vi.fn()}
        onExportVersion={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择分镜脚本版本'), {
      target: { value: 'version-1' },
    });

    expect(onSelectVersion).toHaveBeenCalledWith('version-1');
  });

  it('shows an active waiting pill while the quick video script is running', () => {
    render(
      <QuickScriptVersionColumn
        selectedFile={{
          ...file,
          generationStages: {
            videoScript: { status: 'running', total: 5, completed: 2 },
          },
        }}
        version={undefined}
        isSending={true}
        error={null}
        highlightedItemIds={new Set()}
        onDismissError={vi.fn()}
        onSelectItemIds={vi.fn()}
        onEditVersion={vi.fn()}
        onGenerateDesign={vi.fn()}
        onExportVersion={vi.fn()}
      />,
    );

    expect(screen.getByText('正在生成分镜脚本 2/5')).toBeInTheDocument();
  });

  it('maps one script storyboard card to multiple generated design shots', () => {
    const onSelectItemIds = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: vi.fn(),
    });
    const designItems = [
      { ...item, id: 'design-1', sourceVideoShotNo: '镜头1-1', shotNumber: '镜头1-1' },
      { ...item, id: 'design-2', sourceVideoShotNo: '镜头1-1', shotNumber: '镜头1-2' },
    ];

    render(
      <QuickScriptVersionColumn
        selectedFile={file}
        version={version}
        designItems={designItems}
        isSending={false}
        error={null}
        highlightedItemIds={new Set(['design-2'])}
        onDismissError={vi.fn()}
        onSelectItemIds={onSelectItemIds}
        onEditVersion={vi.fn()}
        onGenerateDesign={vi.fn()}
        onExportVersion={vi.fn()}
      />,
    );

    const scriptCard = screen.getByRole('button', { name: /分镜1-1/ });
    expect(scriptCard).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(scriptCard);
    expect(Array.from(onSelectItemIds.mock.calls[0][0]).sort()).toEqual(['design-1', 'design-2']);
  });
});
