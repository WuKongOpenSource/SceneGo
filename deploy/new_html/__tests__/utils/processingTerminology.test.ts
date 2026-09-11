import { describe, expect, it } from 'vitest';
import {
  formatProcessingNodeName,
  sanitizeProcessingTerminology,
} from '../../utils/processingTerminology';

describe('processing terminology', () => {
  it('keeps routing identities private while presenting numbered processing nodes', () => {
    expect(formatProcessingNodeName('GPU1')).toBe('处理节点1');
    expect(formatProcessingNodeName('gpu-agent-2')).toBe('处理节点2');
    expect(formatProcessingNodeName('主渲染机')).toBe('主渲染机');
  });

  it('removes internal engine and hardware terms from public messages', () => {
    const message = sanitizeProcessingTerminology(
      'ComfyUI GPU 集群检测到 2 个 GPU Agent，GPU 节点正在运行。',
    );

    expect(message).toContain('处理集群');
    expect(message).toContain('处理节点');
    expect(message).not.toMatch(/GPU|ComfyUI/i);
  });
});
