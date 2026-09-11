import { hasPublicLocalRuntimeAdapter, invokePublicLocalRuntime } from './localRuntimeAdapter';
import { PUBLIC_LOCAL_CONNECTOR_MESSAGE } from './runtimeUnavailable';

export type ClusterNodeStatus = 'online' | 'busy' | 'healthy' | 'offline' | 'maintenance' | 'unavailable' | 'unknown';

export interface ClusterNodeOption {
  id: string;
  nodeId: string;
  agentId?: string;
  name: string;
  routingName?: string;
  status: ClusterNodeStatus;
  kind?: string;
  tasks?: number;
  maxConcurrent?: number;
}

export interface GpuTaskRouting {
  preferredAgentId?: string;
  preferredNodeId?: string;
  node?: ClusterNodeOption;
}

export interface GpuTaskRoutingOptions {
  strict?: boolean;
  automatic?: boolean;
}

export const DEFAULT_GPU_NODE_NAME = '未配置本地连接器';

export function normalizeClusterNode(row: Record<string, any>, index = 0): ClusterNodeOption {
  const rawStatus = String(row.status || '').toLowerCase();
  const status: ClusterNodeStatus = (
    ['online', 'busy', 'healthy', 'offline', 'maintenance', 'unavailable'].includes(rawStatus)
      ? rawStatus
      : 'unknown'
  ) as ClusterNodeStatus;
  return {
    id: String(row.id || `external-node-${index + 1}`),
    nodeId: String(row.node_id || row.id || `external-node-${index + 1}`),
    name: String(row.name || DEFAULT_GPU_NODE_NAME),
    status,
  };
}

export function isClusterNodeUsable(node: ClusterNodeOption): boolean {
  return node.status === 'online' || node.status === 'busy' || node.status === 'healthy';
}

export function formatClusterNodeQueue(node: ClusterNodeOption): string {
  return node.tasks != null && node.maxConcurrent != null
    ? `排队任务 ${node.tasks}/${node.maxConcurrent}`
    : '';
}

export function clusterNodePreferenceId(node: ClusterNodeOption): string {
  return node.nodeId || node.id;
}

export function selectGpuTaskNode(): undefined {
  return undefined;
}

export function setPreferredGpuNodeId(_nodeId: string): void {}

export function getPreferredGpuNodeId(): string {
  return '';
}

export async function fetchClusterNodes(): Promise<{
  nodes: ClusterNodeOption[];
  message: string;
  agentOnlyMode: boolean;
}> {
  if (!hasPublicLocalRuntimeAdapter()) {
    return { nodes: [], message: PUBLIC_LOCAL_CONNECTOR_MESSAGE, agentOnlyMode: false };
  }
  return invokePublicLocalRuntime('runtime.nodes.list', []);
}

export async function resolveGpuTaskRouting(
  explicitNodeId?: string,
  options?: GpuTaskRoutingOptions,
): Promise<GpuTaskRouting> {
  return invokePublicLocalRuntime<GpuTaskRouting>('runtime.route.resolve', [explicitNodeId, options]);
}
