






















import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskProvider } from './contexts/TaskContext';
import { WorkspaceProvider } from './contexts/WorkspaceContext';
import { runWhenIdle } from './utils/idleScheduler';
import { ADMIN_BASE_PATH } from './admin/adminRoute';
import { PlatformShell } from './components/PlatformShell';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: 2,
    },
  },
});

const ProjectHub = React.lazy(() => import('./components/ProjectHub'));
const CreatePage = React.lazy(() => import('./pages/CreatePage'));
const ProjectWorkspace = React.lazy(() => import('./components/ProjectWorkspace'));
const WorkflowLayout = React.lazy(() => import('./layouts/WorkflowLayout').then(m => ({ default: m.WorkflowLayout })));
const GlobalToolsLayout = React.lazy(() => import('./layouts/GlobalToolsLayout').then(m => ({ default: m.GlobalToolsLayout })));
const EpisodeHubPage = React.lazy(() => import('./pages/EpisodeHubPage').then(m => ({ default: m.EpisodeHubPage })));
const ScriptPage = React.lazy(() => import('./pages/ScriptPage').then(m => ({ default: m.ScriptPage })));
const MaterialsPage = React.lazy(() => import('./pages/MaterialsPage').then(m => ({ default: m.MaterialsPage })));
const AudioStagePage = React.lazy(() => import('./pages/AudioStagePage').then(m => ({ default: m.AudioStagePage })));
const DesignPage = React.lazy(() => import('./pages/DesignPage').then(m => ({ default: m.DesignPage })));
const GenerationPage = React.lazy(() => import('./pages/GenerationPage').then(m => ({ default: m.GenerationPage })));
const EnhancePage = React.lazy(() => import('./pages/EnhancePage').then(m => ({ default: m.EnhancePage })));
const FinalProductPage = React.lazy(() => import('./pages/FinalProductPage'));
const FinalProductSharePage = React.lazy(() => import('./pages/FinalProductSharePage'));
const StoryboardGenPage = React.lazy(() => import('./pages/StoryboardGenPage').then(m => ({ default: m.StoryboardGenPage })));
const VideoGenPage = React.lazy(() => import('./pages/VideoGenPage').then(m => ({ default: m.VideoGenPage })));
const HistoryPage = React.lazy(() => import('./pages/HistoryPage').then(m => ({ default: m.HistoryPage })));
const RecycleBinPage = React.lazy(() => import('./pages/RecycleBinPage').then(m => ({ default: m.RecycleBinPage })));
const StudioRedirectPage = React.lazy(() => import('./pages/StudioRedirectPage').then(m => ({ default: m.StudioRedirectPage })));
const MediaLibraryPage = React.lazy(() => import('./pages/MediaLibraryPage'));
const ImageUpscalePage = React.lazy(() => import('./pages/ImageUpscalePage'));
const CreditsPage = React.lazy(() => import('./pages/CreditsPage'));
const ProfilePage = React.lazy(() => import('./pages/ProfilePage'));
const UpdatesPage = React.lazy(() => import('./pages/UpdatesPage'));
const VideoReversePage = React.lazy(() => import('./pages/VideoReversePage'));
const AdminPage = React.lazy(() => import('@runtime/AdminPage').then(m => ({ default: m.AdminPage })));
const AdminFeatureTabs = React.lazy(() => import('./components/AdminFeatureTabs'));
const PostProcessPage = React.lazy(() => import('./components/PostProcessPage'));
const AdminLayout = React.lazy(() => import('./admin/AdminLayout'));
const AdminHubPage = React.lazy(() => import('./admin/AdminHubPage'));
const AdminSettingsPage = React.lazy(() => import('./admin/AdminSettingsPage'));
const CrmHost = React.lazy(() => import('./admin/crmUI').then(m => ({ default: m.CrmHost })));

const RouteFallback: React.FC = () => (
    <div className="h-screen w-full bg-n0 flex items-center justify-center text-sm text-n300">
        加载中...
    </div>
);





const AdminOperationsPanel: React.FC = () => {
    const [sp] = useSearchParams();
    const tab = (sp.get('tab') as 'users' | 'stats' | 'results' | 'system') || 'users';
    return <AdminPage embedded embedTab={tab} />;
};
const AdminFeaturesPanel: React.FC = () => {
    const [sp] = useSearchParams();
    const tab = (sp.get('tab') as any) || 'accounts';
    return <AdminFeatureTabs embedTab={tab} />;
};

