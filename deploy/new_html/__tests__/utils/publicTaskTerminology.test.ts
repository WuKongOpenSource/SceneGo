import { describe, expect, it } from 'vitest';
import { formatPublicTaskText } from '../../utils/publicTaskTerminology';
import { DEFAULT_SCRIPT_MODEL_OPTIONS } from '../../services/scriptModelCatalogService';
import { DESIGN_IMAGE_MODEL_OPTIONS } from '../../utils/designImageModels';
import { getModelDisplayName } from '../../services/videoModelService';

describe('publicTaskTerminology', () => {
  it.each(['Seedance15', 'Seedance 1.5 Pro', 'doubao-seedance-1-5-pro'])('does not relabel %s as Seedance 2.0', name => {
    expect(formatPublicTaskText(`视频 · ${name} · 推门`, 'seedance-1.5')).toBe(`视频 · ${getModelDisplayName('Seedance15')} · 推门`);
    const formatted = formatPublicTaskText(`视频 · ${name} · 推门`, 'seedance-1.5');
    expect(formatPublicTaskText(formatted, 'seedance-1.5')).toBe(formatted);
  });
  it('uses the public script model labels shown by the selector', () => {
    expect(formatPublicTaskText('DeepSeek 文本生成', 'script-segment'))
      .toBe(DEFAULT_SCRIPT_MODEL_OPTIONS[1].label);
    expect(formatPublicTaskText('DeepSeek Reasoner 剧本生成', 'script-segment'))
      .toBe(`${DEFAULT_SCRIPT_MODEL_OPTIONS[2].label} 剧本生成`);
    expect(formatPublicTaskText('MiniMax M3 文本生成', 'script-segment'))
      .toBe(DEFAULT_SCRIPT_MODEL_OPTIONS[0].label);
  });

  it('uses the public image model labels shown by the selector', () => {
    expect(formatPublicTaskText('豆包图像生成', 'doubao-image'))
      .toBe(DESIGN_IMAGE_MODEL_OPTIONS[0].label);
    expect(formatPublicTaskText('Doubao SeedDream 5.0 Lite image failed', 'doubao-image'))
      .toContain('Doubao-Seedream-5.0-lite');
  });

  it('uses the public video aliases shown by the selector', () => {
    expect(formatPublicTaskText('Seedance 2 Fast 视频生成', 'seedance-fast'))
      .toBe(`${getModelDisplayName('Seedance2Fast')} 视频生成`);
    expect(formatPublicTaskText('HappyHorse 视频生成', 'happyhorse'))
      .toBe(`${getModelDisplayName('HappyHorse')} 视频生成`);
  });
});
