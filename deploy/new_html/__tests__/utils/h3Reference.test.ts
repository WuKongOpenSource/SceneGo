import { describe, expect, it } from 'vitest';
import { h3Composer, h3ReferenceSubmission, isH3Reference } from '../../utils/h3Reference';
import { removeMediaInput } from '../../utils/seedanceMedia';
import { removeVideoCardImage } from '../../utils/videoProjectMaterial';
import type { TaskGroup } from '../../services/videoTaskTypes';

const original = { id: 'one', fileId: 'file-one', url: '/thumbnail/one.webp', storageUrl: '/api/files/file-one/download', filename: 'one.png', uploadTime: 0 };
describe('H3 ordered image reference contract', () => {
  it('defaults pool originals, never thumbnails, and preserves manual removal after reload', () => {
    const value = h3Composer(undefined, '图片1走路', [original]);
    expect(value.media_inputs[0].url).toBe(original.storageUrl);
    expect(h3ReferenceSubmission(value)).toEqual({ prompt: '<Picture 1>走路', images: ['file-one'] });
    const removed = removeMediaInput(value, 0);
    expect(h3Composer(JSON.parse(JSON.stringify(removed)), 'ignored', [original]).media_inputs).toEqual([]);
  });
  it('renumbers tokens with ordered references, without deleting original files', () => {
    const value = h3Composer({ prompt: '图片1和图片2', media_inputs: [{ kind: 'image', url: '/a.png' }, { kind: 'image', url: '/b.png' }] }, '', []);
    const next = removeMediaInput(value, 0);
    expect(h3ReferenceSubmission(next)).toEqual({ prompt: '和<Picture 1>', images: ['/b.png'] });
    const group: TaskGroup = { uuid: 'g', ids: ['one'], model: 'MiniMaxH3', h3ReferenceMode: 'reference', h3ReferenceContent: h3Composer(undefined, '图片1', [original]) };
    expect(removeVideoCardImage(group, original).h3ReferenceContent?.media_inputs).toEqual([]);
    expect(original.storageUrl).toBe('/api/files/file-one/download');
  });
  it('keeps first-last default and saved reference mode isolated from other models', () => {
    const group: TaskGroup = { uuid: 'g', ids: ['one', 'two'], model: 'MiniMaxH3' };
    expect(isH3Reference(group)).toBe(false);
    expect(isH3Reference({ ...group, h3ReferenceMode: 'reference' })).toBe(true);
    expect(isH3Reference({ ...group, model: 'MiniMaxH3Mini', h3ReferenceMode: 'reference' })).toBe(false);
  });
  it.each(['图片0', '图片2', '<Picture 2>'])('rejects dangling %s', prompt => {
    expect(() => h3ReferenceSubmission({ prompt, media_inputs: [{ kind: 'image', url: '/a.png' }] })).toThrow('不存在');
  });
  it('rejects empty, excessive, non-image, duplicate and temporary inputs', () => {
    for (const media_inputs of [[], Array.from({ length: 10 }, (_, i) => ({ kind: 'image' as const, url: `/${i}.png` })),
      [{ kind: 'video' as const, url: '/v.mp4' }], [{ kind: 'image' as const, url: 'blob:x' }],
      [{ kind: 'image' as const, url: 'asset:x' }], [{ kind: 'image' as const, url: '/a' }, { kind: 'image' as const, url: '/a' }]]) {
      expect(() => h3ReferenceSubmission({ prompt: '', media_inputs })).toThrow();
    }
  });
});
