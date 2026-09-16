import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CapabilityVideoPanel } from './CapabilityVideoPanel';
import type { VideoModelCapability } from '../../services/videoWorkflowService';
import type { TaskGroup, UploadedImage } from '../../services/videoTaskTypes';
import type { SeedanceParams } from '../../services/videoModelService';
import { useSeedanceCandidates } from '../../hooks/useSeedanceCandidates';
import { withVideoCardCandidates } from '../../utils/videoProjectMaterial';
import { h3Composer } from '../../utils/h3Reference';
import { insertMention } from '../../utils/seedanceMedia';
import { SeedanceMentionPromptEditor } from '../SeedanceMentionPromptEditor';
import { SeedanceReferenceShelf } from '../SeedanceReferenceShelf';

interface Props {
  group: TaskGroup;
  prompt: string;
  cardImages: UploadedImage[];
  capability?: VideoModelCapability;
  storyboardItemId?: string;
  onPatch: (patch: Partial<TaskGroup>) => void;
  onPromptChange: (prompt: string) => void;
  onPreview: (url: string) => void;
}

export function H3VideoPanel({ group, prompt, cardImages, capability, storyboardItemId, onPatch, onPromptChange, onPreview }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');
  const reference = group.h3ReferenceMode === 'reference';
  const value = useMemo(() => h3Composer(group.h3ReferenceContent, prompt, cardImages), [group.h3ReferenceContent, prompt, cardImages]);
  const { candidates } = useSeedanceCandidates({ currentParams: value, currentStoryboardItemId: storyboardItemId });
  const images = withVideoCardCandidates(cardImages, candidates).filter(item => item.kind === 'image' && item.group !== 'ark_asset_id'
    && item.url && !/^(blob:|data:|asset:)/i.test(item.url));
  const save = (next: SeedanceParams) => {
    if (next.media_inputs.length > 9 && next.media_inputs.length > value.media_inputs.length) { setError('最多支持 9 张参考图片，请先移除多余图片'); return; }
    setError('');
    onPatch({ h3ReferenceContent: { prompt: next.prompt, media_inputs: next.media_inputs, reference_pool_keys: next.reference_pool_keys } });
  };
  useEffect(() => {
    if (reference && JSON.stringify(group.h3ReferenceContent?.reference_pool_keys) !== JSON.stringify(value.reference_pool_keys)) save(value);
  }, [reference, value]);
  const editor = (large: boolean) => <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
    <div className="flex items-center justify-between text-xs text-n300">
      <span>H3 多图参考 · 1–9 张原图，输入 @ 关联图片</span>
      <button type="button" onClick={() => setExpanded(!large)} className="text-primary">{large ? '完成' : '放大编辑'}</button>
    </div>
    <SeedanceReferenceShelf imageOnly value={value} onChange={save} onPreviewMedia={url => onPreview(url)} addControl={
      <select aria-label="添加 H3 参考图片" value="" className="max-w-32 rounded border border-n40 bg-n0 p-2 text-xs" onChange={event => {
        const candidate = images.find(item => item.id === event.target.value);
        if (candidate) save(insertMention(value, candidate));
      }}><option value="">＋ 参考内容</option>{images.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    } />
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {capability?.h3_reference_available !== true && <p role="status" className="text-xs text-warning">多图参考节点尚未就绪，可先编辑保存；生成需要已验证的 Ref2VA 模型和参考节点。</p>}
    <SeedanceMentionPromptEditor value={value} onChange={save} candidates={images} hideTokensRow fillHeight compactFillHeight rows={large ? 14 : 7}
      placeholder="输入 @ 选择参考图片，例如：图片1中的人物走进图片2的场景" onPreviewMedia={url => onPreview(url)} />
  </div>;
  return <>
    <CapabilityVideoPanel capability={capability} value={group.videoParams} prompt={prompt} onPromptChange={onPromptChange}
      onChange={next => onPatch({ videoParams: next, ...(typeof next.duration === 'number' ? { duration: next.duration, durationUserOverride: true } : {}) })}
      modeControl={<label className="text-xs"><select aria-label="H3 参考模式" className="rounded-full border border-n40 bg-n0 px-3 py-2"
        value={group.h3ReferenceMode || 'first_last'} onChange={event => {
          const mode = event.target.value as 'first_last' | 'reference';
          onPatch({ h3ReferenceMode: mode, ...(mode === 'reference' ? { h3LongVideo: false, h3ReferenceContent: {
            prompt: value.prompt, media_inputs: value.media_inputs, reference_pool_keys: value.reference_pool_keys,
          } } : {}) });
        }}><option value="first_last">首尾帧模式</option><option value="reference">H3 多图参考</option></select></label>}
      promptEditor={reference ? editor(false) : undefined} />
    {expanded && reference && createPortal(<div className="fixed inset-0 z-[9500] flex items-center justify-center bg-black/40 p-6" role="dialog" aria-modal="true" aria-label="H3 多图参考放大编辑">
      <div className="flex h-[80vh] w-full max-w-5xl flex-col rounded-2xl bg-n0 shadow-xl">{editor(true)}</div>
    </div>, document.body)}
  </>;
}

export default H3VideoPanel;
