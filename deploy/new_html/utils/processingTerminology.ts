const PROCESSING_NODE_PREFIX = '处理节点';

export function formatProcessingNodeName(value: unknown, fallbackIndex = 0): string {
  const raw = String(value || '').trim();
  if (!raw) return `${PROCESSING_NODE_PREFIX}${Math.max(1, fallbackIndex + 1)}`;

  const numberedNode = raw.match(/^(?:gpu|agent[_\s-]*gpu|gpu[_\s-]*agent)[_\s-]*(\d+)$/i);
  if (numberedNode) return `${PROCESSING_NODE_PREFIX}${numberedNode[1]}`;

  return sanitizeProcessingTerminology(raw);
}

export function sanitizeProcessingTerminology(value: unknown): string {
  return String(value || '')
    .replace(/ComfyUI\s*GPU\s*集群/gi, '处理集群')
    .replace(/GPU\s*集群节点/gi, '处理集群节点')
    .replace(/GPU\s*Agent/gi, '处理节点')
    .replace(/ComfyUI\s*Agent/gi, '处理节点')
    .replace(/ComfyUI/gi, '处理服务')
    .replace(/GPU\s*节点/gi, '处理节点')
    .replace(/GPU/gi, '处理集群');
}
