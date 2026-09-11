import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../components/VideoPage.tsx'), 'utf-8');

describe('VideoPage queued task state', () => {
  it('keeps queued backend tasks visibly separate from GPU processing', () => {
    expect(source).toContain("state: status === 'queued' ? 'pending' : 'processing'");
    expect(source).toContain("if (status.state === 'pending')");
    expect(source).toContain('排队中...');
  });

  it('shows the cancellation window from the create response before the first poll', () => {
    expect(source).toContain('cancelDeadline: result.cancel_deadline');
    expect(source).toContain('canCancel: result.can_cancel');
    expect(source).toContain("state: undo?.cancelDeadline ? 'pending' : 'running'");
  });
});

describe('VideoPage result header layout', () => {
  it('keeps long failed-state copy from squeezing the action buttons', () => {
    expect(source).toContain("<span className=\"truncate\">{keptHistory ? '失败·结果保留' : '失败'}</span>");
    expect(source).toContain('max-w-[96px]');
    expect(source).toContain('flex min-w-0 flex-1 items-center gap-2 overflow-hidden');
    expect(source).toContain('flex shrink-0 items-center gap-1.5');
  });
});

describe('VideoPage source media layout', () => {
  it('uses the same stable four-column media row as generated video results', () => {
    expect(source).toContain('data-testid="video-source-grid"');
    expect(source).toContain('grid w-full grid-cols-4 gap-2 overflow-y-auto');
    expect(source).toContain('data-testid="video-source-placeholder"');
    expect(source).toContain('const sourcePlaceholderCount = getVideoResultPlaceholderCount(sourceImages.length);');
    expect(source).toContain('Array.from({ length: sourcePlaceholderCount }');
  });
});

describe('VideoPage upscale processing node routing', () => {
  it('shows the shared processing-node selector and forwards the selected route', () => {
    expect(source).toContain("import { GpuNodeSelector, type GpuNodeSelection } from '@runtime/GpuNodeSelector';");
    expect(source).toContain('setUpscaleNodeSelection(null);');
    expect(source).toContain('onSelectionChange={setUpscaleNodeSelection}');
    expect(source).toContain('preferred_agent_id: upscaleNodeSelection?.preferredAgentId');
    expect(source).toContain('preferred_node_id: upscaleNodeSelection?.preferredNodeId');
    expect(source).toContain('disabled={isSubmitting || !upscaleNodeSelection?.usable}');
  });
});

describe('VideoPage generated-video voice extraction', () => {
  it('exposes the existing character-bound audio reference workflow clearly', () => {
    expect(source).toContain('声音抽离');
    expect(source).toContain('人物声音抽离');
    expect(source).toContain('抽离并设为人物参考');
    expect(source).toContain('...taskGroups.map(candidate => getCharacterNameForGroup(candidate))');
    expect(source).toContain('后续同人物分镜会自动优先复用');
    expect(source).toContain('若视频包含多人或重叠对白');
    expect(source).toContain('createVideoVoiceReference({');
    expect(source).toContain("role: 'reference_audio'");
  });
});
