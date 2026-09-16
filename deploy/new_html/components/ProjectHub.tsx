import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Archive, Trash2, Users, Clock, FolderOpen, MoreVertical, Share2, Upload, Pencil, UserPlus } from 'lucide-react';
import { apiJson } from '../services/httpClient';
import { secureApiUrl } from '../services/httpClient';
import { useCurrentOrgId, useWorkspace } from '../contexts/WorkspaceContext';
import ShareResourceDialog from './ShareResourceDialog';
import { createShare } from '../services/shareService';
import { uploadEntityFile } from '../services/entityFileService';
import {
    addProjectMember,
    getProjectMembers,
    removeProjectMember,
    updateProject,
    updateProjectMember,
} from '../services/projectWorkflowService';
import type { ProjectInfo } from '../types';
import { crmMessage, crmConfirm } from '../admin/crmUI';
import { BrandLogo } from './BrandLogo';
import AccountMenu from './AccountMenu';
import AppSidebar from './AppSidebar';
import { prepareCoverUploadFile } from '../utils/coverImage';
import { cleanupReplacedCoverFile } from '../utils/coverCleanup';
import ProjectGroupManager, { ProjectGroupSelect } from './ProjectGroupManager';
import { listProjectGroups, type ProjectGroup } from '../services/projectGroupService';

type SortKey = 'updated' | 'created' | 'name';
type ProjectTab = 'all' | 'archived';
type ProjectMemberRow = {
    user_id: string;
    username?: string;
    role?: string;
    responsibility?: string;
};

