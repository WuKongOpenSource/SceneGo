import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function componentSlice(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function readSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, relativePath), 'utf-8').replace(/\r\n/g, '\n');
}

describe('angle adjustment modal responsive layout', () => {
  it('keeps the generation-page processing-node selector below the left preview', () => {
    const source = readSource('../../components/GenerationPage.tsx');
    const modal = componentSlice(source, 'const CameraAngleModal', 'const HumanMultiAngleModal');

    expect(modal).toContain('max-h-[calc(100vh-2rem)]');
    expect(modal.indexOf('处理集群节点')).toBeGreaterThan(modal.indexOf('alt="预览"'));
    expect(modal.indexOf('处理集群节点')).toBeLessThan(modal.indexOf('<div className="space-y-5">'));
    expect(modal.indexOf('处理集群节点')).toBeLessThan(modal.lastIndexOf('生成新角度'));
    expect(modal).toContain('单视角精确调整');
    expect(modal).toContain('仅生成 1 张指定镜头角度');
    expect(modal).toContain('formatClusterNodeQueue(node)');
    expect(modal).toContain('水平镜像');
    expect(modal).toContain('onMirror(imageUrl)');
    expect(source).toContain("transform: 'horizontal_mirror'");
    expect(source).toContain("source: 'local_transform'");
  });

  it('allows angle-generation progress dialogs to be dismissed while work continues', () => {
    const source = readSource('../../components/GenerationPage.tsx');
    const cameraModal = componentSlice(source, 'const CameraAngleModal', 'const HumanMultiAngleModal');
    const humanMultiAngleModal = componentSlice(source, 'const HumanMultiAngleModal', 'const AroundAngleModal');
    const aroundAngleModal = componentSlice(source, 'const AroundAngleModal', 'interface ImageEditorModalProps');

    for (const modal of [cameraModal, humanMultiAngleModal, aroundAngleModal]) {
      expect(modal).toContain('onClick={onClose}');
      expect(modal).toContain('任务会在后台继续，完成后自动保存。');
      expect(modal).toContain('收起窗口');
      expect(modal).not.toContain('onClick={isProcessing ? undefined : onClose}');
    }

    expect(source).toContain("crmMessage.info('新角度正在后台生成，完成后会自动保存到当前镜头')");
    expect(source).toContain("crmMessage.info('多角度人物正在后台生成，完成后会自动保存到当前镜头')");
    expect(source).toContain("crmMessage.info('全景角度正在后台生成，完成后会自动保存到当前镜头')");
  });

  it('completes the human multi-angle modal with routing, output details, and billing', () => {
    const source = readSource('../../components/GenerationPage.tsx');
    const modal = componentSlice(source, 'const HumanMultiAngleModal', 'const AroundAngleModal');

    expect(modal).toContain('<GpuNodeSelector');
    expect(modal.indexOf('<GpuNodeSelector')).toBeGreaterThan(modal.indexOf('alt="选中的图片"'));
    expect(modal).toContain('固定 14 个视角');
    expect(modal).toContain('保持人物身份一致');
    expect(modal).toContain('多角度生成 14 张；角度调整仅生成 1 张指定角度');
    expect(modal).toContain('<InlineCreditEstimate');
    expect(modal).toContain('DESIGN_CREDIT_FEATURES.multiAngleGeneration');
    expect(modal).toContain('isProcessing || !gpuSelection?.usable');
  });

  it('uses the online image model in the design-page angle modal', () => {
    const source = readSource('../../pages/DesignPage.tsx');
    const modal = componentSlice(source, 'const CameraModal', 'const ProcessModal');

    expect(modal).toContain('<OperationMaterialPicker materials={materials} selectedId={cur?.id} onSelect={setSelId} />');
    expect(modal).toContain('ONLINE_IMAGE_OPERATION_LABEL');
    expect(modal).toContain('无需选择本地节点');
    expect(modal).not.toContain('<GpuNodeSelector');
    expect(modal).toContain('DESIGN_CREDIT_FEATURES.imageGeneration');
  });

  it('uses the online image model in the material-page angle modal', () => {
    const source = readSource('../../components/MaterialPage.tsx');
    const modal = componentSlice(source, 'const CameraModal', 'const ProcessModal');

    expect(modal).toContain('max-h-[calc(100vh-2rem)]');
    expect(modal).toContain('ONLINE_IMAGE_OPERATION_LABEL');
    expect(modal).toContain('无需选择本地节点');
    expect(modal).not.toContain('<GpuNodeSelector');
    expect(modal).toContain('DESIGN_CREDIT_FEATURES.imageGeneration');
  });
});
