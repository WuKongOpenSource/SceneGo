import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SeedanceReferenceShelf } from '../../components/SeedanceReferenceShelf';
import { includeVideoCardReferences } from '../../utils/videoProjectMaterial';
import { insertMention, removeMediaInput } from '../../utils/seedanceMedia';
import type { SeedanceParams } from '../../services/videoModelService';

const value: SeedanceParams = { sub_model: 'mini', prompt: '图片1 视频1 图片2 音频1', reference_mode: 'reference', media_inputs: [
  { kind: 'image', url: '/a.png' }, { kind: 'video', url: '/v.mp4' }, { kind: 'image', url: '/b.png' }, { kind: 'audio', url: '/c.mp3' },
] };
const pool = [{ id: 'source', url: '/preview.png', storageUrl: '/original.png', fileId: 'file_original', filename: '画面', uploadTime: 1 }];

describe('unified reference content', () => {
  it('adds originals once, keeps mention numbers, and does not resurrect removed sources after reload', () => {
    const seeded = includeVideoCardReferences(value, pool);
    expect(seeded.media_inputs.slice(0, 4)).toEqual(value.media_inputs);
    expect(seeded.media_inputs[4]).toMatchObject({ url: '/original.png', file_id: 'file_original' });
    expect(seeded.prompt).toBe(value.prompt);
    const removed = removeMediaInput(seeded, 4);
    const reloaded = JSON.parse(JSON.stringify(removed));
    expect(includeVideoCardReferences(reloaded, pool).media_inputs).toEqual(value.media_inputs);
    expect(includeVideoCardReferences(seeded, pool)).toBe(seeded);
    const mentioned = insertMention(seeded, { id: 'same', group: 'assets', kind: 'image', label: 'same', url: '/original.png' });
    expect(mentioned.media_inputs).toHaveLength(5);
    expect(mentioned.prompt).toContain('图片3');
    expect(value.media_inputs).toHaveLength(4);
  });
  it('adds newly uploaded pool images but does not change first/last frame selection', () => {
    const seeded = includeVideoCardReferences(value, pool);
    expect(includeVideoCardReferences(seeded, [...pool, { ...pool[0], id: 'new', storageUrl: '/new.png', fileId: 'file_new' }]).media_inputs).toHaveLength(6);
    const frames = { ...value, reference_mode: 'first_last' as const };
    expect(includeVideoCardReferences(frames, pool)).toBe(frames);
    expect(includeVideoCardReferences({ ...value, sub_model: 'agent_plan' }, pool).media_inputs).toBe(value.media_inputs);
  });
  it('filters without changing kind-specific numbers; removing a reference remaps only its kind', () => {
    const onChange = vi.fn(); const preview = vi.fn();
    render(<SeedanceReferenceShelf value={value} onChange={onChange} addControl={<button>添加</button>} onPreviewMedia={preview} />);
    fireEvent.click(screen.getByRole('tab', { name: '图片 (2)' }));
    expect(screen.queryByTitle('预览视频1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('预览图片2'));
    expect(preview).toHaveBeenCalledWith('/b.png', 'image');
    fireEvent.click(screen.getByLabelText('移除图片1'));
    expect(onChange.mock.calls[0][0].prompt).toBe(' 视频1 图片1 音频1');
    expect(onChange.mock.calls[0][0].media_inputs[1].url).toBe('/b.png');
  });
  it('requires clear confirmation and preserves original files and the pool exclusion keys', () => {
    const onChange = vi.fn(); const seeded = includeVideoCardReferences(value, pool);
    render(<SeedanceReferenceShelf value={seeded} onChange={onChange} addControl={null} />);
    fireEvent.click(screen.getByText('清空参考内容'));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('清空参考内容'));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    const cleared = onChange.mock.calls[0][0];
    expect(cleared.media_inputs).toEqual([]);
    expect(includeVideoCardReferences(cleared, pool).media_inputs).toEqual([]);
    expect(pool[0].storageUrl).toBe('/original.png');
  });
});
