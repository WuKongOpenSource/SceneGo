export const workflowPageImports = {
  audio: () => import('../pages/AudioStagePage').then(module => ({ default: module.AudioStagePage })),
  storyboard: () => import('../pages/StoryboardGenPage').then(module => ({ default: module.StoryboardGenPage })),
  video: () => import('../pages/VideoGenPage').then(module => ({ default: module.VideoGenPage })),
  enhance: () => import('../pages/EnhancePage').then(module => ({ default: module.EnhancePage })),
  final: () => import('../pages/FinalProductPage'),
};

export function preloadWorkflowPage(path: string) {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return;
  const load = workflowPageImports[path as keyof typeof workflowPageImports];
  if (load) void load().catch(() => {});
}
