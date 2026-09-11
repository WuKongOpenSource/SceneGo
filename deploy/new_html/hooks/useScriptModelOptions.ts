import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_SCRIPT_MODEL_OPTIONS,
  fetchScriptModelOptions,
  type ScriptModelOption,
} from '../services/scriptModelCatalogService';

export function useScriptModelOptions(): readonly ScriptModelOption[] {
  const [options, setOptions] = useState<readonly ScriptModelOption[]>(
    DEFAULT_SCRIPT_MODEL_OPTIONS,
  );

  const refresh = useCallback(async () => {
    try {
      setOptions(await fetchScriptModelOptions());
    } catch (error) {
      console.warn('获取文本模型运行时配置失败，使用默认映射:', error);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return options;
}
