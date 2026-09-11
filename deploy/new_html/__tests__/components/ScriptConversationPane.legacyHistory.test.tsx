// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildConversationTurns,
  orderConversationMessages,
  ScriptConversationPane,
  StoryboardVersionBody,
} from '../../components/ScriptConversationPane';
import { AiModel, FileStatus, type ProjectFile, type ScriptConversation, type ScriptStoryboardVersion } from '../../types';
import {
  STABILITY_CONSTRAINT_REFERENCE,
  VISUAL_STYLE_REFERENCE,
} from '../../utils/scriptPromptStandards';

afterEach(cleanup);

describe('ScriptConversationPane legacy history', () => {
  it('renders the initial script before V1 even when migrated timestamps are reversed', () => {
    const messages: ScriptConversation['messages'] = [
      { id: 'msg-v1', role: 'assistant', content: 'V1 分镜脚本', status: 'completed', replyToMessageId: 'msg-initial', createdAt: 1, updatedAt: 1 },
      { id: 'msg-initial', role: 'user', content: '初始剧本', status: 'completed', createdAt: 10, updatedAt: 10 },
      { id: 'msg-v2', role: 'assistant', content: 'V2 分镜脚本', status: 'completed', replyToMessageId: 'msg-revision', createdAt: 12, updatedAt: 12 },
      { id: 'msg-revision', role: 'user', content: '第二轮修改要求', status: 'completed', createdAt: 11, updatedAt: 11 },
    ];
    const versions: ScriptStoryboardVersion[] = [
      {
        id: 'ver-2', scriptId: 'script-1', messageId: 'msg-v2', versionNo: 2,
        content: 'V2 分镜脚本', storyboardItems: [], source: 'ai', status: 'ready', createdAt: 12, updatedAt: 12,
      },
      {
        id: 'ver-1', scriptId: 'script-1', messageId: 'msg-v1', versionNo: 1,
        content: 'V1 分镜脚本', storyboardItems: [], source: 'ai', status: 'ready', createdAt: 1, updatedAt: 1,
      },
    ];

    expect(orderConversationMessages(messages, versions).map(message => message.id)).toEqual([
      'msg-initial',
      'msg-v1',
      'msg-revision',
      'msg-v2',
    ]);

    const conversation: ScriptConversation = {
      scriptId: 'script-1',
      currentVersionId: 'ver-2',
      messages,
      versions,
    };
    const selectedFile: ProjectFile = {
      id: 'script-1',
      name: '分集剧本',
      originalContent: '初始剧本',
      scriptContent: 'V2 分镜脚本',
      storyboard: null,
      extractedCharacters: [],
      extractedScenes: [],
      status: FileStatus.Completed,
      lastUpdated: 12,
      versions: [],
    };
    render(
      <ScriptConversationPane
        selectedFile={selectedFile}
        conversation={conversation}
        aiModel={AiModel.DeepseekChat}
        isWorkflowScript
        isLoading={false}
        isSending={false}
        onChangeModel={() => undefined}
        onSend={async () => undefined}
        onGenerateDesign={() => undefined}
        onEditVersion={async () => undefined}
        onExportVersion={() => undefined}
        onOpenStoryboard={() => undefined}
        storyboardItemCount={0}
      />,
    );

    const initialCard = screen.getByText('输入文字剧本').closest('article')!;
    const v1Card = screen.getByText(/^V1 ·/).closest('article')!;
    expect(initialCard.compareDocumentPosition(v1Card) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('keeps the initial input unversioned and orders real generated versions after it', () => {
    const messages: ScriptConversation['messages'] = [
      { id: 'msg-user-1', role: 'user', content: '初始文字剧本', status: 'completed', createdAt: 1, updatedAt: 1 },
      { id: 'msg-v3', role: 'assistant', content: '第三版', status: 'completed', createdAt: 2, updatedAt: 2 },
      { id: 'msg-v1', role: 'assistant', content: '第一版', status: 'completed', createdAt: 4, updatedAt: 4 },
      { id: 'msg-v2', role: 'assistant', content: '第二版', status: 'completed', createdAt: 6, updatedAt: 6 },
    ];
    const versions = [3, 1, 2].map((versionNo, index): ScriptStoryboardVersion => ({
      id: `ver-${versionNo}`,
      scriptId: 'script-version-order',
      messageId: `msg-v${versionNo}`,
      versionNo,
      content: `第${versionNo}版`,
      storyboardItems: [],
      source: 'ai',
      status: 'ready',
      createdAt: index + 1,
      updatedAt: index + 1,
    }));
    versions.unshift({
      ...versions[1],
      id: 'legacy_script-version-order',
      messageId: 'legacy_assistant_script-version-order',
      source: 'legacy',
    });

    const turns = buildConversationTurns(messages, versions);

    expect(turns).toHaveLength(4);
    expect(turns.map(turn => turn.versionNo)).toEqual([undefined, 1, 2, 3]);
    expect(turns.map(turn => turn.number)).toEqual([0, 1, 2, 3]);
    expect(turns.map(turn => turn.isInitial)).toEqual([true, undefined, undefined, undefined]);
    expect(turns.map(turn => turn.anchorMessageId)).toEqual(['msg-user-1', 'msg-v1', 'msg-v2', 'msg-v3']);
  });

  it('renders the complete immutable legacy reply as formatted segment cards', () => {
    const content = [
      '### **镜头1**',
      '- **时长（秒）**：4',
      '- **画面描述**：小悟站在办公室中央，右手紧握智能跳绳。',
      '- **光影色调**：明亮自然光。',
      '',
      '### **镜头2**',
      '- **时长（秒）**：3',
      '- **画面描述**：小悟转身看向同事。',
      '- **镜头运动**：缓慢推进。',
      `【视觉风格】${VISUAL_STYLE_REFERENCE}`,
      `【正向稳定约束】${STABILITY_CONSTRAINT_REFERENCE}`,
    ].join('\n');
    const version: ScriptStoryboardVersion = {
      id: 'ver_legacy_script_yuan',
      scriptId: 'script_yuan',
      messageId: 'msg_legacy_assistant_script_yuan',
      versionNo: 1,
      content,
      storyboardItems: [
        {
          id: 'shot-1',
          shotNumber: '镜头01',
          originalText: '镜头01',
          scriptSegment: '旧版摘要一',
          imagePrompt: '',
          videoPrompt: '',
          dialogue: '',
          characters: [],
        },
        {
          id: 'shot-2',
          shotNumber: '镜头02',
          originalText: '镜头02',
          scriptSegment: '旧版摘要二',
          imagePrompt: '',
          videoPrompt: '',
          dialogue: '',
          characters: [],
        },
      ],
      source: 'legacy',
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    render(<StoryboardVersionBody version={version} />);

    const body = screen.getByTestId('legacy-storyboard-version-body-ver_legacy_script_yuan');
    expect(body).toHaveTextContent('画面描述：小悟站在办公室中央，右手紧握智能跳绳。');
    expect(body).toHaveTextContent('镜头运动：缓慢推进。');
    expect(body).toHaveTextContent('分段');
    expect(body).toHaveTextContent('分镜1-1');
    expect(body).toHaveTextContent('分镜1-2');
    expect(body.textContent).not.toMatch(/###|\*\*/);
    expect(screen.getByTestId('segment-1-visual-style-card')).toHaveTextContent(VISUAL_STYLE_REFERENCE);
    expect(screen.getByTestId('segment-1-stability-constraint-card')).toHaveTextContent(STABILITY_CONSTRAINT_REFERENCE);
    expect(screen.getByTestId('segment-1-shot-2-card')).not.toHaveTextContent('【视觉风格】');
    expect(screen.getByTestId('segment-1-shot-2-card')).not.toHaveTextContent('【正向稳定约束】');
    const segment = screen.getByTestId('segment-1-shot-1-card').parentElement!;
    expect(
      Array.from(segment.children).indexOf(screen.getByTestId('segment-1-prompt-cards')),
    ).toBeGreaterThan(
      Array.from(segment.children).indexOf(screen.getByTestId('segment-1-shot-2-card')),
    );
    expect(screen.getByTestId('segment-1-shot-1-card').textContent?.match(/分镜1-1/g)).toHaveLength(1);
    expect(screen.getByTestId('segment-1-shot-2-card').textContent?.match(/分镜1-2/g)).toHaveLength(1);
  });

  it('keeps Yuan-style legacy history visible after collapsing and expanding the reply', () => {
    const content = Array.from({ length: 8 }, (_, index) => [
      `镜头${index + 1}`,
      '时长（秒）：4',
      `画面描述：第${index + 1}个历史镜头的完整内容。`,
      '光影色调：明亮自然光。',
    ].join('\n')).join('\n');
    const version: ScriptStoryboardVersion = {
      id: 'ver_legacy_script_yuan',
      scriptId: 'script_yuan',
      messageId: 'msg_legacy_assistant_script_yuan',
      versionNo: 1,
      content,
      storyboardItems: [],
      source: 'legacy',
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const conversation: ScriptConversation = {
      scriptId: 'script_yuan',
      currentVersionId: version.id,
      messages: [
        {
          id: 'msg_legacy_user_script_yuan',
          role: 'user',
          content: '最初输入的文字剧本',
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          id: version.messageId!,
          role: 'assistant',
          content,
          status: 'completed',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      versions: [version],
    };
    const selectedFile: ProjectFile = {
      id: 'script_yuan',
      name: '分集剧本',
      originalContent: '最初输入的文字剧本',
      scriptContent: content,
      storyboard: null,
      extractedCharacters: [],
      extractedScenes: [],
      status: FileStatus.Completed,
      lastUpdated: Date.now(),
      versions: [],
    };

    render(
      <ScriptConversationPane
        selectedFile={selectedFile}
        conversation={conversation}
        aiModel={AiModel.DeepseekChat}
        isWorkflowScript
        isLoading={false}
        isSending={false}
        onChangeModel={() => undefined}
        onSend={async () => undefined}
        onGenerateDesign={() => undefined}
        onEditVersion={async () => undefined}
        onExportVersion={() => undefined}
        onOpenStoryboard={() => undefined}
        storyboardItemCount={0}
      />,
    );

    const body = screen.getByTestId('legacy-storyboard-version-body-ver_legacy_script_yuan');
    const collapseButton = screen.getByTestId('script-message-collapse-top-msg_legacy_assistant_script_yuan');
    expect(body).toHaveTextContent('画面描述：第8个历史镜头的完整内容。');

    fireEvent.click(collapseButton);
    expect(collapseButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(collapseButton);
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    expect(body).toHaveTextContent('画面描述：第8个历史镜头的完整内容。');
  });
});
