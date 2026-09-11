import { deleteEntityFile } from '../services/entityFileService';

export type CoverCleanupResult = 'skipped' | 'soft_deleted';

export function extractEntityFileIdFromDownloadUrl(url?: string | null): string | null {
  const value = String(url || '').trim();
  if (!value) return null;

  const match = value.match(/(?:^|\/)api\/files\/([^/?#]+)\/download(?:[/?#]|$)/i);
  if (!match?.[1]) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export async function cleanupReplacedCoverFile(
  previousCoverUrl?: string | null,
  nextFileId?: string | null,
): Promise<CoverCleanupResult> {
  const previousFileId = extractEntityFileIdFromDownloadUrl(previousCoverUrl);
  if (!previousFileId || previousFileId === nextFileId) {
    return 'skipped';
  }

  await deleteEntityFile(previousFileId);
  return 'soft_deleted';
}
