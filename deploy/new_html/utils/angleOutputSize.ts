export interface AngleOutputDimensions {
  width: number;
  height: number;
}

function alignDimension(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

export function fitAngleOutputDimensions(
  source: { width: number; height: number } | null,
  maxEdge = 1024,
): AngleOutputDimensions {
  const width = source?.width && source.width > 0 ? source.width : 1024;
  const height = source?.height && source.height > 0 ? source.height : 576;
  const scale = Math.min(1, maxEdge / Math.max(width, height));

  return {
    width: alignDimension(width * scale, 8),
    height: alignDimension(height * scale, 8),
  };
}
