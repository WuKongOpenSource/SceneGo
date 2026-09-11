import { useState, useEffect, useCallback, useRef } from 'react';
import {
  EntityFile,
  fetchEntityFiles,
  selectEntityFile,
  deleteEntityFile,
} from '../services/entityFileService';

export function useEntityFiles(
  entityType: string,
  entityId: string | undefined | null,
  fileRole?: string,
) {
  const [files, setFiles] = useState<EntityFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    if (!entityId) return;
    setIsLoading(true);
    try {
      const result = await fetchEntityFiles(entityType, entityId, fileRole);
      if (mountedRef.current) setFiles(result.items);
    } catch (e) {
      console.error('useEntityFiles refresh error:', e);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [entityType, entityId, fileRole]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedFile = files.find(f => f.isSelected) ?? null;

  const selectFile = useCallback(async (fileId: string) => {
    if (!entityId || !fileRole) return;
    try {
      await selectEntityFile(fileId, entityType, entityId, fileRole);
      setFiles(prev =>
        prev.map(f => ({ ...f, isSelected: f.fileId === fileId })),
      );
    } catch (e) {
      console.error('selectFile error:', e);
    }
  }, [entityType, entityId, fileRole]);

  const removeFile = useCallback(async (fileId: string) => {
    try {
      await deleteEntityFile(fileId);
      setFiles(prev => prev.filter(f => f.fileId !== fileId));
    } catch (e) {
      console.error('deleteFile error:', e);
    }
  }, []);

  return { files, selectedFile, isLoading, selectFile, deleteFile: removeFile, refresh };
}

export type { EntityFile };
