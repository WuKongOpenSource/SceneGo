import { apiJson } from './httpClient';

export interface EntityFile {
  fileId: string;
  fileUrl: string;
  fileType: string;
  fileRole: string;
  isSelected: boolean;
  createdAt: string;
  deletedAt?: string;
  isDeleted?: boolean;
  thumbnailUrl?: string;
  metadata?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

function normalize(row: any): EntityFile {
  return {
    fileId: row.file_id ?? row.fileId ?? '',
    fileUrl: row.file_url ?? row.fileUrl ?? '',
    fileType: row.file_type ?? row.fileType ?? '',
    fileRole: row.file_role ?? row.fileRole ?? '',
    isSelected: !!(row.is_selected ?? row.isSelected),
    createdAt: row.created_at ?? row.createdAt ?? '',
    deletedAt: row.deleted_at ?? row.deletedAt,
    isDeleted: !!(row.is_deleted ?? row.isDeleted),
    thumbnailUrl: row.thumbnail_url ?? row.thumbnailUrl ?? row.metadata?.thumbnail_url,
    metadata: row.metadata,
    entityType: row.entity_type ?? row.entityType,
    entityId: row.entity_id ?? row.entityId,
  };
}

export async function fetchEntityFiles(
  entityType: string,
  entityId: string,
  fileRole?: string,
): Promise<{ items: EntityFile[]; total: number }> {
  const params = new URLSearchParams({ entity_type: entityType, entity_id: entityId });
  if (fileRole) params.set('file_role', fileRole);
  const data = await apiJson<{ items?: any[]; total?: number }>(
    `/api/entity-files?${params}`,
    { method: 'GET' },
    'fetchEntityFiles',
  );
  return {
    items: (data.items || []).map(normalize),
    total: data.total ?? 0,
  };
}

export async function fetchUserFiles(
  fileType?: string,
  limit: number = 100,
  offset: number = 0,
): Promise<{ items: EntityFile[]; total: number }> {
  const params = new URLSearchParams();
  if (fileType) params.set('file_type', fileType);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const data = await apiJson<{ items?: any[]; total?: number }>(
    `/api/user-files?${params}`,
    { method: 'GET' },
    'fetchUserFiles',
  );
  return {
    items: (data.items || []).map(normalize),
    total: data.total ?? 0,
  };
}

export async function fetchDeletedUserFiles(
  fileType?: string,
  limit: number = 100,
  offset: number = 0,
): Promise<{ items: EntityFile[]; total: number }> {
  const params = new URLSearchParams();
  if (fileType) params.set('file_type', fileType);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  const data = await apiJson<{ items?: any[]; total?: number }>(
    `/api/user-files/recycle-bin?${params}`,
    { method: 'GET' },
    'fetchDeletedUserFiles',
  );
  return {
    items: (data.items || []).map(normalize),
    total: data.total ?? 0,
  };
}

export async function selectEntityFile(
  fileId: string,
  entityType: string,
  entityId: string,
  fileRole: string,
): Promise<EntityFile> {
  const data = await apiJson<{ file: any }>(`/api/entity-files/${fileId}/select`, {
    method: 'PUT',
    body: JSON.stringify({ entity_type: entityType, entity_id: entityId, file_role: fileRole }),
  }, 'selectEntityFile');
  return normalize(data.file);
}

export async function deleteEntityFile(fileId: string): Promise<void> {
  await apiJson<{ success: boolean }>(`/api/entity-files/${fileId}`, {
    method: 'DELETE',
  }, 'deleteEntityFile');
}

export async function restoreEntityFile(fileId: string): Promise<EntityFile> {
  const data = await apiJson<{ file: any }>(`/api/entity-files/${fileId}/restore`, {
    method: 'POST',
  }, 'restoreEntityFile');
  return normalize(data.file);
}

export async function hardDeleteEntityFile(fileId: string): Promise<{ freed_bytes: number }> {
  return apiJson<{ freed_bytes: number }>(`/api/entity-files/${fileId}/hard?risk_ack=true`, {
    method: 'DELETE',
  }, 'hardDeleteEntityFile');
}

export async function hardDeleteEntityFiles(fileIds: string[]): Promise<{ deleted: number; freed_bytes: number; errors: Array<{ file_id: string; error: string }> }> {
  return apiJson<{ deleted: number; freed_bytes: number; errors: Array<{ file_id: string; error: string }> }>('/api/entity-files/hard-delete-batch', {
    method: 'POST',
    body: JSON.stringify({ file_ids: fileIds, risk_ack: true }),
  }, 'hardDeleteEntityFiles');
}

export async function linkEntityFile(
  fileId: string,
  entityType: string,
  entityId: string,
  fileRole: string,
  isSelected: boolean = false,
): Promise<EntityFile> {
  const data = await apiJson<{ file: any }>('/api/entity-files/link', {
    method: 'POST',
    body: JSON.stringify({
      file_id: fileId, entity_type: entityType,
      entity_id: entityId, file_role: fileRole, is_selected: isSelected,
    }),
  }, 'linkEntityFile');
  return normalize(data.file);
}

export async function uploadEntityFile(
  file: File,
  entityType: string,
  entityId: string,
  fileRole: string,
  episodeId?: string,
  options?: { source?: 'upload' | 'local_transform'; transform?: 'horizontal_mirror' },
): Promise<{ fileId: string; fileUrl: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (entityType) formData.append('entity_type', entityType);
  if (entityId) formData.append('entity_id', entityId);
  if (fileRole) formData.append('file_role', fileRole);
  if (episodeId) formData.append('episode_id', episodeId);
  if (options?.source) formData.append('source', options.source);
  if (options?.transform) formData.append('transform', options.transform);

  const data = await apiJson<{ file_id: string; file_url: string }>('/api/entity-files/upload', {
    method: 'POST',
    body: formData,
  }, 'uploadEntityFile', { includeContentType: false });
  return { fileId: data.file_id, fileUrl: data.file_url };
}
