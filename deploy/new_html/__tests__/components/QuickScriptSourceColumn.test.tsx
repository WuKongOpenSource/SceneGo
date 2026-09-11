// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickScriptSourceColumn } from '../../components/QuickScriptSourceColumn';
import { AiModel, FileStatus, type ProjectFile } from '../../types';
import { DEFAULT_SCRIPT_MODEL_OPTIONS } from '../../services/scriptModelCatalogService';

vi.mock('../../services/creditService', async () => {
  const actual = await vi.importActual<typeof import('../../services/creditService')>('../../services/creditService');
  return {
    ...actual,
    estimateCredits: vi.fn().mockResolvedValue({
      enabled: true,
      estimated_cost: 8,
      enough: true,
      balance: 1000,
    }),
  };
});

afterEach(cleanup);

const file = {
  id: 'script-1',
  name: '分集剧本',
  originalContent: '第一集文字剧本',
  scriptContent: null,
  storyboard: null,
  extractedCharacters: [],
  extractedScenes: [],
  extractedProps: [],
  status: FileStatus.Idle,
  lastUpdated: Date.now(),
  versions: [],
} as ProjectFile;

const baseProps = {
  selectedFile: file,
  aiModel: AiModel.DeepseekChat,
  modelOptions: DEFAULT_SCRIPT_MODEL_OPTIONS,
  isLoading: false,
  isSending: false,
  error: null,
  onDismissError: vi.fn(),
  onChangeModel: vi.fn(),
  onUpdateSource: vi.fn(),
  onSplitScript: vi.fn().mockResolvedValue(undefined),
  onGenerateVideoScript: vi.fn().mockResolvedValue(true),
  onExtractStoryboardPrompts: vi.fn().mockResolvedValue(true),
  onRunThreeStage: vi.fn().mockResolvedValue(undefined),
};

