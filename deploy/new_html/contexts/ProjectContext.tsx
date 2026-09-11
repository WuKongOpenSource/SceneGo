



import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import type { ProjectInfo, ProjectMember, ProjectRole } from '../types';
import { apiJson } from '../services/httpClient';
import { getStoredUserId } from '../services/accountStorage';

interface ProjectContextValue {
    projectId: string;
    project: ProjectInfo | null;
    members: ProjectMember[];
    myRole: ProjectRole | null;
    loading: boolean;
    error: string | null;
    reload: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue>({
    projectId: '',
    project: null,
    members: [],
    myRole: null,
    loading: true,
    error: null,
    reload: async () => {}
});

export const useProject = () => useContext(ProjectContext);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { projectId } = useParams<{ projectId: string }>();
    const [project, setProject] = useState<ProjectInfo | null>(null);
    const [members, setMembers] = useState<ProjectMember[]>([]);
    const [myRole, setMyRole] = useState<ProjectRole | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const currentUserId = getStoredUserId();

    const loadProject = useCallback(async () => {
        if (!projectId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await apiJson<any>(`/api/projects/${projectId}`, { method: 'GET' }, '加载项目');
            if (data.success) {
                const p = data.project;
                const tags = typeof p.tags === 'string' ? JSON.parse(p.tags) : (p.tags || []);
                setProject({
                    projectId: p.project_id,
                    projectName: p.project_name,
                    description: p.description || '',
                    coverUrl: p.cover_url,
                    tags,
                    ownerId: p.user_id,
                    ownerName: '',
                    memberCount: data.members?.length || 0,
                    isArchived: p.is_archived,
                    settings: p.settings && typeof p.settings === 'object' ? p.settings : {},
                    createdAt: new Date(p.created_at).getTime(),
                    updatedAt: new Date(p.updated_at).getTime(),
                    lastAccessedAt: p.last_accessed_at ? new Date(p.last_accessed_at).getTime() : undefined
                });

                if (data.members) {
                    const mapped: ProjectMember[] = data.members.map((m: any) => ({
                        id: `${m.project_id}_${m.user_id}`,
                        projectId: m.project_id,
                        userId: m.user_id,
                        username: m.username,
                        avatarUrl: m.avatar_url,
                        role: m.role,
                        responsibility: m.responsibility,
                        joinedAt: new Date(m.joined_at).getTime()
                    }));
                    setMembers(mapped);
                    const me = mapped.find(m => m.userId === currentUserId);
                    setMyRole(me?.role || null);
                }
            }
        } catch (e: any) {
            if (e?.status === 403) {
                setError('无权访问此项目');
            } else if (e?.status === 404) {
                setError('项目不存在');
            } else {
                setError(e.message);
            }
        } finally {
            setLoading(false);
        }
    }, [projectId, currentUserId]);

    useEffect(() => {
        loadProject();
    }, [loadProject]);

    return (
        <ProjectContext.Provider value={{
            projectId: projectId || '',
            project,
            members,
            myRole,
            loading,
            error,
            reload: loadProject
        }}>
            {children}
        </ProjectContext.Provider>
    );
};
