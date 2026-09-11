


















export type GptImageRatio =
  | '1:1'
  | '4:3'
  | '3:4'
  | '16:9'
  | '9:16'
  | '3:2'
  | '2:3'
  | '21:9'
  | '5:4'
  | '4:5'
  | 'auto';

export type GptImageK = '1K' | '2K' | '4K' | 'auto';

export interface SourceImageDimensions {
  width: number;
  height: number;
}

export interface ResolvedGptImageSettings {
  ratio: Exclude<GptImageRatio, 'auto'>;
  k: Exclude<GptImageK, 'auto'>;
  sourceDimensions: SourceImageDimensions | null;
}

const RATIO_VALUES: Record<Exclude<GptImageRatio, 'auto'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '3:2': 3 / 2,
  '2:3': 2 / 3,
  '21:9': 21 / 9,
  '5:4': 5 / 4,
  '4:5': 4 / 5,
};





const SIZE_TABLE: Record<Exclude<GptImageRatio, 'auto'>, Record<Exclude<GptImageK, 'auto'>, string>> = {
  '1:1':  { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
  '4:3':  { '1K': '1152x896',  '2K': '2304x1792', '4K': '4608x3584' },
  '3:4':  { '1K': '896x1152',  '2K': '1792x2304', '4K': '3584x4608' },
  '16:9': { '1K': '1344x768',  '2K': '2688x1536', '4K': '5376x3072' },
  '9:16': { '1K': '768x1344',  '2K': '1536x2688', '4K': '3072x5376' },
  '3:2':  { '1K': '1216x832',  '2K': '2432x1664', '4K': '4864x3328' },
  '2:3':  { '1K': '832x1216',  '2K': '1664x2432', '4K': '3328x4864' },
  '21:9': { '1K': '1536x640',  '2K': '3072x1280', '4K': '6144x2560' },
  '5:4':  { '1K': '1152x896',  '2K': '2304x1792', '4K': '4608x3584' },
  '4:5':  { '1K': '896x1152',  '2K': '1792x2304', '4K': '3584x4608' },
};





export function recommendGptImageSize(ratio: GptImageRatio, k: GptImageK): string {
  if (ratio === 'auto' || k === 'auto') return 'auto';
  const row = SIZE_TABLE[ratio];
  if (!row) return 'auto';
  return row[k] ?? 'auto';
}





export function resolveGptImageSettings(
  ratio: GptImageRatio,
  k: GptImageK,
  sourceDimensions: SourceImageDimensions[] = [],
): ResolvedGptImageSettings {
  const largestSource = sourceDimensions
    .filter(item => (
      Number.isFinite(item.width)
      && Number.isFinite(item.height)
      && item.width > 0
      && item.height > 0
    ))
    .sort((left, right) => (
      (right.width * right.height) - (left.width * left.height)
    ))[0] ?? null;

  const resolvedRatio: Exclude<GptImageRatio, 'auto'> = ratio === 'auto' && largestSource
    ? (Object.entries(RATIO_VALUES) as [Exclude<GptImageRatio, 'auto'>, number][])
      .reduce((closest, candidate) => (
        Math.abs(Math.log((largestSource.width / largestSource.height) / candidate[1]))
          < Math.abs(Math.log((largestSource.width / largestSource.height) / closest[1]))
          ? candidate
          : closest
      ))[0]
    : ratio === 'auto' ? '16:9' : ratio;
  if (k !== 'auto') {
    return { ratio: resolvedRatio, k, sourceDimensions: largestSource };
  }

  if (!largestSource) {
    return { ratio: resolvedRatio, k: '1K', sourceDimensions: null };
  }

  const sourceMaxEdge = Math.max(largestSource.width, largestSource.height);
  const inferredK: Exclude<GptImageK, 'auto'> = sourceMaxEdge <= 1920
    ? '1K'
    : sourceMaxEdge <= 3072
      ? '2K'
      : '4K';

  return { ratio: resolvedRatio, k: inferredK, sourceDimensions: largestSource };
}

export const GPT_IMAGE_RATIO_OPTIONS: { value: GptImageRatio; label: string }[] = [
  { value: 'auto',  label: '自动（按最大参考图和尺寸决定档位）' },
  { value: '1:1',   label: '1:1 方形' },
  { value: '16:9',  label: '16:9 横屏' },
  { value: '9:16',  label: '9:16 竖屏' },
  { value: '4:3',   label: '4:3 横屏' },
  { value: '3:4',   label: '3:4 竖屏' },
  { value: '3:2',   label: '3:2 横屏' },
  { value: '2:3',   label: '2:3 竖屏' },
  { value: '21:9',  label: '21:9 超宽' },
  { value: '5:4',   label: '5:4' },
  { value: '4:5',   label: '4:5' },
];

export const GPT_IMAGE_K_OPTIONS: { value: GptImageK; label: string }[] = [
  { value: 'auto', label: '自动（按最大参考图和尺寸决定档位）' },
  { value: '1K',   label: '1K（标准，约 1080p）' },
  { value: '2K',   label: '2K (高清)' },
  { value: '4K',   label: '4K (超清)' },
];

export const GPT_IMAGE_QUALITY_OPTIONS: { value: 'auto' | 'low' | 'medium' | 'high'; label: string }[] = [
  { value: 'auto',   label: '自动' },
  { value: 'high',   label: '高质量 (慢)' },
  { value: 'medium', label: '中质量' },
  { value: 'low',    label: '低质量 (快)' },
];





export const GEMINI_NANO2_RATIO_OPTIONS = GPT_IMAGE_RATIO_OPTIONS;
export const GEMINI_NANO2_SIZE_OPTIONS = GPT_IMAGE_K_OPTIONS;
