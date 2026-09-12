






import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Clapperboard, Download, Film, AlertCircle, Loader2, Wand2, Check, X, Layers, Share2, MessageSquare, Copy, ExternalLink, Ban, Clock3 } from 'lucide-react';
import { listMediaItems } from '../services/mediaLibraryService';
import { useEpisode } from '../contexts/EpisodeContext';
import { getVideoTakes, startCompose, getComposeStatus, type VideoShot, type ComposeStatus } from '../services/videoWorkflowService';
import { selectContentTake } from '../services/contentWorkflowService';
import { LazyVideo } from '../components/LazyVideo';
import { ComposeFailureNotice } from '../components/ComposeFailureNotice';
import { secureApiUrl } from '../services/httpClient';
import {
  createFinalShare,
  deactivateFinalShare,
  finalShareUrl,
  getFinalShare,
  listFinalFeedback,
  type FinalFeedback,
  type FinalShare,
} from '../services/finalProductShareService';

const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });
const formatTime = (value: number | null | undefined) => {
  const total = Math.max(0, Math.floor(Number(value || 0)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const FinalProductPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { episodeId, assetScopeMode, setAssetScopeMode } = useEpisode();
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reviewItem, setReviewItem] = useState<any | null>(null);
  const [reviewTab, setReviewTab] = useState<'share' | 'feedback'>('share');
  const [share, setShare] = useState<FinalShare | null>(null);
  const [feedback, setFeedback] = useState<FinalFeedback[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [copied, setCopied] = useState(false);


  const [pickerOpen, setPickerOpen] = useState(false);
  const [shots, setShots] = useState<VideoShot[]>([]);
  const [picks, setPicks] = useState<Record<string, string>>({}); // item_id -> segment_id
  const [loadingShots, setLoadingShots] = useState(false);
  const [compose, setCompose] = useState<ComposeStatus | null>(null);
  const composeTimerRef = useRef<number | null>(null);
  const composeScopeRef = useRef<string | null>(episodeId);
  useEffect(() => {
    composeScopeRef.current = episodeId;
    return () => {
      composeScopeRef.current = null;
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
    };
  }, [episodeId]);
  const [totalFinals, setTotalFinals] = useState(0);
  const [hasMoreFinals, setHasMoreFinals] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState('');
  const loadingMoreRef = useRef(false);
  const finalOffsetRef = useRef(0);
  const finalScopeRef = useRef('');
  const finalScope = `${projectId}:${episodeId}:${assetScopeMode}:${reloadKey}`;
  finalScopeRef.current = finalScope;

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    (async () => {
      setLoading(true); setErr(null); setLoadingMore(false); setLoadMoreError('');
      loadingMoreRef.current = false;
      try {
        const params: any = { project_id: projectId, item_type: 'video', source: 'composed_final', limit: 24 };
        if (episodeId && assetScopeMode === 'episode') {
          params.episode_id = episodeId;
          params.include_shared = true;
        }
        const resp = await listMediaItems(params);
        if (alive) {
          const items = resp.items || [];
          setVideos(items);
          finalOffsetRef.current = items.length;
          setTotalFinals(resp.total ?? items.length);
          setHasMoreFinals(items.length > 0 && items.length < (resp.total ?? items.length));
        }
      } catch (e: any) {
        if (alive) setErr(e?.message || '加载成品失败');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId, episodeId, assetScopeMode, reloadKey]);

  const loadMoreFinals = async () => {
    if (loadingMoreRef.current || !hasMoreFinals) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const resp = await listMediaItems({
        project_id: projectId, item_type: 'video', source: 'composed_final',
        limit: 24, offset: finalOffsetRef.current,
        ...(episodeId && assetScopeMode === 'episode' ? { episode_id: episodeId, include_shared: true } : {}),
      });
      if (finalScopeRef.current !== finalScope || composeScopeRef.current !== episodeId) return;
      const items = resp.items || [];
      finalOffsetRef.current += items.length;
      setVideos(previous => Array.from(new Map([...previous, ...items].map(item => [item.library_item_id, item])).values()));
      setTotalFinals(resp.total ?? finalOffsetRef.current);
      setHasMoreFinals(items.length > 0 && finalOffsetRef.current < (resp.total ?? finalOffsetRef.current));
    } catch (error: any) {
      if (finalScopeRef.current === finalScope) setLoadMoreError(error?.message || '加载更多成品失败');
    } finally {
      if (finalScopeRef.current === finalScope) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  };


  const openPicker = useCallback(async () => {
    if (!episodeId) { alert('未找到当前集，请从某一集进入'); return; }
    setPickerOpen(true);
    setLoadingShots(true);
    try {
      const r = await getVideoTakes(episodeId);
      const sh = r.shots || [];
      setShots(sh);
      const def: Record<string, string> = {};
      sh.forEach(s => {
        if (!s.takes?.length) return;
        def[s.item_id] = s.selected_segment_id
          || s.takes.find(take => take.is_selected)?.segment_id
          || s.takes[0].segment_id;
      });
      setPicks(def);
    } catch (e: any) {
      alert('加载镜头失败：' + (e?.message || ''));
      setPickerOpen(false);
    } finally {
      setLoadingShots(false);
    }
  }, [episodeId]);

  const pollCompose = useCallback(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      if (composeScopeRef.current !== episodeId) return;
      setCompose(s);
      if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 4000);
      else if (s.status === 'done') setReloadKey(k => k + 1);
    }).catch(() => {});
  }, [episodeId]);

  const confirmCompose = useCallback(async () => {
    if (!episodeId) return;
    setPickerOpen(false);
    try {
      const s = await startCompose(episodeId, picks);
      if (composeScopeRef.current !== episodeId) return;
      setCompose({ ...s, status: (s.status as any) || 'running' });
      if (composeTimerRef.current) clearTimeout(composeTimerRef.current);
      composeTimerRef.current = window.setTimeout(pollCompose, 3000);
    } catch (e: any) {
      setCompose({ status: 'failed', total: 0, done: 0, error: e?.message || '启动失败' });
    }
  }, [episodeId, picks, pollCompose]);

  useEffect(() => () => { if (composeTimerRef.current) clearTimeout(composeTimerRef.current); }, []);
  useEffect(() => {
    if (!episodeId) return;
    getComposeStatus(episodeId).then(s => {
      if (composeScopeRef.current !== episodeId) return;
      if (s.status && s.status !== 'idle') {
        setCompose(s);
        if (s.status === 'running') composeTimerRef.current = window.setTimeout(pollCompose, 3000);
      }
    }).catch(() => {});
  }, [episodeId]);

  const openReview = useCallback(async (item: any, tab: 'share' | 'feedback') => {
    setReviewItem(item);
    setReviewTab(tab);
    setReviewLoading(true);
    setReviewError('');
    setCopied(false);
    try {
      const [shareResult, feedbackResult] = await Promise.all([
        getFinalShare(item.library_item_id),
        listFinalFeedback(item.library_item_id),
      ]);
      setShare(shareResult.share || null);
      setFeedback(feedbackResult.feedback || []);
    } catch (e: any) {
      setReviewError(e?.message || '加载审阅信息失败');
    } finally {
      setReviewLoading(false);
    }
  }, []);

  const enableShare = useCallback(async () => {
    if (!reviewItem) return;
    setReviewLoading(true);
    setReviewError('');
    try {
      const result = await createFinalShare(reviewItem.library_item_id);
      setShare(result.share);
    } catch (e: any) {
      setReviewError(e?.message || '创建分享失败');
    } finally {
      setReviewLoading(false);
    }
  }, [reviewItem]);

  const disableShare = useCallback(async () => {
    if (!reviewItem || !share) return;
    if (!window.confirm('停止分享后，原链接将立即失效。确定停止吗？')) return;
    setReviewLoading(true);
    try {
      await deactivateFinalShare(reviewItem.library_item_id, share.share_id);
      setShare(null);
    } catch (e: any) {
      setReviewError(e?.message || '停止分享失败');
    } finally {
      setReviewLoading(false);
    }
  }, [reviewItem, share]);

  const copyShare = useCallback(async () => {
    if (!share) return;
    await navigator.clipboard.writeText(finalShareUrl(share.share_token));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }, [share]);

  const finals = useMemo(() => videos
    .map(item => ({
      ...item,
      file_url: secureApiUrl(String(item?.file_url || ''), { absolute: true }),
    }))
    .filter(item => Boolean(item.file_url)), [videos]);
  const featured = finals[0] || null;
  const additionalFinals = finals.slice(1);

  return (
    <div
      data-testid="final-product-scroll"
      className="layout-safe workflow-stage-canvas workflow-stage-scroll h-full min-h-0 w-full overflow-y-auto p-6 custom-scrollbar"
    >
      <header className="responsive-toolbar mb-5 flex items-center gap-2">
        <Clapperboard className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-semibold text-n800">成品</h1>
        <span className="text-xs text-n100">每次合成都保留为独立版本，可分享审阅并汇总修改意见</span>
        <div className="flex-1 min-w-[16px]" />
        {episodeId && (
          <div className="ui-tabs ui-tabs--compact" title="成品可见范围">
            <button
              type="button"
              onClick={() => setAssetScopeMode('episode')}
              className="ui-tab"
              aria-pressed={assetScopeMode === 'episode'}
            >
              <Film size={12} />
              本集成品
            </button>
            <button
              type="button"
              onClick={() => setAssetScopeMode('project')}
              className="ui-tab"
              aria-pressed={assetScopeMode === 'project'}
            >
              <Layers size={12} />
              全部成品
            </button>
          </div>
        )}
        {compose?.status === 'running' ? (
          <span className="flex items-center gap-1 px-3 py-1.5 bg-primary-light text-primary text-xs rounded-lg border border-primary/20">
            <Loader2 size={13} className="animate-spin" /> 合成中 {compose.done}/{compose.total || '…'}
          </span>
        ) : (
          <button
            onClick={openPicker}
            disabled={!episodeId}
            title="挑选每个镜头要用的视频，合成一个完整成片"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg transition-colors disabled:opacity-50"
          >
            <Wand2 size={13} /> 合成成品
          </button>
        )}
        {compose?.status === 'done' && (
          <span className="text-[11px] text-emerald-600 flex items-center gap-1"><Check size={12} /> 已生成</span>
        )}
        {compose?.status === 'failed' && (
          <ComposeFailureNotice error={compose.error} />
        )}
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-n300 py-10 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> 加载成品中…
        </div>
      ) : err ? (
        <div className="flex items-center gap-2 text-danger"><AlertCircle className="w-4 h-4" />{err}</div>
      ) : !finals.length ? (
        <div className="bg-n0 border border-n40 rounded-md p-10 text-center text-n100">
          <Film className="w-10 h-10 mx-auto mb-3 opacity-40" />
          还没有成品视频 —— 在「视频 / 美化」阶段合成整片后，会自动出现在这里。
        </div>
      ) : (
        <div data-testid="final-product-content" className="min-w-0 space-y-6">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-n800">合成历史</h2>
              <p className="text-xs text-n100 mt-1">共 {totalFinals} 个成品，最新版本置顶，历史版本不会覆盖。</p>
            </div>
          </div>


          {featured && (
            <div className="bg-n0 border border-n40 rounded-md shadow-card overflow-hidden">
              <div className="responsive-toolbar flex items-center justify-between px-4 py-3 border-b border-n40">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] px-2 py-0.5 rounded bg-success-light text-success font-medium shrink-0">最新成品</span>
                  <span className="text-sm font-semibold text-n800 truncate">{featured.title}</span>
                  <span className="text-[11px] text-n100 shrink-0">{formatDate(featured.created_at)}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button type="button" onClick={() => openReview(featured, 'feedback')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-n500 hover:bg-n20 border border-n40"><MessageSquare size={14} />意见</button>
                  <button type="button" onClick={() => openReview(featured, 'share')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-primary hover:bg-primary-light border border-n40"><Share2 size={14} />分享</button>
                  <a href={featured.file_url} download className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-primary hover:bg-primary-light border border-n40"><Download className="w-3.5 h-3.5" />下载</a>
                </div>
              </div>
              <LazyVideo
                src={featured.file_url}
                controls
                muted={false}
                firstFrame={false}
                hoverPreview={false}
                className="mx-auto max-w-full max-h-[70vh] bg-black block"
              />
            </div>
          )}


          {additionalFinals.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-n300 mb-2">历史版本（{additionalFinals.length}）</div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {additionalFinals.map((v, index) => (
                  <div key={v.library_item_id} className="bg-n0 border border-n40 rounded-md overflow-hidden shadow-card">
                    <LazyVideo
                      src={v.file_url}
                      preload="none"
                      controls
                      muted={false}
                      firstFrame={false}
                      hoverPreview={false}
                      className="w-full aspect-video bg-black block"
                    />
                    <div className="px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] rounded bg-n20 text-n300 px-1.5 py-0.5 shrink-0">版本 {String(totalFinals - index - 1).padStart(2, '0')}</span>
                        <span className="text-[11px] text-n700 truncate" title={v.title || ''}>{v.title || '未命名'}</span>
                      </div>
                      <div className="text-[10px] text-n100 mt-1">{formatDate(v.created_at)}{v.duration_seconds != null ? ` · ${formatTime(v.duration_seconds)}` : ''}</div>
                      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-n30">
                        <button type="button" onClick={() => openReview(v, 'feedback')} className="flex-1 inline-flex justify-center items-center gap-1 rounded px-2 py-1 text-[11px] text-n300 hover:bg-n20"><MessageSquare size={12} />意见</button>
                        <button type="button" onClick={() => openReview(v, 'share')} className="flex-1 inline-flex justify-center items-center gap-1 rounded px-2 py-1 text-[11px] text-primary hover:bg-primary-light"><Share2 size={12} />分享</button>
                        <a href={v.file_url} download className="p-1 text-n100 hover:text-primary" title="下载"><Download className="w-3.5 h-3.5" /></a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loadMoreError && <p role="alert" className="text-center text-sm text-danger">{loadMoreError}</p>}
      {hasMoreFinals && !loading && <div className="flex justify-center py-4">
        <button type="button" onClick={() => void loadMoreFinals()} disabled={loadingMore}
          className="rounded-lg border border-n40 bg-n0 px-5 py-2 text-sm text-primary hover:bg-primary-light disabled:opacity-50">
          {loadingMore ? '加载中…' : `加载更多成品（${finals.length}/${totalFinals}）`}
        </button>
      </div>}

      {reviewItem && (
        <div className="fixed inset-0 z-[60] bg-black/45 flex items-center justify-center p-4" onClick={() => setReviewItem(null)}>
          <div className="modal-surface bg-n0 rounded-xl shadow-bottom w-[680px] max-w-full max-h-[82vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-n40 flex items-center gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-n800 truncate">{reviewItem.title || '成品审阅'}</h2>
                <p className="text-[11px] text-n100 mt-0.5">{formatDate(reviewItem.created_at)}</p>
              </div>
              <button type="button" onClick={() => setReviewItem(null)} className="ml-auto text-n100 hover:text-n700"><X size={17} /></button>
            </div>
            <div className="ui-tabs" aria-label="成品分享与审阅">
              <button type="button" onClick={() => setReviewTab('share')} className="ui-tab" aria-pressed={reviewTab === 'share'}>分享链接</button>
              <button type="button" onClick={() => setReviewTab('feedback')} className="ui-tab" aria-pressed={reviewTab === 'feedback'}>审阅意见 {feedback.length ? `(${feedback.length})` : ''}</button>
            </div>
            <div className="p-5 overflow-y-auto min-h-[230px]">
              {reviewLoading ? (
                <div className="h-40 flex items-center justify-center text-sm text-n100"><Loader2 size={16} className="animate-spin mr-2" />加载中…</div>
              ) : reviewError ? (
                <div className="text-sm text-danger">{reviewError}</div>
              ) : reviewTab === 'share' ? (
                <div>
                  <div className="rounded-lg bg-primary-light/50 border border-primary/20 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-n800"><Share2 size={16} className="text-primary" />分享指定成品</div>
                    <p className="text-xs text-n300 mt-2 leading-5">访问者只能查看当前这个成品并提交意见，无法进入项目、其它分集或创作工作区。</p>
                  </div>
                  {!share ? (
                    <button type="button" onClick={enableShare} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary text-white px-4 py-2 text-sm"><Share2 size={15} />生成分享链接</button>
                  ) : (
                    <div className="mt-4 space-y-3">
                      <label className="block text-xs text-n300">公开审阅链接</label>
                      <div className="flex gap-2">
                        <input readOnly value={finalShareUrl(share.share_token)} className="flex-1 min-w-0 border border-n40 rounded-lg px-3 py-2 text-xs bg-n10" />
                        <button type="button" onClick={copyShare} className="inline-flex items-center gap-1.5 border border-n40 rounded-lg px-3 text-xs text-primary hover:bg-primary-light"><Copy size={14} />{copied ? '已复制' : '复制'}</button>
                        <a href={finalShareUrl(share.share_token)} target="_blank" rel="noreferrer" className="inline-flex items-center border border-n40 rounded-lg px-3 text-n300 hover:bg-n20" title="打开链接"><ExternalLink size={14} /></a>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-n100"><span>已访问 {share.access_count || 0} 次</span><span>创建于 {formatDate(share.created_at)}</span></div>
                      <button type="button" onClick={disableShare} className="inline-flex items-center gap-1.5 text-xs text-danger hover:bg-danger-light rounded px-2 py-1.5"><Ban size={14} />停止分享</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {!feedback.length && <div className="py-12 text-center text-sm text-n100"><MessageSquare size={24} className="mx-auto mb-2 opacity-50" />还没有收到审阅意见</div>}
                  {feedback.map(item => (
                    <article key={item.feedback_id} className="rounded-lg border border-n40 p-3">
                      <div className="flex items-center gap-2 text-xs"><span className="font-medium text-n700">{item.author_name || '访客'}</span><span className="ml-auto text-n100">{formatDate(item.created_at)}</span></div>
                      {item.timestamp_seconds != null && <span className="mt-2 inline-flex items-center gap-1 rounded bg-primary-light px-2 py-0.5 text-[11px] text-primary"><Clock3 size={11} />视频 {formatTime(item.timestamp_seconds)}</span>}
                      <p className="mt-2 text-sm text-n500 whitespace-pre-wrap">{item.content}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}


      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="modal-surface bg-n0 rounded-lg shadow-bottom w-[900px] max-w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="responsive-toolbar px-5 py-3 border-b border-n40 flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-n800">挑选每镜要用的视频</h2>
              <span className="text-xs text-n100">默认选中最新一条，可逐镜更换</span>
              <div className="flex-1" />
              <button onClick={() => setPickerOpen(false)} className="text-n100 hover:text-n700"><X className="w-4 h-4" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingShots ? (
                <div className="flex items-center gap-2 text-n300 py-10 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> 加载镜头中…
                </div>
              ) : shots.length === 0 ? (
                <div className="text-center text-n100 py-10">本集还没有生成过视频，无法合成。</div>
              ) : shots.map((s, i) => (
                <div key={s.item_id} className="border border-n40 rounded-md p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-bold text-n300">镜头 {String(i + 1).padStart(2, '0')}</span>
                    <span className="text-[11px] text-n100 truncate">{s.dialogue || s.scene || ''}</span>
                    <span className="ml-auto text-[10px] text-n100">{s.takes.length} 条</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {s.takes.map((t, ti) => {
                      const selected = picks[s.item_id] === t.segment_id;
                      return (
                        <button
                          key={t.segment_id}
                          onClick={() => {
                            setPicks(p => ({ ...p, [s.item_id]: t.segment_id }));
                            if (t.take_id) {
                              void selectContentTake(t.take_id, 'storyboard_item', s.item_id, 'video')
                                .then(() => setShots(current => current.map(shot => (
                                  shot.item_id === s.item_id
                                    ? {
                                      ...shot,
                                      selected_segment_id: t.segment_id,
                                      takes: shot.takes.map(take => ({
                                        ...take,
                                        is_selected: take.segment_id === t.segment_id,
                                      })),
                                    }
                                    : shot
                                ))))
                                .catch(() => undefined);
                            }
                          }}
                          className={`relative shrink-0 w-28 aspect-video rounded border-2 overflow-hidden transition-all ${
                            selected ? 'border-primary ring-2 ring-primary/30' : 'border-n40 hover:border-n100'
                          }`}
                          title={ti === 0 ? '最新' : `第 ${s.takes.length - ti} 次生成`}
                        >
                          <LazyVideo src={t.video_url} preload="none" className="w-full h-full object-contain bg-black" />
                          {ti === 0 && <span className="absolute top-0.5 left-0.5 bg-n800/70 text-white text-[9px] px-1 rounded">最新</span>}
                          {selected && (
                            <span className="absolute bottom-0.5 right-0.5 bg-primary text-white rounded-full p-0.5"><Check className="w-3 h-3" /></span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-n40 flex items-center justify-end gap-2">
              <span className="text-[11px] text-n100 mr-auto">将合成 {shots.length} 个镜头</span>
              <button onClick={() => setPickerOpen(false)} className="px-3 py-1.5 text-xs text-n300 hover:text-n800 rounded">取消</button>
              <button
                onClick={confirmCompose}
                disabled={shots.length === 0}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary-hover text-white text-xs rounded-lg disabled:opacity-50"
              >
                <Wand2 className="w-3.5 h-3.5" /> 开始合成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinalProductPage;
