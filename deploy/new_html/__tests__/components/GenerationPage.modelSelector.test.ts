import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(__dirname, '../../components/GenerationPage.tsx'),
  'utf-8',
).replace(/\r\n/g, '\n');

describe('generation page model selectors', () => {
  it('places the shared default selector in the header and the current-shot override in the config card', () => {
    expect(source).toContain('ariaLabel="默认生成模型"');
    expect(source).toContain('ariaLabel="当前镜头生成模型"');
    expect(source).toContain('label: `跟随默认 · ${getStoryboardGenerationModelOption(globalModel).shortLabel}`');
    expect(source).not.toContain('aria-label={`${shotLabel}生成模型`}');
    expect(source).toContain('buildStoryboardModelPickerOptions(');
    expect(source).toContain('options={storyboardModelPickerOptions}');
    expect(source).toContain('options={shotModelPickerOptions}');
    expect(source).not.toContain('const models: GenerationModel[]');
    expect(source).not.toContain('点击切换模型');
  });

  it('derives the processing-cluster set from model capabilities', () => {
    expect(source).toContain('.filter(option => option.requiresCluster)');
    expect(source).toContain('selectedGenerationModelOption.hint');
    expect(source).toContain('COMFYUI_MODELS.has(selectedGenerationModel)');
    expect(source).not.toContain("option.requiresCluster ? '处理集群' : '在线 API'");
    expect(source).not.toContain('【在线 API】');
    expect(source).not.toContain('【处理集群】');
    expect(source).toContain('此选项使用 <b>处理集群</b> 的本地节点模型');
    expect(source).toContain('默认使用处理节点1，可手动切换，节点资源有限可能需要排队。');
    expect(source).toContain('在线 API 模型排在前面，本地节点模型排在后面并依赖处理集群可用节点。');
  });

  it('offers the Doubao API model and routes current-shot generation through the selected override', () => {
    expect(source).toContain('generateImageWithPreferredFallback');
    expect(source).toContain('isSeedreamStoryboardModel(modelToUse)');
    expect(source).toContain("model: modelToUse === 'doubao_pro' ? SEEDREAM_PRO_MODEL : SEEDREAM_LITE_MODEL");
    expect(source).toContain('seedancePortrait: portraitMode');
    expect(source).toContain("engine: 'doubao'");
    expect(source).toContain('recommendDoubaoImageSize(');
    expect(source).toContain('generateForShot(selectedShot, true, selectedGenerationModel, references)');
    expect(source).toContain('params={{ image_count: 1, model: selectedGenerationModel }}');
  });

  it('applies config locking immediately and disables current-shot configuration controls', () => {
    expect(source).toContain('const [configLockDrafts, setConfigLockDrafts]');
    expect(source).toContain('const newState = !isStoryboardConfigLocked(selectedShot);');
    expect(source).toContain('aria-pressed={selectedConfigLocked}');
    expect(source).toContain('disabled={!selectedShot || selectedConfigLocked || isGenerating}');
    expect(source).toContain('disabled={selectedConfigLocked || isGenerating}');
    expect(source).toContain('disabled={selectedConfigLocked}');
  });

  it('explains the realistic portrait use case without promising automatic style conversion or review approval', () => {
    expect(source).toContain('为 Seedance 真人写实视频准备原图');
    expect(source).toContain('适用于真人写实效果的人像视频。只按文字生成分镜，不使用参考图。');
    expect(source).toContain('此选项不会自动切换画风；需要真人写实效果时，请在画面提示词中明确描述。');
    expect(source).toContain('人物可能与参考图不同；仍需平台审核。');
    expect(source).toContain('开启后请重新生成分镜；已有图片和素材绑定不会改变。');
    expect(source).toContain('对本集所有 Seedream 镜头生效（含批量）。关闭后恢复普通生图方式。');
    expect(source).toContain('aria-describedby="seedance-portrait-help"');
    expect(source).not.toContain('Seedance 人像分镜 · 纯文生图原图');
  });

  it('explains why the portrait checkbox cannot currently be changed', () => {
    expect(source).toContain('{(isGenerating || selectedConfigLocked) && (');
    expect(source).toContain('正在生成，结束后可修改此选项。');
    expect(source).toContain('配置已锁定，请先点击上方“解除配置锁定”。');
    expect(source).toContain('disabled={isGenerating || selectedConfigLocked || imageGenerationCapabilities?.seedance_portrait.available === false}');
    expect(source).toContain('fetchImageGenerationCapabilities()');
  });
});
