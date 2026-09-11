

import { describe, it, expect } from 'vitest';
import {
    mapNotificationToTask,
    mapNotificationsToTasks,
    mapRuntimeNotificationToTask,
    type ServerNotificationRow,
} from '../../services/notificationMapping';

function row(overrides: Partial<ServerNotificationRow> = {}): ServerNotificationRow {
    return {
        notification_id: 'notif_abc',
        user_id: 'u1',
        task_id: 'task_001',
        type: 'task',
        category: 'video',
        title: '视频生成 镜头1 已完成',
        message: '任务 task_001 执行成功',
        status: 'unread',
        target_view: 'Video',
        target_project_id: 'p1',
        target_page: 'video',
        target_item_id: 'item_5',
        metadata: {},
        created_at: '2026-05-20T10:00:00Z',
        read_at: null,
        ...overrides,
    };
}

describe('notificationMapping', () => {
    describe('mapNotificationToTask', () => {
        it('maps a completed notification to RegisteredTask with status=completed', () => {
            const t = mapNotificationToTask(row());
            expect(t).not.toBeNull();
            expect(t!.taskId).toBe('task_001');
            expect(t!.notificationId).toBe('notif_abc');
            expect(t!.status).toBe('completed');
            expect(t!.targetPage).toBe('video');
            expect(t!.targetProjectId).toBe('p1');
            expect(t!.targetItemId).toBe('item_5');
            expect(t!.progress).toBe(1);
            expect(t!.error).toBeUndefined();
        });

        it('strips "已完成" suffix from title', () => {
            const t = mapNotificationToTask(row({ title: 'Seedance 视频生成 已完成' }));
            expect(t!.title).toBe('Seedance 2.0 · 多模态标准视频模型 视频生成');
        });

        it('translates legacy provider titles to current public model labels', () => {
            expect(mapNotificationToTask(row({
                category: 'text',
                title: 'DeepSeek 文本生成 已完成',
            }))!.title).toBe('deepseek-v4-flash · 快速写作模型');
            expect(mapNotificationToTask(row({
                category: 'image',
                title: '豆包图像生成 已完成',
            }))!.title).toBe('Doubao-Seedream-5.0-lite · 参考图生图模型');
        });

        it('strips "失败" suffix and sets status=failed + error', () => {
            const t = mapNotificationToTask(row({
                title: '视频生成 失败',
                message: '任务 xxx 执行失败: timeout',
            }));
            expect(t!.title).toBe('视频生成');
            expect(t!.status).toBe('failed');
            expect(t!.error).toContain('执行失败');
            expect(t!.progress).toBeUndefined();
        });

        it('falls back to notification_id when task_id is null', () => {
            const t = mapNotificationToTask(row({ task_id: null, notification_id: 'notif_xyz' }));
            expect(t!.taskId).toBe('notif_xyz');
        });

        it('returns null for invalid input (no title)', () => {
            const t = mapNotificationToTask({ ...row(), title: '' });
            expect(t).toBeNull();
        });

        it('normalizes invalid target_page to "global"', () => {
            const t = mapNotificationToTask(row({ target_page: 'unknown_page' }));
            expect(t!.targetPage).toBe('global');
        });

        it('infers kind=seedance from "Seedance" in title', () => {
            const t = mapNotificationToTask(row({ category: 'video', title: 'Seedance 镜头1 已完成' }));
            expect(t!.kind).toBe('seedance');
        });

        it('infers kind=video-upscale from "放大" in title', () => {
            const t = mapNotificationToTask(row({ category: 'video', title: '视频放大 已完成' }));
            expect(t!.kind).toBe('video-upscale');
        });


        it('infers kind=kling from "Kling" in title', () => {
            const t = mapNotificationToTask(row({ category: 'video', title: '视频 · Kling · 镜头1 已完成' }));
            expect(t!.kind).toBe('kling');
        });

        it('infers kind=vidu from "Vidu" in title', () => {
            const t = mapNotificationToTask(row({ category: 'video', title: '视频 · Vidu · 镜头1 已完成' }));
            expect(t!.kind).toBe('vidu');
        });

        it('infers kind=happyhorse from "HappyHorse" in title', () => {
            const t = mapNotificationToTask(row({ category: 'video', title: '视频 · HappyHorse · 镜头1 已完成' }));
            expect(t!.kind).toBe('happyhorse');
        });

        it('infers kind=happyhorse from spaced "happy horse" variant', () => {
            const t = mapNotificationToTask(row({ category: 'video', title: '视频 · happy horse · 镜头2 已完成' }));
            expect(t!.kind).toBe('happyhorse');
        });

        it('infers kind=matting from category=material', () => {
            const t = mapNotificationToTask(row({ category: 'material', title: '抠图任务 已完成' }));
            expect(t!.kind).toBe('matting');
        });

        it('infers kind=qwen-image from "Qwen" in title', () => {
            const t = mapNotificationToTask(row({ category: 'image', title: 'Qwen 图像生成 已完成' }));
            expect(t!.kind).toBe('qwen-image');
        });

        it('classifies the legacy generic Gemini title without calling it a node image', () => {
            const t = mapNotificationToTask(row({
                category: 'image',
                title: 'AI 生图任务 已完成',
            }));
            expect(t!.kind).toBe('gemini-image');
        });

        it('uses persisted task metadata to restore image kind and shot navigation context', () => {
            const t = mapNotificationToTask(row({
                category: 'image',
                title: '图片任务 已完成',
                target_project_id: null,
                target_page: null,
                target_item_id: null,
                metadata: {
                    task_type: 'gemini_image',
                    provider: 'gemini',
                    model: 'gemini-3.1-flash-image-preview',
                    project_id: 'proj_meta',
                    episode_id: 'ep_meta',
                    source_page: 'design',
                    source_item_id: 'shot_meta',
                    entity_type: 'storyboard_item',
                    entity_id: 'shot_meta',
                    file_role: 'generated_image',
                },
            }));
            expect(t).toMatchObject({
                kind: 'gemini-image',
                targetProjectId: 'proj_meta',
                episodeId: 'ep_meta',
                targetPage: 'generation',
                targetItemId: 'shot_meta',
                targetEntityType: 'storyboard_item',
                targetEntityId: 'shot_meta',
                fileRole: 'generated_image',
                metadata: expect.objectContaining({
                    provider: 'gemini',
                    model: 'gemini-3.1-flash-image-preview',
                }),
            });
        });

        it('does not assume an unknown generic image task used a node', () => {
            const t = mapNotificationToTask(row({ category: 'image', title: '图片任务 已完成' }));
            expect(t!.kind).toBe('other');
        });

        it('infers kind=auto-storyboard from category=text + "分镜"', () => {
            const t = mapNotificationToTask(row({ category: 'text', title: '自动分镜 已完成' }));
            expect(t!.kind).toBe('auto-storyboard');
        });

        it('parses created_at to unix ms for createdAt/completedAt', () => {
            const t = mapNotificationToTask(row({ created_at: '2026-05-20T10:00:00Z' }));
            expect(t!.createdAt).toBe(Date.UTC(2026, 4, 20, 10, 0, 0));
            expect(t!.completedAt).toBe(t!.createdAt);
        });

        it('falls back to Date.now() for invalid created_at', () => {
            const before = Date.now();
            const t = mapNotificationToTask(row({ created_at: 'not-a-date' }));
            const after = Date.now();
            expect(t!.createdAt).toBeGreaterThanOrEqual(before);
            expect(t!.createdAt).toBeLessThanOrEqual(after);
        });
    });

    describe('mapRuntimeNotificationToTask', () => {
        it('adds an unregistered terminal task to the notification list', () => {
            const t = mapRuntimeNotificationToTask({
                id: 'task_new',
                taskId: 'task_new',
                type: 'text',
                status: 'completed',
                message: 'DeepSeek 剧本分镜 已完成',
                targetView: 'Editor' as any,
                targetPage: 'script',
                targetProjectId: 'proj_1',
                timestamp: Date.UTC(2026, 6, 22, 8, 0, 0),
            });

            expect(t).toMatchObject({
                taskId: 'task_new',
                title: 'deepseek-v4-flash · 快速写作模型 剧本分镜',
                kind: 'auto-storyboard',
                status: 'completed',
                targetPage: 'script',
                targetProjectId: 'proj_1',
            });
            expect(t!.completedAt).toBe(Date.UTC(2026, 6, 22, 8, 0, 0));
        });

        it('keeps a distinct persistent notification id when available', () => {
            const t = mapRuntimeNotificationToTask({
                id: 'notif_new',
                taskId: 'task_new',
                type: 'video',
                status: 'failed',
                message: '视频生成失败',
                targetView: 'Video' as any,
                timestamp: Date.now(),
            });

            expect(t!.notificationId).toBe('notif_new');
            expect(t!.taskId).toBe('task_new');
            expect(t!.status).toBe('failed');
        });

        it('uses the runtime task type and id to identify Gemini image tasks', () => {
            const t = mapRuntimeNotificationToTask({
                id: 'gemini_img_42',
                taskId: 'gemini_img_42',
                taskType: 'gemini_image',
                type: 'image',
                status: 'completed',
                message: 'AI 生图任务 已完成',
                targetView: 'Video' as any,
                targetPage: 'generation',
                targetProjectId: 'proj_1',
                targetItemId: 'shot_06',
                episodeId: 'ep_1',
                provider: 'gemini',
                modelName: 'nanobanana',
                timestamp: Date.now(),
            });
            expect(t).toMatchObject({
                kind: 'gemini-image',
                targetItemId: 'shot_06',
                episodeId: 'ep_1',
                metadata: {
                    provider: 'gemini',
                    modelName: 'nanobanana',
                },
            });
        });
    });

    describe('metadata pass-through (Phase 8)', () => {
        it('passes through valid metadata object', () => {
            const t = mapNotificationToTask(row({
                metadata: { stage: '已完成', workerNodeId: 'gpu-1', step: 50 },
            }));
            expect(t!.metadata).toEqual({ stage: '已完成', workerNodeId: 'gpu-1', step: 50 });
        });

        it('returns undefined metadata when raw is null', () => {
            const t = mapNotificationToTask(row({ metadata: null as any }));
            expect(t!.metadata).toBeUndefined();
        });

        it('returns undefined metadata when raw is array (invalid shape)', () => {
            const t = mapNotificationToTask(row({ metadata: ['not', 'object'] as any }));
            expect(t!.metadata).toBeUndefined();
        });

        it('returns undefined metadata when field missing entirely', () => {
            const r = row();
            delete (r as any).metadata;
            const t = mapNotificationToTask(r);
            expect(t!.metadata).toBeUndefined();
        });
    });

    describe('mapNotificationsToTasks', () => {
        it('maps batch and filters out dismissed', () => {
            const tasks = mapNotificationsToTasks([
                row({ task_id: 'a', status: 'unread' }),
                row({ task_id: 'b', status: 'read' }),
                row({ task_id: 'c', status: 'dismissed' }),
            ]);
            expect(tasks.map(t => t.taskId)).toEqual(['a', 'b']);
        });

        it('drops invalid rows but keeps valid ones', () => {
            const tasks = mapNotificationsToTasks([
                { ...row({ task_id: 'a' }), title: '' },     // invalid → drop
                row({ task_id: 'b' }),                        // valid → keep
            ]);
            expect(tasks.map(t => t.taskId)).toEqual(['b']);
        });

        it('returns empty array for empty input', () => {
            expect(mapNotificationsToTasks([])).toEqual([]);
        });
    });
});
