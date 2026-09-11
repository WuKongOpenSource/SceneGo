const IMAGE_UPSCALE_RETENTION_DAYS = 30;
const RETENTION_MILLISECONDS = IMAGE_UPSCALE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatImageUpscaleDeletionTime(
  expiresAt?: string | null,
  completedAt?: string | null,
  createdAt?: string | null,
): string {
  const explicitExpiry = parseDate(expiresAt);
  const baseTime = parseDate(completedAt) || parseDate(createdAt);
  const deletionTime = explicitExpiry
    || (baseTime ? new Date(baseTime.getTime() + RETENTION_MILLISECONDS) : null);
  if (!deletionTime) return '';

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(deletionTime).map(part => [part.type, part.value]),
  );

  return `预计于 ${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}时${parts.minute}分删除`;
}
