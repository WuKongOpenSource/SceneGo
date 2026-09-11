import React, { useCallback, useState } from 'react';
import { X, Sparkles, Loader, Upload } from 'lucide-react';
import { createAudioTrack, generateSFX } from '@runtime/audioGenerationService';
import { uploadMediaItem } from '../../services/mediaLibraryService';
import { safeBrowserResourceUrl } from '../../services/httpClient';

function resolveUrl(path: string) {
  if (!path) return '';
  const normalized = path.startsWith('/') || /^(?:https?:|blob:|data:)/i.test(path) ? path : `/${path}`;
  return safeBrowserResourceUrl(normalized);
}

function readAudioDurationMs(file: File): Promise<number> {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    audio.src = url;
  });
}

export interface SfxModalProps {
  episodeId: string;
  projectId?: string;
  script: any;
  onClose: () => void;
  onCreated: () => Promise<void>;
}

export const SfxModal: React.FC<SfxModalProps> = ({
  episodeId, projectId, script, onClose, onCreated,
}) => {
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState('');

  const handleUpload = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const durationMs = await readAudioDurationMs(uploadFile);
      const uploaded = await uploadMediaItem(uploadFile, {
        projectId,
        episodeId,
        permissionScope: projectId ? 'project' : 'private',
        title: uploadFile.name,
        tags: ['sfx'],
      });
      await createAudioTrack(episodeId, {
        track_type: 'sfx_global',
        name: uploadFile.name || '音效',
        audio_url: uploaded.file_url,
        duration_ms: durationMs,
        generation_params: {
          source: 'local_upload',
          file_id: uploaded.file_id,
          library_item_id: uploaded.library_item_id,
        },
      });
      await onCreated();
    } catch (e) {
      console.error('上传音效失败:', e);
      alert(`上传音效失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }, [episodeId, onCreated, projectId, uploadFile]);

  const handleGenerate = useCallback(async () => {
    const text = description.trim() || (script?.adaptedScript || script?.adapted_script || '').slice(0, 300);
    if (!text) return;
    setGenerating(true);
    try {
      const res = await generateSFX({
        description: text,
        entity_type: 'episode',
        entity_id: episodeId,
        file_role: 'sfx_audio',
        episode_id: episodeId,
      } as any);
      const audioUrl = res.audio_url || res.file_url || '';
      if (audioUrl) {
        setResultUrl(resolveUrl(audioUrl));
        await createAudioTrack(episodeId, {
          track_type: 'sfx_global',
          name: `AI 音效 ${new Date().toLocaleTimeString()}`,
          audio_url: audioUrl,
          duration_ms: res.duration_ms || 0,
          generation_params: { source: 'minimax_sfx', description: text },
        });
        await onCreated();
      }
    } catch (e) {
      console.error('AI 音效生成失败:', e);
      alert(`AI 音效生成失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGenerating(false);
    }
  }, [description, episodeId, onCreated, script]);

  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-n900/50" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="添加音效" className="app-modal-surface relative max-h-[84vh] w-[560px] overflow-auto rounded-2xl border border-n40 bg-n0 p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-n800">
            <Sparkles size={16} className="text-primary" /> 添加音效
          </h3>
          <button onClick={onClose} className="text-n100 hover:text-n700">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 rounded-md border border-n40 bg-n30 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-n700">
            <Upload size={14} className="text-primary" /> 添加本地音效
          </h4>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept="audio/*"
              onChange={e => setUploadFile(e.target.files?.[0] || null)}
              className="flex-1 rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
            />
            <button
              onClick={handleUpload}
              disabled={!uploadFile || uploading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
            >
              {uploading ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
              添加
            </button>
          </div>
        </div>

        <div className="rounded-md border border-n40 bg-n30 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-n700">
            <Sparkles size={14} className="text-primary" /> AI 音效制作
          </h4>
          <p className="mb-3 rounded border border-y200 bg-y50 px-3 py-2 text-xs text-y500">
            真实生成可能产生费用。留空时会使用当前剧本内容作为参考。
          </p>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            placeholder="例如：雨夜街道、脚步声、门铃、风声、紧张氛围..."
            className="mb-3 w-full resize-none rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
          />
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
          >
            {generating ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
            生成音效
          </button>
          {resultUrl && (
            <div className="mt-3">
              <audio controls src={resultUrl} className="h-10 w-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