const DeferredCrmHost: React.FC = () => {
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => {
        return runWhenIdle(() => setMounted(true), { timeout: 1500, fallbackDelayMs: 300 });
    }, []);

    if (!mounted) return null;
    return (
        <React.Suspense fallback={null}>
            <CrmHost />
        </React.Suspense>
    );
};

const RoutedPlatformShell: React.FC<React.PropsWithChildren> = ({ children }) => {
    const { pathname } = useLocation();
    const showFooter = pathname.replace(/\/$/, '') === '/updates' || pathname.startsWith('/share/final/');
    return <PlatformShell showFooter={showFooter}>{children}</PlatformShell>;
};

const App: React.FC = () => {
    return (
        <QueryClientProvider client={queryClient}>
        <BrowserRouter>
            <WorkspaceProvider>
            <TaskProvider>
                <RoutedPlatformShell>
                <DeferredCrmHost />
                <React.Suspense fallback={<RouteFallback />}>
                <Routes>

                    <Route path="/share/final/:token" element={<FinalProductSharePage />} />
                    <Route path="/updates" element={<UpdatesPage />} />


                    <Route path="/projects" element={<ProjectHub />} />

                    <Route path="/create" element={<CreatePage />} />


                    <Route path="/tools" element={<GlobalToolsLayout />}>
                        <Route index element={<Navigate to="media-library" replace />} />
                        <Route path="media-library" element={<MediaLibraryPage />} />
                        <Route path="image-upscale" element={<ImageUpscalePage />} />
                        <Route path="history" element={<HistoryPage />} />
                        <Route path="recycle-bin" element={<RecycleBinPage />} />
                    </Route>


                    <Route path="/projects/:projectId" element={<ProjectWorkspace />}>

                        <Route index element={<Navigate to="episodes" replace />} />


                        <Route path="episodes" element={<EpisodeHubPage />} />


                        <Route path="media-library" element={<MediaLibraryPage />} />


                        <Route path="video-reverse" element={<VideoReversePage />} />


                        <Route path="ep/:episodeId">

                            <Route index element={<EpisodeHubPage />} />


                            <Route path="workflow" element={<WorkflowLayout />}>
                                <Route index element={<Navigate to="script" replace />} />
                                <Route path="script" element={<ScriptPage />} />

                                <Route path="video-reverse" element={<Navigate to="../script" replace />} />
                                <Route path="design" element={<DesignPage />} />
                                <Route path="materials" element={<MaterialsPage />} />
                                <Route path="audio" element={<AudioStagePage />} />
                                <Route path="storyboard" element={<StoryboardGenPage />} />
                                <Route path="generation" element={<GenerationPage />} />
                                <Route path="video" element={<VideoGenPage />} />
                                <Route path="enhance" element={<EnhancePage />} />
                                <Route path="final" element={<FinalProductPage />} />

                                <Route path="media-library" element={<MediaLibraryPage />} />
                                <Route path="history" element={<HistoryPage />} />
                                <Route path="recycle-bin" element={<RecycleBinPage />} />
                                <Route path="image-upscale" element={<ImageUpscalePage />} />
                            </Route>


                            <Route path="canvas" element={<StudioRedirectPage />} />
                        </Route>

                            <Route path="postprocess" element={<PostProcessPage />} />
                    </Route>


                    <Route path="/credits" element={<CreditsPage />} />
                    <Route path="/profile" element={<ProfilePage />} />


                    <Route path={ADMIN_BASE_PATH} element={<AdminLayout />}>
                        <Route index element={<AdminHubPage />} />
                        <Route path="operations" element={<AdminOperationsPanel />} />
                        <Route path="features" element={<AdminFeaturesPanel />} />
                        <Route path="settings" element={<AdminSettingsPage />} />
                    </Route>


                    <Route path="/" element={<Navigate to="/projects" replace />} />
                    <Route path="/canvas" element={<Navigate to="/projects" replace />} />
                    <Route path="*" element={<Navigate to="/projects" replace />} />
                </Routes>
                </React.Suspense>
                </RoutedPlatformShell>
            </TaskProvider>
            </WorkspaceProvider>
        </BrowserRouter>
        </QueryClientProvider>
    );
};

export default App;
