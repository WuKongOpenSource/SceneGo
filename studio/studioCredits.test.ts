import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');
const nodeSource = readFileSync(resolve(__dirname, 'components/Node.tsx'), 'utf-8');
const assistantSource = readFileSync(resolve(__dirname, 'components/AssistantPanel.tsx'), 'utf-8');
const sonicSource = readFileSync(resolve(__dirname, 'components/SonicStudio.tsx'), 'utf-8');
const runtimeSource = readFileSync(resolve(__dirname, 'platform/ostoryRuntime.ts'), 'utf-8');

describe('Studio credit integration', () => {
  it('shows and refreshes the available balance from the shared credit account', () => {
    expect(appSource).toContain('await runtime.getCreditBalance()');
    expect(appSource).toContain("window.addEventListener('credits:updated', handleCreditsUpdated)");
    expect(appSource).toContain('查看创作点数明细');
    expect(appSource).toContain('<span>可用创作点数</span>');
  });

  it('shows estimates and blocks insufficient node and assistant actions', () => {
    expect(nodeSource).toContain('预计 ${creditSummary.totalCost} 创作点数 · 成功后扣除');
    expect(nodeSource).toContain('disabled={isWorking || creditInsufficient}');
    expect(assistantSource).toContain('预计 ${creditSummary.totalCost} 创作点数 · 成功后扣除');
    expect(assistantSource).toContain('isLoading || creditInsufficient');
  });

  it('keeps assistant and sound-factory surfaces above canvas controls', () => {
    expect(assistantSource).toContain('z-[180]');
    expect(assistantSource).toContain('aria-label="AI 创意助手"');
    expect(sonicSource).toContain('z-[180]');
    expect(sonicSource).toContain('aria-label="创剧声音工厂"');
  });

  it('keeps success-only direct billing and validates total queued-video balance', () => {
    expect(runtimeSource).toContain('chargeSuccessfulResult');
    expect(runtimeSource).toContain('assertStudioBatchCredits(videoQuote, count)');
    expect(runtimeSource).toContain('getVideoCreditEstimateParams(normalizedModel');
    expect(runtimeSource).toContain('duration_seconds: duration');
    expect(runtimeSource).toContain('submitDashScopeVideoTask');
    expect(runtimeSource).toContain('submitTask(');
  });
});