describe('QuickScriptSourceColumn', () => {
  it('restores the master three-stage controls without a revision composer', () => {
    render(<QuickScriptSourceColumn {...baseProps} />);

    expect(screen.getByTestId('quick-three-stage-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '按三步生成' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '视频反推' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拆分剧本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成视频脚本' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成镜头设计' })).toBeInTheDocument();
    expect(screen.queryByLabelText('分镜脚本修改要求')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成新版' })).not.toBeInTheDocument();
  });

  it('shows model versions in the dropdown and capability hints outside it', () => {
    render(<QuickScriptSourceColumn {...baseProps} />);

    expect(screen.getByTestId('quick-script-model-hint')).toHaveTextContent('速度优先');
    const modelSelect = screen.getByLabelText('选择剧本模型');
    fireEvent.click(modelSelect);
    expect(screen.getByRole('option', { name: /deepseek-v4-flash/ })).toBeInTheDocument();
    expect(modelSelect).not.toHaveTextContent('速度优先');
  });

  it('runs the complete pipeline against the selected script id', async () => {
    const onRunThreeStage = vi.fn().mockResolvedValue(undefined);
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        onRunThreeStage={onRunThreeStage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '按三步生成' }));

    await waitFor(() => expect(onRunThreeStage).toHaveBeenCalledWith('script-1'));
  });

  it('shows quick pipeline failures inline instead of requiring a browser alert', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const onRunThreeStage = vi.fn().mockRejectedValue(new Error('视频脚本生成未返回可解析的分段/分镜，请手动调整后重试'));
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        onRunThreeStage={onRunThreeStage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '按三步生成' }));

    expect(await screen.findByText('视频脚本生成未返回可解析的分段/分镜，请手动调整后重试')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('shows the estimated credit cost in the quick three-stage panel', () => {
    render(<QuickScriptSourceColumn {...baseProps} />);

    expect(screen.getByText(/预计消耗创作点数：/)).toBeInTheDocument();
    expect(screen.getByText('· 成功后扣除')).toBeInTheDocument();
  });

  it('keeps the next-run estimate visible after generation has completed', async () => {
    render(<QuickScriptSourceColumn {...baseProps} actualCreditCost={5} />);

    expect(screen.getByText('本次合计消耗：5')).toBeInTheDocument();
    expect(screen.getByText('创作点数')).toBeInTheDocument();
    expect(screen.getByText(/再次生成预计消耗创作点数：/)).toBeInTheDocument();
    expect(screen.getByText('· 成功后扣除')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('再次生成预计消耗创作点数：16')).toBeInTheDocument());
  });

  it('marks quick stages complete from persisted outputs when stage metadata is stale', () => {
    const completedFile = {
      ...file,
      scriptSegments: [
        {
          id: 'segment-1',
          order: 0,
          sourceText: '第一段',
          estimatedDurationSec: 12,
          videoScript: '分镜1-1',
          status: 'done',
        },
        {
          id: 'segment-2',
          order: 1,
          sourceText: '第二段',
          estimatedDurationSec: 10,
          videoScript: '分镜2-1',
          status: 'done',
        },
      ],
      storyboard: {
        items: [
          {
            id: 'shot-1',
            shotNumber: '1-1',
            originalText: '第一段',
            scriptSegment: '第一段',
            imagePrompt: '画面一',
            videoPrompt: '镜头一',
            dialogue: '',
            characters: [],
            scene: '',
            timestamp: Date.now(),
          },
          {
            id: 'shot-2',
            shotNumber: '1-2',
            originalText: '第二段',
            scriptSegment: '第二段',
            imagePrompt: '画面二',
            videoPrompt: '镜头二',
            dialogue: '',
            characters: [],
            scene: '',
            timestamp: Date.now(),
          },
        ],
      },
      generationStages: {
        split: { status: 'idle', total: 0, completed: 0 },
        videoScript: { status: 'idle', total: 0, completed: 0 },
        storyboardPrompt: { status: 'idle', total: 0, completed: 0 },
      },
    } as ProjectFile;

    render(<QuickScriptSourceColumn {...baseProps} selectedFile={completedFile} />);

    expect(screen.getAllByText('完成')).toHaveLength(3);
    expect(screen.queryByText('未开始')).not.toBeInTheDocument();
    expect(screen.getByText('镜头设计：2')).toBeInTheDocument();
  });

  it('keeps quick generation disabled before source text exists', () => {
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        selectedFile={{ ...file, originalContent: '' } as ProjectFile}
      />,
    );

    expect(screen.getByRole('button', { name: '按三步生成' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '视频反推' })).not.toBeInTheDocument();
  });

  it('runs each available master stage independently and shows its progress', async () => {
    const stagedFile = {
      ...file,
      scriptSegments: [{
        id: 'segment-1',
        order: 0,
        sourceText: '第一段',
        estimatedDurationSec: 12,
        videoScript: '镜头1-1',
        status: 'done',
      }],
      storyboard: {
        items: [{
          id: 'shot-1',
          shotNumber: '1-1',
          originalText: '第一段',
          scriptSegment: '第一段',
          imagePrompt: '画面',
          videoPrompt: '镜头',
          dialogue: '',
          characters: [],
          scene: '',
          timestamp: Date.now(),
        }],
      },
      generationStages: {
        split: { status: 'done', total: 1, completed: 1 },
        videoScript: { status: 'done', total: 1, completed: 1 },
        storyboardPrompt: { status: 'done', total: 1, completed: 1 },
      },
    } as ProjectFile;
    const onSplitScript = vi.fn().mockResolvedValue(undefined);
    const onGenerateVideoScript = vi.fn().mockResolvedValue(true);
    const onExtractStoryboardPrompts = vi.fn().mockResolvedValue(true);
    render(
      <QuickScriptSourceColumn
        {...baseProps}
        selectedFile={stagedFile}
        onSplitScript={onSplitScript}
        onGenerateVideoScript={onGenerateVideoScript}
        onExtractStoryboardPrompts={onExtractStoryboardPrompts}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '拆分剧本' }));
    fireEvent.click(screen.getByRole('button', { name: '生成视频脚本' }));
    fireEvent.click(screen.getByRole('button', { name: '生成镜头设计' }));

    await waitFor(() => {
      expect(onSplitScript).toHaveBeenCalledWith('script-1');
      expect(onGenerateVideoScript).toHaveBeenCalledWith('script-1');
      expect(onExtractStoryboardPrompts).toHaveBeenCalledWith('script-1');
    });
    expect(screen.getAllByText('完成')).toHaveLength(3);
    expect(screen.getByText('分段数：1')).toBeInTheDocument();
    expect(screen.getByText('已生成：1/1')).toBeInTheDocument();
    expect(screen.getByText('镜头设计：1')).toBeInTheDocument();
  });
});
