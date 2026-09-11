import { useMutation, useQueryClient } from '@tanstack/react-query';
import { selectEntityFile, deleteEntityFile, uploadEntityFile } from '../services/entityFileService';

export function useSelectFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fileId: string; entityType: string; entityId: string; fileRole: string }) =>
      selectEntityFile(vars.fileId, vars.entityType, vars.entityId, vars.fileRole),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}

export function useDeleteFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fileId: string; entityType: string; entityId: string }) =>
      deleteEntityFile(vars.fileId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}

export function useUploadFileMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { file: File; entityType: string; entityId: string; fileRole: string; episodeId?: string }) =>
      uploadEntityFile(vars.file, vars.entityType, vars.entityId, vars.fileRole, vars.episodeId),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['entityFiles', vars.entityType, vars.entityId] });
    },
  });
}
