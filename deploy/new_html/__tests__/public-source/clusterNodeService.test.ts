import { describe, expect, it } from 'vitest';

import { formatClusterNodeQueue, type ClusterNodeOption } from '../../public-source/clusterNodeService';

const node = (overrides: Partial<ClusterNodeOption> = {}): ClusterNodeOption => ({
  id: 'external-node-1',
  nodeId: 'external-node-1',
  name: 'External connector',
  status: 'online',
  ...overrides,
});

describe('public cluster node display', () => {
  it('formats queue information without requiring private runtime fields', () => {
    expect(formatClusterNodeQueue(node({ tasks: 2, maxConcurrent: 4 }))).toBe('排队任务 2/4');
    expect(formatClusterNodeQueue(node({ tasks: 0 }))).toBe('');
  });
});
