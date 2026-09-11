import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../admin/AdminSettingsPage.tsx'), 'utf-8');

describe('AdminSettingsPage category-specific model checks', () => {
  it('uses the visible category binding instead of the provider card primary model', () => {
    expect(source).toContain('const categoryModelName = modelBindings[0]?.model_name');
    expect(source).toContain('onCheck(provider, categoryModelName)');
    expect(source).toContain('const modelNameHint = categoryBinding?.model_name || config.model_name || null');
    expect(source).toContain('const categoryRuntime = runtimeForProviderModel(provider, modelNameHint) || runtime');
  });

  it('keeps API config cards compact with a details modal and adaptive actions', () => {
    expect(source).toContain('setDetailsOpen(true)');
    expect(source).toContain('aria-label={`${cardTitle} 详情`}');
    expect(source).toContain("const effectiveActionLabel = config.enabled === false ? '启用' : !isRuntimeActive ? '设为生效' : '禁用'");
    expect(source).toContain('onClick={handleEffectiveAction}');
    expect(source.indexOf('onClick={handleEffectiveAction}')).toBeLessThan(source.indexOf('onClick={() => setDetailsOpen(true)}'));
    expect(source).toContain("min-w-[4.5rem]");
    expect(source).not.toContain('w-36 shrink-0');
  });

  it('shows the complete details for inactive API cards without collapsed modal sections', () => {
    const cardSource = source.slice(
      source.indexOf('const ApiConfigCard: React.FC'),
      source.indexOf('const ProviderQuickCard: React.FC'),
    );

    expect(cardSource).not.toContain('compactInactive');
    expect(cardSource).not.toContain('当前只展开生效 Key');
    expect(cardSource).not.toContain('<summary');
    expect(cardSource).toContain('<div className="font-semibold text-n700">高级测试</div>');
    expect(cardSource).toContain('<ProviderOperationPaths meta={meta} runtime={runtime} />');
  });

  it('supports backend-owned publish state and editable public wording with visible defaults', () => {
    expect(source).toContain('label: String(option?.label || item.label || operation)');
    expect(source).toContain('front_model_key: String(option?.front_model_key || item.front_model_key');
    expect(source).toContain('aria-label="前台上架"');
    expect(source).toContain('前台展示名称');
    expect(source).toContain('模型说明');
    expect(source).toContain('默认：{binding.default_display_name');
    expect(source).toContain('恢复默认');
    expect(source).toContain('uniqueModelBindingsForDisplay');
  });
});
