import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, FileText, Music, Wand2, Loader, Upload } from 'lucide-react';
import {
  cancelLocalMiniMaxMusic3,
  createAudioTrack,
  submitLocalMiniMaxMusic3,
  waitForLocalMiniMaxMusic3,
} from '@runtime/audioGenerationService';
import { uploadMediaItem } from '../../services/mediaLibraryService';
import { safeBrowserResourceUrl } from '../../services/httpClient';
import { updateEpisodeScriptById } from '../../services/scriptTimelineService';
import {
  clampUnicode,
  generateLyricsFromSummary,
  generateStorySummary,
  normalizeStorySummary,
  sha256Text,
  STORY_SUMMARY_MAX_CHARACTERS,
  unicodeLength,
} from '../../services/storyTextGenerationService';

function resolveUrl(path: string) {
  if (!path) return '';
  const normalized = path.startsWith('/') || /^(?:https?:|blob:|data:)/i.test(path) ? path : `/${path}`;
  return safeBrowserResourceUrl(normalized);
}

function fmtSec(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  return `${(ms / 1000).toFixed(1)}s`;
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

function readAudioUrlDurationMs(path: string): Promise<number> {
  return new Promise(resolve => {
    const audio = document.createElement('audio');
    let settled = false;
    const finish = (durationMs: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      audio.removeAttribute('src');
      resolve(durationMs);
    };
    const timeoutId = window.setTimeout(() => finish(0), 10_000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      finish(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    };
    audio.onerror = () => finish(0);
    audio.src = resolveUrl(path);
  });
}

export interface MusicModalProps {
  episodeId: string;
  projectId?: string;
  script: any;
  onClose?: () => void;
  onCreated: () => Promise<void>;
  presentation?: 'modal' | 'embedded';
}

export const MusicModal: React.FC<MusicModalProps> = ({
  episodeId, projectId, script, onClose = () => {}, onCreated, presentation = 'modal',
}) => {
  const scriptId = String(script?.scriptId || script?.script_id || '');
  const persistedSummary = normalizeStorySummary(
    script?.metadata?.story_summary || script?.metadata?.storySummary || '',
  );
  const [lyricsInput, setLyricsInput] = useState(persistedSummary);
  const [generatedLyrics, setGeneratedLyrics] = useState('');
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const summaryDirtyRef = useRef(false);
  const activeScriptIdRef = useRef(scriptId);
  const requestSequenceRef = useRef(0);

  const [musicLyrics, setMusicLyrics] = useState('');
  const [musicMode, setMusicMode] = useState<'instrumental' | 'theme'>('instrumental');
  const [musicDescription, setMusicDescription] = useState('电影感漫剧背景音乐，旋律连贯，开场克制，逐步推进，结尾留有余韵');
  const [musicDuration, setMusicDuration] = useState(30);
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicTaskId, setMusicTaskId] = useState('');
  const [musicProgress, setMusicProgress] = useState(0);
  const [musicResult, setMusicResult] = useState<{ url: string; durationMs: number } | null>(null);
  const [musicError, setMusicError] = useState('');

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    const scriptChanged = activeScriptIdRef.current !== scriptId;
    if (scriptChanged) {
      activeScriptIdRef.current = scriptId;
      summaryDirtyRef.current = false;
      requestSequenceRef.current += 1;
      setLyricsInput(persistedSummary);
      setGeneratedLyrics('');
      setLyricsError('');
      setSummaryError('');
      return;
    }
    if (!summaryDirtyRef.current && persistedSummary) {
      setLyricsInput(persistedSummary);
    }
  }, [persistedSummary, scriptId]);

  useEffect(() => () => {
    requestSequenceRef.current += 1;
  }, []);

  const handleGenerateSummary = useCallback(async () => {
    const story = String(
      script?.originalContent || script?.original_content
      || script?.adaptedScript || script?.adapted_script || '',
    ).trim();
    if (!story) {
      setSummaryError('当前剧本没有可用于生成概要的内容');
      return;
    }
    const sequence = ++requestSequenceRef.current;
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const sourceHash = await sha256Text(story);
      const summary = await generateStorySummary(story, {
        operation: 'script_story_summary',
        displayName: '生成故事概要',
        projectId,
        episodeId,
        sourcePage: 'audio',
        sourceItemId: scriptId || undefined,
        entityType: 'episode_script',
        entityId: scriptId || undefined,
      });
      if (sequence !== requestSequenceRef.current || activeScriptIdRef.current !== scriptId) return;
      if (scriptId) {
        await updateEpisodeScriptById(episodeId, scriptId, {
          metadata: {
            ...(script?.metadata || {}),
            story_summary: summary,
            story_summary_source_sha256: sourceHash,
            story_summary_status: 'ready',
          },
        });
      }
      if (!summaryDirtyRef.current) setLyricsInput(summary);
    } catch (error) {
      if (sequence !== requestSequenceRef.current) return;
      setSummaryError(error instanceof Error ? error.message : String(error));
    } finally {
      if (sequence === requestSequenceRef.current) setSummaryLoading(false);
    }
  }, [episodeId, projectId, script, scriptId]);

  const handleUpload = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError('');
    try {
      const durationMs = await readAudioDurationMs(uploadFile);
      const uploaded = await uploadMediaItem(uploadFile, {
        projectId,
        episodeId,
        permissionScope: projectId ? 'project' : 'private',
        title: uploadFile.name,
        tags: ['bgm'],
      });
      await createAudioTrack(episodeId, {
        track_type: 'bgm',
        name: uploadFile.name || 'BGM',
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
      console.error('上传背景音乐失败:', e);
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }, [episodeId, onCreated, projectId, uploadFile]);

  const handleGenerateLyrics = useCallback(async () => {
    const text = normalizeStorySummary(lyricsInput);
    if (!text) {
      setLyricsError('请先填写或生成故事概要');
      return;
    }
    const sequence = ++requestSequenceRef.current;
    setLyricsLoading(true);
    setLyricsError('');
    try {
      const lyrics = await generateLyricsFromSummary(text, {
        operation: 'music_lyrics_generate',
        displayName: '生成歌词',
        projectId,
        episodeId,
        sourcePage: 'audio',
        sourceItemId: scriptId || undefined,
        entityType: 'episode_script',
        entityId: scriptId || undefined,
      });
      if (sequence !== requestSequenceRef.current || activeScriptIdRef.current !== scriptId) return;
      setGeneratedLyrics(lyrics);
      setMusicLyrics(lyrics);
    } catch (e) {
      if (sequence !== requestSequenceRef.current) return;
      console.error('歌词生成失败:', e);
      setLyricsError(e instanceof Error ? e.message : String(e));
    } finally {
      if (sequence === requestSequenceRef.current) setLyricsLoading(false);
    }
  }, [episodeId, lyricsInput, projectId, scriptId]);

  const handleGenerateMusic = useCallback(async () => {
    if (!musicDescription.trim() || (musicMode === 'theme' && !musicLyrics.trim())) return;
    setMusicLoading(true);
    setMusicProgress(0);
    setMusicError('');
    setMusicResult(null);
    try {
      const seed = Math.floor(Math.random() * 2_147_483_647);
      const submitted = await submitLocalMiniMaxMusic3({
        caption: musicDescription,
        lyrics: musicMode === 'theme' ? musicLyrics : '[Instrumental]',
        durationSeconds: musicDuration,
        seed,
        projectId,
        episodeId,
      });
      setMusicTaskId(submitted.task_id);
      const generated = await waitForLocalMiniMaxMusic3(submitted.task_id, setMusicProgress);
      const actualDurationMs = await readAudioUrlDurationMs(generated.url);
      const storedDurationMs = actualDurationMs || musicDuration * 1000;
      setMusicResult({ url: resolveUrl(generated.url), durationMs: storedDurationMs });
      await createAudioTrack(episodeId, {
        track_type: 'bgm',
        name: `${musicMode === 'theme' ? 'AI 主题曲' : 'AI 背景音乐'} ${new Date().toLocaleTimeString()}`,
        audio_url: generated.url,
        duration_ms: storedDurationMs,
        generation_params: {
          source: 'local_minimax_music3',
          model: 'MiniMax-Music3',
          mode: musicMode,
          caption: musicDescription,
          lyrics: musicMode === 'theme' ? musicLyrics : '[Instrumental]',
          seed,
          requested_max_duration_seconds: musicDuration,
          actual_duration_ms: actualDurationMs || null,
          task_id: submitted.task_id,
          file_id: generated.fileId || null,
        },
      });
      await onCreated();
    } catch (e) {
      console.error('音乐生成失败:', e);
      setMusicError(e instanceof Error ? e.message : String(e));
    } finally {
      setMusicLoading(false);
      setMusicTaskId('');
    }
  }, [episodeId, musicDescription, musicDuration, musicLyrics, musicMode, onCreated, projectId]);

  const handleCancelMusic = useCallback(async () => {
    if (!musicTaskId) return;
    try {
      await cancelLocalMiniMaxMusic3(musicTaskId);
    } catch (e) {
      setMusicError(`当前任务可能已经开始执行，无法取消：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [musicTaskId]);

  const surface = (
      <div
        role={presentation === 'modal' ? 'dialog' : 'region'}
        aria-modal={presentation === 'modal' ? true : undefined}
        aria-label="音乐生成"
        className={presentation === 'modal'
          ? 'app-modal-surface relative max-h-[84vh] w-[640px] overflow-auto rounded-2xl border border-n40 bg-n0 p-6 shadow-xl'
          : 'h-full w-full overflow-auto rounded-xl border border-n40 bg-n0 p-6 shadow-sm'}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-bold text-n800">
              <Music size={16} className="text-success" /> 音乐生成
            </h3>
            {presentation === 'embedded' && (
              <p className="mt-1 text-xs text-n100">生成纯音乐或主题曲，完成后自动加入下方 BGM 音轨。</p>
            )}
          </div>
          {presentation === 'modal' && (
            <button onClick={onClose} className="text-n100 hover:text-n700">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="mb-4 rounded-md border border-n40 bg-n30 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-n700">
            <Upload size={14} className="text-success" /> 添加本地 BGM
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
              className="inline-flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-success disabled:opacity-50"
            >
              {uploading ? <Loader size={14} className="animate-spin" /> : <Upload size={14} />}
              添加
            </button>
          </div>
          {uploadError && (
            <p role="alert" className="mt-3 rounded-lg border border-danger/20 bg-danger-light px-3 py-2 text-xs text-danger">
              上传失败：{uploadError}
            </p>
          )}
        </div>

        <div className="mb-4 rounded-md border border-n40 bg-n30 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-n700">
            <FileText size={14} className="text-primary" /> 歌词生成
          </h4>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <label htmlFor={`music-story-summary-${scriptId || 'current'}`} className="block text-xs text-n100">
                  故事概要
                </label>
                <span className="text-[11px] text-n100">
                  {unicodeLength(lyricsInput)}/{STORY_SUMMARY_MAX_CHARACTERS}
                </span>
              </div>
              <textarea
                id={`music-story-summary-${scriptId || 'current'}`}
                value={lyricsInput}
                onChange={e => {
                  summaryDirtyRef.current = true;
                  setLyricsInput(clampUnicode(e.target.value, STORY_SUMMARY_MAX_CHARACTERS));
                }}
                rows={3}
                placeholder="描述故事情节、情绪或音乐主题..."
                className="w-full resize-none rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
              />
              {!persistedSummary && (
                <button
                  type="button"
                  onClick={handleGenerateSummary}
                  disabled={summaryLoading}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/10 disabled:opacity-50"
                >
                  {summaryLoading ? <Loader size={12} className="animate-spin" /> : <Wand2 size={12} />}
                  {summaryLoading ? '正在生成概要…' : '生成故事概要'}
                </button>
              )}
              {summaryError && (
                <p role="alert" className="mt-2 text-xs text-danger">概要生成失败：{summaryError}</p>
              )}
            </div>
            <button
              onClick={handleGenerateLyrics}
              disabled={lyricsLoading}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary-hover disabled:opacity-50"
            >
              {lyricsLoading ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
              生成歌词
            </button>
            {lyricsError && (
              <p role="alert" className="rounded-lg border border-danger/20 bg-danger-light px-3 py-2 text-xs text-danger">
                歌词生成失败：{lyricsError}
              </p>
            )}
            {generatedLyrics && (
              <div className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-n40 bg-n0 p-3 text-sm text-n700">
                {generatedLyrics}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-md border border-n40 bg-n30 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-n700">
            <Music size={14} className="text-success" /> 本地 MiniMax Music 3
          </h4>
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMusicMode('instrumental')}
                className={`rounded-lg border px-3 py-2 text-sm ${musicMode === 'instrumental' ? 'border-success bg-success/10 text-success' : 'border-n40 bg-n0 text-n700'}`}
              >
                纯音乐 / BGM
              </button>
              <button
                type="button"
                onClick={() => setMusicMode('theme')}
                className={`rounded-lg border px-3 py-2 text-sm ${musicMode === 'theme' ? 'border-success bg-success/10 text-success' : 'border-n40 bg-n0 text-n700'}`}
              >
                主题曲（含歌词）
              </button>
            </div>
            <div>
              <label className="mb-1 block text-xs text-n100">音乐风格、情绪与编排</label>
              <textarea
                value={musicDescription}
                onChange={e => setMusicDescription(e.target.value)}
                rows={3}
                placeholder="例如：悬疑国风，低沉弦乐与古琴，逐步增强，结尾克制..."
                className="w-full resize-none rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-n100">最长时长</label>
              <input
                type="number"
                min={10}
                max={300}
                step={5}
                value={musicDuration}
                onChange={e => setMusicDuration(Math.max(10, Math.min(300, Number(e.target.value) || 30)))}
                className="w-24 rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
              />
              <span className="text-xs text-n100">秒（10–300）</span>
            </div>
            {musicMode === 'theme' && (
            <div>
              <label className="mb-1 block text-xs text-n100">歌词</label>
              <textarea
                value={musicLyrics}
                onChange={e => setMusicLyrics(e.target.value)}
                rows={4}
                placeholder="输入歌词，或先从上方生成..."
                className="w-full resize-none rounded-lg border border-n40 bg-n0 px-3 py-2 text-sm text-n700"
              />
            </div>
            )}
            <button
              onClick={handleGenerateMusic}
              disabled={musicLoading || !musicDescription.trim() || (musicMode === 'theme' && !musicLyrics.trim())}
              className="flex items-center gap-2 rounded-lg bg-success px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-success disabled:opacity-50"
            >
              {musicLoading ? <Loader size={14} className="animate-spin" /> : <Music size={14} />}
              {musicLoading ? '排队或生成中…' : musicMode === 'theme' ? '生成主题曲' : '生成纯音乐'}
            </button>
            {musicLoading && (
              <div className="flex items-center justify-between rounded-lg border border-n40 bg-n0 px-3 py-2 text-xs text-n100">
                <span>{musicProgress > 0 ? `生成进度 ${Math.round(musicProgress > 1 ? musicProgress : musicProgress * 100)}%` : '等待本地模型处理'}</span>
                {musicTaskId && (
                  <button type="button" onClick={handleCancelMusic} className="text-danger hover:underline">
                    取消排队
                  </button>
                )}
              </div>
            )}
            {musicError && (
              <p role="alert" className="rounded-lg border border-danger/20 bg-danger-light px-3 py-2 text-xs text-danger">
                音乐生成失败：{musicError}
              </p>
            )}
            <p className="text-[11px] leading-5 text-n100">
              本地生成由 MiniMax-Music3 提供。任务与其他本地大模型共用串行队列，切换前会先卸载上一模型。
            </p>
            {musicResult && (
              <div className="flex items-center gap-3 pt-2">
                <audio controls src={musicResult.url} className="h-10 flex-1" />
                <span className="tabular-nums text-xs text-n100">{fmtSec(musicResult.durationMs)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
  );

  if (presentation === 'embedded') return surface;

  return (
    <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-n900/50" onClick={onClose} />
      {surface}
    </div>
  );
};
