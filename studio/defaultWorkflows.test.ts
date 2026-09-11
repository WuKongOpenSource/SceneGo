import { describe, expect, it } from 'vitest';
import { NodeType, type Workflow } from './types';
import {
  createDefaultStudioWorkspace,
  createBasicScriptToVideoWorkflow,
  createStandardTextImageVideoWorkflow,
  mergeBuiltinStudioWorkflows,
  resolveStudioWorkspace,
  STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID,
} from './defaultWorkflows';

describe('Studio built-in workflows', () => {
  it('defines the minimum script-to-image-to-video graph with script context at both generators', () => {
    const workflow = createBasicScriptToVideoWorkflow();

    expect(workflow.id).toBe(STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID);
    expect(workflow.isBuiltin).toBe(true);
    expect(workflow.nodes.map(node => node.type)).toEqual([
      NodeType.PROMPT_INPUT,
      NodeType.IMAGE_GENERATOR,
      NodeType.VIDEO_GENERATOR,
    ]);
    expect(workflow.connections).toEqual([
      { from: workflow.nodes[0].id, to: workflow.nodes[1].id },
      { from: workflow.nodes[1].id, to: workflow.nodes[2].id },
      { from: workflow.nodes[0].id, to: workflow.nodes[2].id },
    ]);
    expect(workflow.nodes[1].inputs).toEqual([workflow.nodes[0].id]);
    expect(workflow.nodes[2].inputs).toEqual([workflow.nodes[1].id, workflow.nodes[0].id]);
    expect(workflow.title).toBe('基础漫剧 · 剧本到视频');
    expect(workflow.nodes.map(node => node.title)).toEqual([
      '01 · 输入剧本',
      '02 · 生成首帧',
      '03 · 生成视频',
    ]);
    expect(workflow.nodes[1].data.aspectRatio).toBe('16:9');
    expect(workflow.nodes[2].data.duration).toBe(5);
  });

  it('creates independent graph copies for a new empty canvas', () => {
    const workspace = createDefaultStudioWorkspace();

    expect(workspace.workflows).toHaveLength(1);
    expect(workspace.nodes).not.toBe(workspace.workflows[0].nodes);
    workspace.nodes[0].data.prompt = 'changed on canvas';
    expect(workspace.workflows[0].nodes[0].data.prompt).not.toBe('changed on canvas');
  });

  it('refreshes the built-in definition without changing user templates', () => {
    const userWorkflow: Workflow = {
      id: 'user-workflow',
      title: '我的工作流',
      thumbnail: '',
      nodes: [],
      connections: [],
      groups: [],
    };
    const staleBuiltin = {
      ...createStandardTextImageVideoWorkflow(),
      title: 'stale',
      nodes: [],
    };

    const merged = mergeBuiltinStudioWorkflows([userWorkflow, staleBuiltin]);

    expect(merged.map(workflow => workflow.id)).toEqual([
      STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID,
      'user-workflow',
    ]);
    expect(merged[0].nodes).toHaveLength(3);
    expect(merged[1]).toBe(userWorkflow);
  });

  it('keeps an existing canvas graph unchanged while adding the built-in template', () => {
    const existingNode = createStandardTextImageVideoWorkflow().nodes[0];
    existingNode.id = 'existing-node';
    const resolved = resolveStudioWorkspace({
      schemaVersion: 1,
      assets: [{ id: 'asset-1' }],
      workflows: [],
      nodes: [existingNode],
      connections: [],
      groups: [],
    });

    expect(resolved.nodes).toEqual([existingNode]);
    expect(resolved.assets).toEqual([{ id: 'asset-1' }]);
    expect(resolved.workflows[0].id).toBe(STANDARD_TEXT_IMAGE_VIDEO_WORKFLOW_ID);
  });
});
