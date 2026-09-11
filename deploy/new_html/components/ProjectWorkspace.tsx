



import React from 'react';
import { ProjectProvider, useProject } from '../contexts/ProjectContext';
import { Outlet } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';

const WorkspaceContent: React.FC = () => {
    const { loading, error } = useProject();

    if (loading) {
        return (
            <div className="h-screen bg-n0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-n300">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <span className="text-sm">加载项目中...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-screen bg-n0 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-danger">
                    <AlertCircle className="w-10 h-10" />
                    <span className="text-sm">{error}</span>
                    <a href="/projects" className="text-xs text-primary hover:underline mt-2">
                        返回项目列表
                    </a>
                </div>
            </div>
        );
    }

    return <Outlet />;
};

const ProjectWorkspace: React.FC = () => {
    return (
        <ProjectProvider>
            <WorkspaceContent />
        </ProjectProvider>
    );
};

export default ProjectWorkspace;
