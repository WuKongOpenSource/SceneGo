import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteEntityFile } from '../../services/entityFileService';
import {
  cleanupReplacedCoverFile,
  extractEntityFileIdFromDownloadUrl,
} from '../../utils/coverCleanup';

vi.mock('../../services/entityFileService', () => ({
  deleteEntityFile: vi.fn(),
}));

describe('coverCleanup utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (deleteEntityFile as any).mockResolvedValue(undefined);
  });

  it('extracts file ids from relative and absolute download urls', () => {
    expect(extractEntityFileIdFromDownloadUrl('/api/files/file_old/download')).toBe('file_old');
    expect(extractEntityFileIdFromDownloadUrl('https://app.example.test/api/files/file%20old/download?token=abc')).toBe('file old');
  });

  it('skips cleanup for non-platform urls and unchanged file ids', async () => {
    await expect(cleanupReplacedCoverFile('https://cdn.example.com/cover.jpg', 'file_new')).resolves.toBe('skipped');
    await expect(cleanupReplacedCoverFile('/api/files/file_same/download', 'file_same')).resolves.toBe('skipped');

    expect(deleteEntityFile).not.toHaveBeenCalled();
  });

  it('moves the replaced cover file to the owner recycle bin', async () => {
    await expect(cleanupReplacedCoverFile('/api/files/file_old/download', 'file_new')).resolves.toBe('soft_deleted');

    expect(deleteEntityFile).toHaveBeenCalledWith('file_old');
  });
});
