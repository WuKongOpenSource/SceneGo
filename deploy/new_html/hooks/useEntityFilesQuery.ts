import { useQuery } from '@tanstack/react-query';
import { fetchEntityFiles } from '../services/entityFileService';
import type { EntityFile } from '../services/entityFileService';

export { type EntityFile };

export function useEntityFilesQuery(
  entityType: string,
  entityId: string | null | undefined,
  fileRole?: string,
) {
  return useQuery<{ items: EntityFile[]; total: number }>({
    queryKey: ['entityFiles', entityType, entityId, fileRole],
    queryFn: () => fetchEntityFiles(entityType, entityId!, fileRole),
    enabled: !!entityId,
    staleTime: 30_000,
  });
}
