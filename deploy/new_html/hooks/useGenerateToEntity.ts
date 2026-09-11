import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useGenerateToEntity(entityType: string, entityId: string | undefined) {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);

  const generate = useCallback(async <T>(
    generatorFn: () => Promise<T>
  ): Promise<T> => {
    setIsGenerating(true);
    try {
      const result = await generatorFn();
      if (entityId) {
        queryClient.invalidateQueries({ queryKey: ['entityFiles', entityType, entityId] });
      }
      return result;
    } finally {
      setIsGenerating(false);
    }
  }, [entityType, entityId, queryClient]);

  const invalidate = useCallback(() => {
    if (entityId) {
      queryClient.invalidateQueries({ queryKey: ['entityFiles', entityType, entityId] });
    }
  }, [entityType, entityId, queryClient]);

  return { generate, isGenerating, invalidate };
}
