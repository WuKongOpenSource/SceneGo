import React, { useMemo } from 'react';
import { Brush, Clock3, Library, ScanLine, Trash2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import AppSidebar, { type AppSidebarItem } from '../components/AppSidebar';

export function buildStudioUrl(projectId: string, episodeId: string): string {
  const params = new URLSearchParams({
    projectId,
    episodeId,
    returnTo: `/projects/${encodeURIComponent(projectId)}/ep/${encodeURIComponent(episodeId)}/workflow/script`,
  });
  return `/studio/?${params.toString()}`;
}

export const StudioRedirectPage: React.FC = () => {
  const { projectId = '', episodeId = '' } = useParams();
  const studioUrl = useMemo(() => (
    projectId && episodeId ? buildStudioUrl(projectId, episodeId) : ''
  ), [episodeId, projectId]);

  if (!studioUrl) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-n20 text-sm text-danger">
        缺少项目或分集信息，无法打开专业画布。
      </div>
    );
  }

  const episodeBase = `/projects/${encodeURIComponent(projectId)}/ep/${encodeURIComponent(episodeId)}`;
  const workflowBase = `${episodeBase}/workflow`;
  const sidebarTools: AppSidebarItem[] = [
    { key: 'canvas', label: '专业画布', icon: Brush, to: `${episodeBase}/canvas` },
    { key: 'media-library', label: '我的素材', icon: Library, to: `${workflowBase}/media-library` },
    { key: 'image-upscale', label: '图片高清放大', icon: ScanLine, to: `${workflowBase}/image-upscale` },
    { key: 'history', label: '生成历史', icon: Clock3, to: `${workflowBase}/history` },
    { key: 'recycle-bin', label: '回收站', icon: Trash2, to: `${workflowBase}/recycle-bin` },
  ];

  return (
    <div className="layout-safe flex h-screen min-w-0 overflow-hidden bg-n20 text-n800">
      <AppSidebar exportTo={`${workflowBase}/final`} tools={sidebarTools} />
      <main className="min-h-0 min-w-0 flex-1 overflow-hidden bg-n900">
        <iframe
          src={studioUrl}
          title="专业画布"
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write"
        />
      </main>
    </div>
  );
};
