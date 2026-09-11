export const CHINA_TIME_ZONE = 'Asia/Shanghai';

const EXPLICIT_TIME_ZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
const ISO_DATE_TIME_WITHOUT_ZONE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;

/**
 * Backend legacy TIMESTAMP columns contain UTC values without an offset.
 * Treat only that ISO-shaped legacy form as UTC; explicit offsets and epoch
 * values retain their normal JavaScript semantics.
 */
export function parseBackendDateTime(value: string | number | Date): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);

  const normalized = value.trim();
  if (!normalized) return new Date(Number.NaN);
  const withZone = !EXPLICIT_TIME_ZONE_RE.test(normalized) && ISO_DATE_TIME_WITHOUT_ZONE_RE.test(normalized)
    ? `${normalized.replace(' ', 'T')}Z`
    : normalized;
  return new Date(withZone);
}

export function formatChinaDateTime(
  value: string | number | Date | null | undefined,
  emptyValue = '-',
): string {
  if (value === null || value === undefined || value === '') return emptyValue;
  const date = parseBackendDateTime(value);
  if (!Number.isFinite(date.getTime())) return emptyValue;
  return date.toLocaleString('zh-CN', {
    timeZone: CHINA_TIME_ZONE,
    hour12: false,
  });
}