const ProjectHub: React.FC = () => {
    const navigate = useNavigate();
    const coverInputRef = useRef<HTMLInputElement | null>(null);
    const projectLoadRequest = useRef(0);
    const groupLoadRequest = useRef(0);
    const [projects, setProjects] = useState<ProjectInfo[]>([]);
    const [groups, setGroups] = useState<ProjectGroup[]>([]);
    const [groupsError, setGroupsError] = useState('');
    const [groupFilter, setGroupFilter] = useState('all');
    const [groupManagerOpen, setGroupManagerOpen] = useState(false);
    const [editGroupId, setEditGroupId] = useState('');
    const [newGroupId, setNewGroupId] = useState('');
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<ProjectTab>('all');
    const [sortBy, setSortBy] = useState<SortKey>('updated');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newProjectName, setNewProjectName] = useState('');
    const [newProjectDesc, setNewProjectDesc] = useState('');
    const [newProjectMembers, setNewProjectMembers] = useState('');
    const [contextMenu, setContextMenu] = useState<{ projectId: string; x: number; y: number; isArchived?: boolean } | null>(null);
    const [coverUploadTargetId, setCoverUploadTargetId] = useState<string | null>(null);
    const [uploadingCoverProjectId, setUploadingCoverProjectId] = useState<string | null>(null);
    const [editTarget, setEditTarget] = useState<ProjectInfo | null>(null);
    const [editProjectName, setEditProjectName] = useState('');
    const [editProjectDesc, setEditProjectDesc] = useState('');
    const [editMembers, setEditMembers] = useState<ProjectMemberRow[]>([]);
    const memberResponsibilityBaselineRef = useRef<Record<string, string>>({});
    const [editMembersLoading, setEditMembersLoading] = useState(false);
    const [editSaving, setEditSaving] = useState(false);
    const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
    const [newMemberIdentity, setNewMemberIdentity] = useState('');
    const [newMemberRole, setNewMemberRole] = useState('member');


    const orgId = useCurrentOrgId();
    const { isOrgWorkspace, currentName } = useWorkspace();
    const [shareTarget, setShareTarget] = useState<ProjectInfo | null>(null);


    const [newProjectVisibility, setNewProjectVisibility] = useState<'private' | 'org-default'>('private');
    useEffect(() => {
        setNewProjectVisibility('private');
    }, [showCreateModal]);

    const loadProjects = useCallback(async () => {
        const request = ++projectLoadRequest.current;
        setLoading(true);
        try {
            const qs = new URLSearchParams({ include_archived: 'true' });
            if (orgId) qs.set('org_id', orgId);
            const data = await apiJson<any>(`/api/projects?${qs.toString()}`, {}, '项目列表');
            if (request !== projectLoadRequest.current) return;
            if (data.success) {
                setProjects(data.projects.map((p: any) => ({
                    projectId: p.project_id,
                    projectName: p.project_name,
                    description: p.description || '',
                    coverUrl: p.cover_url,
                    tags: typeof p.tags === 'string' ? JSON.parse(p.tags || '[]') : (p.tags || []),
                    ownerId: p.user_id,
                    ownerName: p.owner_name || p.user_id,
                    memberCount: p.member_count || 1,
                    isArchived: p.is_archived,
                    createdAt: new Date(p.created_at).getTime(),
                    updatedAt: new Date(p.updated_at).getTime(),
                    lastAccessedAt: p.last_accessed_at ? new Date(p.last_accessed_at).getTime() : undefined,
                    memberRole: p.member_role,
                    visibility: p.visibility,
                    groupId: p.group_id,
                    groupName: p.group_name,
                    episodeCount: typeof p.episode_count === 'number' ? p.episode_count : Number(p.episode_count || 0),
                })));
            }
        } catch (e) {
            if (request === projectLoadRequest.current) console.error('加载项目列表失败:', e);
        } finally {
            if (request === projectLoadRequest.current) setLoading(false);
        }
    }, [orgId]);

    useEffect(() => {
        void loadProjects();
        return () => { projectLoadRequest.current += 1; };
    }, [loadProjects]);

    const loadGroups = useCallback(async () => {
        const request = ++groupLoadRequest.current;
        try {
            const nextGroups = await listProjectGroups();
            if (request !== groupLoadRequest.current) return;
            setGroups(nextGroups); setGroupsError('');
        } catch {
            if (request === groupLoadRequest.current) setGroupsError('项目分组加载失败，请重试');
        }
    }, []);
    const refreshGroupsAndProjects = useCallback(async () => {
        await Promise.all([loadGroups(), loadProjects()]);
    }, [loadGroups, loadProjects]);
    useEffect(() => {
        void loadGroups();
        const onFocus = () => { void refreshGroupsAndProjects(); };
        window.addEventListener('focus', onFocus);
        return () => { window.removeEventListener('focus', onFocus); groupLoadRequest.current += 1; };
    }, [loadGroups, refreshGroupsAndProjects]);
    const visibleGroups = useMemo(() => {
        const result = new Map(groups.map(group => [group.group_id, group.group_name]));
        projects.forEach(project => {
            if (project.groupId && !result.has(project.groupId)) result.set(project.groupId, project.groupName || '共享项目分组');
        });
        return [...result].map(([id, name]) => ({ id, name }));
    }, [groups, projects]);
    const groupNameFor = (project: ProjectInfo) => !project.groupId ? '未分组' : groups.find(group => group.group_id === project.groupId)?.group_name || project.groupName || '当前分组';
    useEffect(() => {
        if (!loading && !groupsError && groupFilter !== 'all' && groupFilter !== 'ungrouped' && !visibleGroups.some(group => group.id === groupFilter)) setGroupFilter('all');
    }, [groupFilter, groupsError, loading, visibleGroups]);

    const activeProjectCount = useMemo(() => projects.filter(p => !p.isArchived).length, [projects]);
    const archivedProjectCount = useMemo(() => projects.filter(p => p.isArchived).length, [projects]);

    const filteredProjects = useMemo(() => {
        let list = projects.filter(p => activeTab === 'archived' ? p.isArchived : !p.isArchived);
        if (groupFilter !== 'all') list = list.filter(project => groupFilter === 'ungrouped' ? !project.groupId : project.groupId === groupFilter);
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            list = list.filter(p =>
                p.projectName.toLowerCase().includes(q) ||
                p.description.toLowerCase().includes(q) ||
                p.tags.some(t => t.toLowerCase().includes(q))
            );
        }
        list.sort((a, b) => {
            if (sortBy === 'name') return a.projectName.localeCompare(b.projectName);
            if (sortBy === 'created') return b.createdAt - a.createdAt;
            return b.updatedAt - a.updatedAt;
        });
        return list;
    }, [projects, activeTab, searchQuery, sortBy, groupFilter]);

    const handleCreate = async () => {
        if (!newProjectName.trim()) return;
        try {
            const data = await apiJson<any>('/api/projects', {
                method: 'POST',
                body: JSON.stringify({
                    project_name: newProjectName,
                    group_id: newGroupId || null,
                    description: newProjectDesc,
                    visibility: newProjectVisibility,
                    member_usernames: newProjectMembers
                        .split(/[\s,，;；]+/)
                        .map(value => value.trim())
                        .filter(Boolean),
                })
            }, '创建项目');
            if (data.success) {
                const createdProjectId = data.project?.project_id;


                if (createdProjectId && newProjectVisibility === 'org-default' && orgId) {
                    try {
                        await createShare({
                            resource_type: 'project',
                            resource_id: createdProjectId,
                            share_target_type: 'org',
                            share_target_id: orgId,
                        });
                    } catch (e) {
                        console.warn('自动共享给组织失败：', e);
                    }
                }
                setShowCreateModal(false);
                setNewProjectName('');
                setNewProjectDesc('');
                setNewProjectMembers('');
                const missingMembers = data.member_additions?.missing_usernames || [];
                if (missingMembers.length > 0) {
                    crmMessage.warning(`项目已创建，以下成员未找到：${missingMembers.join('、')}`);
                }
                navigate(`/projects/${createdProjectId}`);
            }
        } catch (e) {
            console.error('创建项目失败:', e);
        }
    };

    const handleDelete = async (projectId: string) => {
        setContextMenu(null);

        const proj = projects.find(p => p.projectId === projectId);
        const epCount = proj?.episodeCount ?? 0;
        const name = proj?.projectName || projectId;
        const message = epCount > 0
            ? `⚠️ 项目「${name}」含 ${epCount} 集内容！\n\n删除将永久移除该项目的所有集、分镜、视频段，且不可恢复。\n\n确定要删除这个有内容的项目吗？`
            : `确定删除空项目「${name}」？（无集内容）此操作不可撤销。`;
        if (!await crmConfirm({ title: epCount > 0 ? '⚠️ 删除有内容的项目' : '删除空项目', message, type: 'danger', confirmText: epCount > 0 ? `仍要删除（含${epCount}集）` : '删除' })) return;
        try {
            await apiJson(`/api/projects/${projectId}`, {
                method: 'DELETE',
            }, '删除项目');
            crmMessage.success('已删除');
            void refreshGroupsAndProjects();
        } catch (e) {
            console.error('删除失败:', e);
            crmMessage.error('删除失败，请检查网络');
        }
    };

    const handleArchive = async (projectId: string) => {
        setContextMenu(null);
        try {
            await apiJson(`/api/projects/${projectId}/archive`, {
                method: 'POST',
            }, '归档项目');
            crmMessage.success('已归档');
            loadProjects();
        } catch (e) {
            console.error('归档失败:', e);
            crmMessage.error('归档请求失败，请检查网络');
        }
    };

    const handleUnarchive = async (projectId: string) => {
        setContextMenu(null);
        try {
            await apiJson(`/api/projects/${projectId}/unarchive`, {
                method: 'POST',
            }, '取消归档项目');
            crmMessage.success('已取消归档');
            loadProjects();
        } catch (e) {
            console.error('取消归档失败:', e);
            crmMessage.error('请求失败，请检查网络');
        }
    };

    const openCoverUpload = useCallback((projectId: string) => {
        setContextMenu(null);
        setCoverUploadTargetId(projectId);
        window.setTimeout(() => coverInputRef.current?.click(), 0);
    }, []);

    const handleCoverFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0] || null;
        event.target.value = '';
        const projectId = coverUploadTargetId;
        setCoverUploadTargetId(null);
        if (!file || !projectId) return;

        if (!file.type.startsWith('image/')) {
            crmMessage.warning('请选择图片文件作为项目封面');
            return;
        }

        setUploadingCoverProjectId(projectId);
        try {
            const previousCoverUrl = projects.find(project => project.projectId === projectId)?.coverUrl;
            const coverFile = await prepareCoverUploadFile(file);
            const uploaded = await uploadEntityFile(coverFile, 'project', projectId, 'cover');
            await updateProject(projectId, { cover_url: uploaded.fileUrl });
            setProjects(prev => prev.map(project =>
                project.projectId === projectId
                    ? { ...project, coverUrl: uploaded.fileUrl, updatedAt: Date.now() }
                    : project
            ));
            try {
                await cleanupReplacedCoverFile(previousCoverUrl, uploaded.fileId);
                crmMessage.success('项目封面已更新');
            } catch (cleanupError) {
                console.warn('Failed to clean up replaced project cover:', cleanupError);
                crmMessage.warning('项目封面已更新，但旧封面文件清理失败');
            }
        } catch (error) {
            console.error('上传项目封面失败:', error);
            crmMessage.error('上传项目封面失败，请检查图片格式或网络');
        } finally {
            setUploadingCoverProjectId(null);
        }
    }, [coverUploadTargetId, projects]);

    const loadEditMembers = useCallback(async (projectId: string) => {
        setEditMembersLoading(true);
        memberResponsibilityBaselineRef.current = {};
        try {
            const data = await getProjectMembers(projectId);
            const members = data.members || [];
            setEditMembers(members);
            return members as ProjectMemberRow[];
        } catch (error) {
            console.error('加载项目成员失败:', error);
            setEditMembers([]);
            crmMessage.error('加载项目成员失败');
            return [] as ProjectMemberRow[];
        } finally {
            setEditMembersLoading(false);
        }
    }, []);

    const openEditProject = useCallback((project: ProjectInfo) => {
        setContextMenu(null);
        setEditTarget(project);
        setEditProjectName(project.projectName);
        setEditProjectDesc(project.description || '');
        setEditGroupId(project.groupId || '');
        setNewMemberIdentity('');
        setNewMemberRole('member');
        void loadEditMembers(project.projectId);
    }, [loadEditMembers]);

    const resetEditProject = useCallback(() => {
        setEditTarget(null);
        setEditMembers([]);
        setNewMemberIdentity('');
        memberResponsibilityBaselineRef.current = {};
    }, []);

    const closeEditProject = useCallback(() => {
        if (editSaving || memberBusyId) return;
        resetEditProject();
    }, [editSaving, memberBusyId, resetEditProject]);

    const refreshProjectMemberCount = useCallback((projectId: string, nextCount: number) => {
        setProjects(prev => prev.map(project =>
            project.projectId === projectId ? { ...project, memberCount: nextCount } : project
        ));
    }, []);

    const handleSaveProjectEdit = useCallback(async () => {
        if (!editTarget) return;
        const nextName = editProjectName.trim();
        if (!nextName) {
            crmMessage.warning('项目名称不能为空');
            return;
        }

        setEditSaving(true);
        try {
            await updateProject(editTarget.projectId, {
                project_name: nextName,
                description: editProjectDesc,
                ...(editGroupId !== (editTarget.groupId || '') ? { group_id: editGroupId || null } : {}),
            });
            setProjects(prev => prev.map(project =>
                project.projectId === editTarget.projectId
                    ? { ...project, projectName: nextName, description: editProjectDesc, groupId: editGroupId || null, updatedAt: Date.now() }
                    : project
            ));
            resetEditProject();
            void refreshGroupsAndProjects();
            crmMessage.success('项目信息已保存');
        } catch (error) {
            console.error('保存项目信息失败:', error);
            crmMessage.error('保存项目信息失败，请检查权限或网络');
        } finally {
            setEditSaving(false);
        }
    }, [editProjectDesc, editProjectName, editTarget, editGroupId, resetEditProject, refreshGroupsAndProjects]);

    const handleAddEditMember = useCallback(async () => {
        if (!editTarget) return;
        const identities = newMemberIdentity
            .split(/[\s,，;；]+/)
            .map(value => value.trim())
            .filter(Boolean);
        if (!identities.length) {
            crmMessage.warning('请输入要添加的用户名或用户 ID');
            return;
        }

        setMemberBusyId('__add__');
        try {
            for (const identity of identities) {
                await addProjectMember(editTarget.projectId, identity, newMemberRole, 'all');
            }
            setNewMemberIdentity('');
            const nextMembers = await loadEditMembers(editTarget.projectId);
            refreshProjectMemberCount(editTarget.projectId, nextMembers.length);
            crmMessage.success('成员已添加');
        } catch (error) {
            console.error('添加项目成员失败:', error);
            crmMessage.error('添加成员失败，请确认用户存在且你有管理权限');
        } finally {
            setMemberBusyId(null);
        }
    }, [editTarget, loadEditMembers, newMemberIdentity, newMemberRole, refreshProjectMemberCount]);

    const handleRemoveEditMember = useCallback(async (member: ProjectMemberRow) => {
        if (!editTarget || !member.user_id) return;
        const label = member.username || member.user_id;
        if (!await crmConfirm({
            title: '移除项目成员',
            message: `确定将「${label}」移出项目？不会删除该成员已创建的内容。`,
            type: 'danger',
            confirmText: '移除',
        })) return;

        setMemberBusyId(member.user_id);
        try {
            await removeProjectMember(editTarget.projectId, member.user_id);
            const nextMembers = editMembers.filter(item => item.user_id !== member.user_id);
            setEditMembers(nextMembers);
            refreshProjectMemberCount(editTarget.projectId, nextMembers.length);
            crmMessage.success('成员已移除');
        } catch (error) {
            console.error('移除项目成员失败:', error);
            crmMessage.error('移除成员失败，owner 不能被移除');
        } finally {
            setMemberBusyId(null);
        }
    }, [editMembers, editTarget, refreshProjectMemberCount]);

    const handleUpdateEditMember = useCallback(async (
        member: ProjectMemberRow,
        patch: Partial<Pick<ProjectMemberRow, 'role' | 'responsibility'>>,
    ) => {
        if (!editTarget || !member.user_id) return;
        const nextMember = { ...member, ...patch };
        setEditMembers(prev => prev.map(item => item.user_id === member.user_id ? nextMember : item));
        setMemberBusyId(member.user_id);
        try {
            await updateProjectMember(editTarget.projectId, member.user_id, patch);
            crmMessage.success('成员信息已更新');
        } catch (error) {
            console.error('更新项目成员失败:', error);
            setEditMembers(prev => prev.map(item => item.user_id === member.user_id ? member : item));
            crmMessage.error('更新成员失败，请检查权限');
        } finally {
            setMemberBusyId(null);
        }
    }, [editTarget]);

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        const now = Date.now();
        const diff = now - ts;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`;
        return d.toLocaleDateString('zh-CN');
    };


    const projectGridClass = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5';
    const pageTitle = activeTab === 'archived' ? '已归档' : '全部项目';
    const stablePageCount = activeTab === 'archived' ? archivedProjectCount : activeProjectCount;
    const coverImageSrc = useCallback((url: string) => {
        if (!url) return '';
        if (/^https?:\/\//i.test(url) && !url.startsWith(window.location.origin)) return url;
        return secureApiUrl(url, { absolute: url.startsWith('/') });
    }, []);

    return (
        <div className="layout-safe flex min-h-screen bg-n20 text-n800" onClick={() => setContextMenu(null)}>
            <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="选择项目封面图片"
                onChange={handleCoverFileChange}
            />

            <AppSidebar className="sticky top-0 hidden h-screen lg:flex" />
            <div className="min-h-screen w-full min-w-0 max-w-none bg-n0 md:border-x md:border-n40">
                <header className="animate-slideDown">
                    <div className="flex min-h-[72px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
                        <div className="flex min-w-0 items-center gap-4">
                            <button
                                type="button"
                                onClick={() => navigate('/projects')}
                                className="flex shrink-0 items-center gap-2 rounded focus:outline-none focus:ring-2 focus:ring-primary/25"
                                title="创剧 · AI 视频创作平台"
                            >
                                <BrandLogo className="h-8 w-auto max-w-[170px]" alt="创剧 · AI 视频创作平台" />
                            </button>
                            <div className="h-8 w-px shrink-0 bg-n40" />
                            <div className="min-w-0">
                                <h1 className="truncate text-xl font-bold tracking-tight text-n800 sm:text-2xl">项目</h1>
                                <p className="mt-0.5 text-xs text-n100 lg:hidden">{stablePageCount} 个项目</p>
                            </div>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap lg:gap-3">
                        <AccountMenu />
                        </div>
                    </div>
                    <div className="flex flex-col gap-3 border-y border-n40 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:py-0 lg:px-8">
                        <div className="ui-tabs">
                            <button
                                type="button"
                                onClick={() => setActiveTab('all')}
                                className="ui-tab"
                                aria-pressed={activeTab === 'all'}
                            >
                                全部项目
                                <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full border border-b75 bg-b50 px-1.5 py-0.5 text-[11px] text-primary">
                                    {activeProjectCount}
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('archived')}
                                className="ui-tab"
                                aria-pressed={activeTab === 'archived'}
                            >
                                已归档
                                <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full border border-b75 bg-b50 px-1.5 py-0.5 text-[11px] text-primary">
                                    {archivedProjectCount}
                                </span>
                            </button>
                        </div>
                        <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto md:items-center">
                            <label className="flex shrink-0 items-center gap-2 text-sm">
                                <span className="text-n100">排序</span>
                                <select
                                    value={sortBy}
                                    onChange={e => setSortBy(e.target.value as SortKey)}
                                    className="h-10 rounded-lg border border-n40 bg-n0 px-2 text-sm text-n700 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15"
                                >
                                    <option value="updated">最近更新</option>
                                    <option value="created">创建时间</option>
                                    <option value="name">名称</option>
                                </select>
                            </label>
                            <div className="relative w-full md:w-80">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-n100" />
                                <input
                                    type="search"
                                    placeholder="搜索项目"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="h-10 w-full rounded-lg border border-n40 bg-n0 pl-10 pr-4 text-sm text-n800 outline-none transition-all placeholder:text-n100 focus:border-primary focus:ring-2 focus:ring-primary/15"
                                />
                            </div>
                        </div>
                    </div>
                </header>

                <main className="px-4 py-7 sm:px-6 lg:px-8">
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <h2 className="text-xl font-bold tracking-tight text-n800">{pageTitle}</h2>
                            <p className="mt-1 text-xs text-n100">共 {filteredProjects.length} 个项目</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setNewGroupId(groups.some(group => group.group_id === groupFilter) ? groupFilter : ''); setShowCreateModal(true); }}
                            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-card transition-all hover:bg-primary-hover hover:shadow-atlas sm:w-auto sm:min-w-[128px]"
                        >
                            <Plus size={17} /> 新建项目
                        </button>
                    </div>

                    <section aria-label="项目分组筛选" className="mb-5 rounded-lg border border-n40 bg-n0 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-xs text-n200">项目分组 → 项目 · 先选择分组，再进入项目</p>
                            <button type="button" onClick={() => setGroupManagerOpen(true)} className="shrink-0 text-sm text-primary">管理分组</button>
                        </div>
                        <div className="ui-tabs ui-tabs--compact">
                            {[{ id: 'all', name: '全部分组' }, { id: 'ungrouped', name: '未分组' }, ...visibleGroups].map(group => (
                                <button key={group.id} type="button" aria-pressed={groupFilter === group.id} onClick={() => setGroupFilter(group.id)}
                                    className="ui-tab">{group.name}</button>
                            ))}
                        </div>
                        {groupsError && <button type="button" className="mt-2 text-xs text-danger" onClick={() => { void loadGroups(); }}>{groupsError}</button>}
                    </section>

                    {loading ? (
                        <div className={projectGridClass}>
                            {[1, 2, 3, 4].map(i => (
                                <div key={i} className="aspect-[4/3] animate-pulse rounded-lg border border-n40 bg-n20" />
                            ))}
                        </div>
                    ) : filteredProjects.length === 0 ? (
                        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-n40 bg-n10 px-6 text-center text-n100">
                            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-light text-primary">
                                <FolderOpen className="h-7 w-7" />
                            </div>
                            <p className="mb-1 text-base font-medium text-n700">
                                {searchQuery ? '未找到匹配的项目' : groupFilter === 'all' ? '还没有项目' : '当前分组下暂无项目'}
                            </p>
                            <p className="text-sm">
                                {searchQuery ? '尝试其他搜索词' : groupFilter === 'all' ? '点击「新建项目」开始创作' : '可新建项目，或在「全部分组」中编辑已有项目、调整所属分组'}
                            </p>
                        </div>
                    ) : (
                        <div className={projectGridClass}>
                            {activeTab === 'all' && !searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => navigate('/create')}
                                    className="flex min-h-[230px] flex-col items-center justify-center gap-3 rounded-[15px] border-2 border-dashed border-n60 bg-transparent text-n100 transition-colors hover:border-b300 hover:bg-b50/40 hover:text-primary"
                                >
                                    <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-primary-light">
                                        <Plus className="h-6 w-6 text-primary" />
                                    </span>
                                    <span className="text-sm font-semibold">一句话开始新故事</span>
                                </button>
                            )}
                            {filteredProjects.map(p => (
                                <article
                                    key={p.projectId}
                                    className={`group relative cursor-pointer overflow-hidden rounded-lg border border-n40 bg-n0 shadow-card transition-all hover:-translate-y-0.5 hover:border-n70 hover:shadow-atlas ${p.isArchived ? 'opacity-65' : ''}`}
                                    onClick={() => navigate(`/projects/${p.projectId}`)}
                                >
                                    <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-n30 via-primary-light to-b75">
                                        {p.coverUrl ? (
                                            <img src={coverImageSrc(p.coverUrl)} alt={`${p.projectName} 封面`} className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.02]" />
                                        ) : (
                                            <div className="flex h-full items-center justify-center">
                                                <BrandLogo variant="mark" className="h-20 w-20 opacity-[0.12]" alt="" />
                                            </div>
                                        )}
                                        {uploadingCoverProjectId === p.projectId && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-n800/45 text-sm font-medium text-white">
                                                封面上传中...
                                            </div>
                                        )}
                                        {p.isArchived && (
                                            <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded bg-n800/80 px-2 py-1 text-[11px] font-medium text-white">
                                                <Archive className="h-3 w-3" /> 已归档
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            aria-label={`${p.projectName} 更多操作`}
                                            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-n40 bg-n0 text-n300 shadow-card transition-colors hover:text-n800"
                                            onClick={e => {
                                                e.stopPropagation();
                                                setContextMenu({ projectId: p.projectId, x: e.clientX, y: e.clientY, isArchived: p.isArchived });
                                            }}
                                        >
                                            <MoreVertical className="h-4 w-4" />
                                        </button>
                                    </div>

                                    <div className="p-4">
                                        <div className="mb-2 flex min-w-0 items-center gap-1.5">
                                            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-n800">{p.projectName}</h3>
                                            {(p.episodeCount ?? 0) > 0 ? (
                                                <span className="shrink-0 rounded bg-g50 px-1.5 py-0.5 text-[10px] font-semibold text-g400">{p.episodeCount} 集</span>
                                            ) : (
                                                <span className="shrink-0 rounded bg-n30 px-1.5 py-0.5 text-[10px] text-n200">空项目</span>
                                            )}
                                            <span className="max-w-[160px] truncate rounded bg-n20 px-1.5 py-0.5 text-[10px] text-n200" title={groupNameFor(p)}>分组：{groupNameFor(p)}</span>
                                            {p.visibility && p.visibility !== 'private' && (
                                                <span className="shrink-0 rounded bg-b50 px-1.5 py-0.5 text-[10px] text-b400">组织</span>
                                            )}
                                        </div>
                                        <p className="mb-3 min-h-4 truncate text-xs text-n200">{p.description || '暂无项目描述'}</p>
                                        {p.tags.length > 0 && (
                                            <div className="mb-3 flex flex-wrap gap-1">
                                                {p.tags.slice(0, 3).map(t => (
                                                    <span key={t} className="rounded bg-n20 px-1.5 py-0.5 text-[10px] text-n300">{t}</span>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between gap-3 border-t border-n30 pt-3 text-xs text-n100">
                                            <span className="flex min-w-0 items-center gap-1">
                                                <Users className="h-3 w-3 shrink-0" /> {p.memberCount} 位成员
                                            </span>
                                            <span className="flex shrink-0 items-center gap-1">
                                                <Clock className="h-3 w-3" /> {formatTime(p.updatedAt)}
                                            </span>
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    )}
                </main>
            </div>


            {contextMenu && (
                <div
                    className="fixed z-50 bg-n0 border border-n40 rounded-md shadow-bottom py-1 min-w-[152px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={e => e.stopPropagation()}
                >
                    <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-n20 flex items-center gap-2 text-n700"
                        onClick={() => {
                            const proj = projects.find(p => p.projectId === contextMenu.projectId);
                            if (proj) openEditProject(proj);
                        }}
                    >
                        <Pencil className="w-4 h-4" /> 编辑项目
                    </button>
                    <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-n20 flex items-center gap-2 text-n700 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => openCoverUpload(contextMenu.projectId)}
                        disabled={uploadingCoverProjectId === contextMenu.projectId}
                    >
                        <Upload className="w-4 h-4" /> 上传封面
                    </button>
                    {contextMenu.isArchived ? (
                    <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-n20 flex items-center gap-2 text-success"
                        onClick={() => handleUnarchive(contextMenu.projectId)}
                    >
                        <Archive className="w-4 h-4" /> 取消归档
                    </button>
                    ) : (
                    <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-n20 flex items-center gap-2 text-n700"
                        onClick={() => handleArchive(contextMenu.projectId)}
                    >
                        <Archive className="w-4 h-4" /> 归档
                    </button>
                    )}
                    <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-n20 flex items-center gap-2 text-primary"
                        onClick={() => {
                            const proj = projects.find(p => p.projectId === contextMenu.projectId);
                            if (proj) setShareTarget(proj);
                            setContextMenu(null);
                        }}
                    >
                        <Share2 className="w-4 h-4" /> 共享…
                    </button>
                    <button
                        type="button"
                        className="w-full px-4 py-2 text-left text-sm hover:bg-r50 flex items-center gap-2 text-danger"
                        onClick={() => handleDelete(contextMenu.projectId)}
                    >
                        <Trash2 className="w-4 h-4" /> 删除
                    </button>
                </div>
            )}

            {shareTarget && (
                <ShareResourceDialog
                    resourceType="project"
                    resourceId={shareTarget.projectId}
                    resourceName={shareTarget.projectName}
                    onClose={() => setShareTarget(null)}
                    onChange={() => { loadProjects(); }}
                />
            )}


            {editTarget && (
                <div
                    className="app-modal-backdrop fixed inset-0 flex items-center justify-center z-50 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="edit-project-title"
                >
                    <div className="app-modal-surface w-full max-w-4xl overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="app-modal-header">
                            <div>
                                <h2 id="edit-project-title" className="text-lg font-semibold text-n800">编辑项目</h2>
                                <p className="mt-1 text-xs text-n100">修改项目基础信息、成员角色和协作范围。</p>
                            </div>
                        </div>
                        <div className="app-modal-body grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
                            <section className="space-y-4">
                                <div>
                                    <label className="block text-sm text-n300 mb-1">项目名称</label>
                                    <input
                                        type="text"
                                        value={editProjectName}
                                        onChange={e => setEditProjectName(e.target.value)}
                                        placeholder="输入项目名称"
                                        className="w-full px-3 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm text-n300 mb-1">项目描述</label>
                                    <textarea
                                        value={editProjectDesc}
                                        onChange={e => setEditProjectDesc(e.target.value)}
                                        placeholder="补充项目介绍、风格或制作说明"
                                        rows={6}
                                        className="w-full px-3 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none transition-colors"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <ProjectGroupSelect groups={groups} value={editGroupId} onChange={setEditGroupId} currentName={editTarget.groupName}
                                        disabled={editTarget.memberRole !== 'owner' || editSaving || !!groupsError} />
                                    <p className="text-xs text-n200">只有项目所有者可调整归属。分组与项目名称独立；共享分组的既有访问规则仍会生效。</p>
                                    {editTarget.memberRole === 'owner' && <button type="button" className="text-xs text-primary" onClick={() => setGroupManagerOpen(true)}>新建或重命名分组</button>}
                                </div>
                                <div className="rounded-lg border border-n40 bg-n10 p-3 text-xs text-n200">
                                    封面可从项目卡片右上角菜单的「上传封面」单独更新；上传时会自动裁剪压缩为 16:9 小封面，不会拉伸变形。
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handleSaveProjectEdit}
                                        disabled={editSaving}
                                        className="inline-flex h-10 min-w-[112px] items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white shadow-card transition-all hover:bg-primary-hover hover:shadow-atlas disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {editSaving ? '保存中...' : '保存信息'}
                                    </button>
                                </div>
                            </section>

                            <section className="rounded-lg border border-n40 bg-n0">
                                <div className="flex items-center justify-between border-b border-n40 px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <Users className="h-4 w-4 text-primary" />
                                        <span className="text-sm font-semibold text-n800">项目成员</span>
                                    </div>
                                    <span className="rounded-full border border-b75 bg-b50 px-2 py-0.5 text-xs text-primary">{editMembers.length}</span>
                                </div>
                                <div className="space-y-3 p-4">
                                    <div className="rounded-lg border border-n40 bg-n10 p-3">
                                        <label className="mb-2 block text-xs font-medium text-n300">添加成员（用户名或用户 ID，可多个）</label>
                                        <div className="space-y-2">
                                            <textarea
                                                value={newMemberIdentity}
                                                onChange={e => setNewMemberIdentity(e.target.value)}
                                                placeholder="例如 admin 或 user_xxx，可换行输入多个成员"
                                                rows={3}
                                                className="min-h-[88px] w-full resize-y rounded border border-n40 bg-n0 px-3 py-2 text-sm leading-5 text-n800 outline-none transition-colors placeholder:text-n100 focus:border-primary focus:ring-2 focus:ring-primary/20"
                                            />
                                            <p className="text-[11px] leading-4 text-n100">支持使用换行、空格、逗号或分号分隔多个成员。</p>
                                            <div className="flex gap-2">
                                                <select
                                                    value={newMemberRole}
                                                    onChange={e => setNewMemberRole(e.target.value)}
                                                    className="h-9 flex-1 rounded border border-n40 bg-n0 px-2 text-xs text-n700 outline-none transition-colors focus:border-primary"
                                                >
                                                    <option value="member">成员·member</option>
                                                    <option value="admin">管理·admin</option>
                                                    <option value="readonly">只读·readonly</option>
                                                </select>
                                                <button
                                                    type="button"
                                                    onClick={handleAddEditMember}
                                                    disabled={memberBusyId === '__add__'}
                                                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded bg-primary px-3 text-xs font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    <UserPlus className="h-3.5 w-3.5" />
                                                    添加
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
                                        {editMembersLoading ? (
                                            <div className="rounded border border-dashed border-n40 py-8 text-center text-xs text-n100">加载成员...</div>
                                        ) : editMembers.length === 0 ? (
                                            <div className="rounded border border-dashed border-n40 py-8 text-center text-xs text-n100">暂无成员</div>
                                        ) : editMembers.map(member => {
                                            const memberLabel = member.username || member.user_id;
                                            const isOwner = member.role === 'owner';
                                            const busy = memberBusyId === member.user_id;
                                            return (
                                                <div key={member.user_id} className="rounded-lg border border-n40 bg-n0 p-3">
                                                    <div className="mb-2 flex items-start justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-medium text-n800">{memberLabel}</div>
                                                            <div className="truncate text-[11px] text-n100">{member.user_id}</div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRemoveEditMember(member)}
                                                            disabled={isOwner || busy}
                                                            className="shrink-0 rounded border border-r75 bg-r50 px-2 py-1 text-[11px] text-danger transition-colors hover:bg-r50 disabled:cursor-not-allowed disabled:opacity-40"
                                                            title={isOwner ? 'owner 不能移除' : '移除成员'}
                                                        >
                                                            移除
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <label className="block">
                                                            <span className="mb-1 block text-[11px] text-n100">角色</span>
                                                            <select
                                                                value={member.role || 'member'}
                                                                onChange={e => handleUpdateEditMember(member, { role: e.target.value })}
                                                                disabled={isOwner || busy}
                                                                onMouseDown={e => {
                                                                    if (isOwner) e.preventDefault();
                                                                }}
                                                                className="h-8 w-full rounded border border-n40 bg-n0 px-2 text-xs text-n700 outline-none focus:border-primary disabled:opacity-50"
                                                            >
                                                                <option value="owner" disabled>owner</option>
                                                                <option value="admin">管理·admin</option>
                                                                <option value="member">成员·member</option>
                                                                <option value="readonly">只读·readonly</option>
                                                            </select>
                                                        </label>
                                                        <label className="block">
                                                            <span className="mb-1 block text-[11px] text-n100">职责</span>
                                                            <input
                                                                type="text"
                                                                value={member.responsibility || ''}
                                                                onFocus={() => {
                                                                    memberResponsibilityBaselineRef.current[member.user_id] = member.responsibility?.trim() || 'all';
                                                                }}
                                                                onChange={e => {
                                                                    const next = e.target.value;
                                                                    setEditMembers(prev => prev.map(item =>
                                                                        item.user_id === member.user_id
                                                                            ? { ...item, responsibility: next }
                                                                            : item
                                                                    ));
                                                                }}
                                                                onBlur={e => {
                                                                    const next = e.target.value.trim() || 'all';
                                                                    const previous = memberResponsibilityBaselineRef.current[member.user_id]
                                                                        ?? member.responsibility?.trim()
                                                                        ?? 'all';
                                                                    delete memberResponsibilityBaselineRef.current[member.user_id];
                                                                    if (next === previous) return;
                                                                    void handleUpdateEditMember(
                                                                        { ...member, responsibility: previous },
                                                                        { responsibility: next },
                                                                    );
                                                                }}
                                                                disabled={busy}
                                                                placeholder="all / script / art"
                                                                className="h-8 w-full rounded border border-n40 bg-n0 px-2 text-xs text-n700 outline-none placeholder:text-n100 focus:border-primary disabled:opacity-50"
                                                            />
                                                        </label>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </section>
                        </div>
                        <div className="app-modal-footer">
                            <button
                                type="button"
                                onClick={closeEditProject}
                                disabled={editSaving || !!memberBusyId}
                                className="px-4 py-2 text-sm text-n300 hover:text-n800 hover:bg-n20 rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {showCreateModal && (
                <div
                    className="app-modal-backdrop fixed inset-0 flex items-center justify-center z-50 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="create-project-title"
                    onClick={() => setShowCreateModal(false)}
                >
                    <div className="app-modal-surface w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="app-modal-header">
                            <h2 id="create-project-title" className="text-lg font-semibold text-n800">新建项目</h2>
                        </div>
                        <div className="app-modal-body space-y-4">
                            <div>
                                <label className="block text-sm text-n300 mb-1">项目名称</label>
                                <input
                                    type="text"
                                    value={newProjectName}
                                    onChange={e => setNewProjectName(e.target.value)}
                                    placeholder="输入项目名称"
                                    className="w-full px-3 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                                    autoFocus
                                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                                />
                            </div>
                            <div>
                                <ProjectGroupSelect groups={groups} value={newGroupId} onChange={setNewGroupId} disabled={!!groupsError} />
                                <button type="button" className="mt-2 text-xs text-primary" onClick={() => setGroupManagerOpen(true)}>新建或重命名分组</button>
                            </div>
                            <div>
                                <label className="block text-sm text-n300 mb-1">项目描述（可选）</label>
                                <textarea
                                    value={newProjectDesc}
                                    onChange={e => setNewProjectDesc(e.target.value)}
                                    placeholder="简要描述项目内容"
                                    rows={3}
                                    className="w-full px-3 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none transition-colors"
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-n300 mb-1">项目成员（可选）</label>
                                <textarea
                                    value={newProjectMembers}
                                    onChange={e => setNewProjectMembers(e.target.value)}
                                    placeholder="输入平台用户名，多个成员用逗号或换行分隔"
                                    rows={2}
                                    className="w-full px-3 py-2 bg-n0 border border-n40 rounded text-sm text-n800 placeholder:text-n100 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none transition-colors"
                                />
                                <p className="mt-1 text-xs text-n100">成员将获得项目访问权限；移除成员不会删除其已创建的内容。</p>
                            </div>

                            <div>
                                <label className="block text-sm text-n300 mb-1.5">可见性</label>
                                <div className="space-y-1.5">
                                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                                        <input
                                            type="radio"
                                            checked={newProjectVisibility === 'private'}
                                            onChange={() => setNewProjectVisibility('private')}
                                            className="accent-primary"
                                        />
                                        <span className="text-n700">🔒 私有</span>
                                        <span className="text-xs text-n100">— 仅我可见</span>
                                    </label>
                                    <label className={`flex items-center gap-2 text-sm cursor-pointer ${!isOrgWorkspace ? 'opacity-50' : ''}`}>
                                        <input
                                            type="radio"
                                            checked={newProjectVisibility === 'org-default'}
                                            onChange={() => setNewProjectVisibility('org-default')}
                                            disabled={!isOrgWorkspace}
                                            className="accent-primary"
                                        />
                                        <span className="text-n700">🌐 对组织可见</span>
                                        <span className="text-xs text-n100">
                                            {isOrgWorkspace ? `— 自动共享给「${currentName}」` : '— 切到组织空间后可用，与项目分组无关'}
                                        </span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="app-modal-footer">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="px-4 py-2 text-sm text-n300 hover:text-n800 hover:bg-n20 rounded transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!newProjectName.trim()}
                                className="px-4 py-2 bg-primary hover:bg-primary-hover text-white disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium transition-colors"
                            >
                                创建
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {groupManagerOpen && <ProjectGroupManager groups={groups} onChanged={refreshGroupsAndProjects}
                onDeleted={groupId => {
                    if (groupFilter === groupId) setGroupFilter('ungrouped');
                    if (editGroupId === groupId) setEditGroupId('');
                    if (newGroupId === groupId) setNewGroupId('');
                }} onClose={() => setGroupManagerOpen(false)} />}
        </div>
    );
};

export default ProjectHub;
