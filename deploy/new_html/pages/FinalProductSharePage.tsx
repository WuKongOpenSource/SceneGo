import React, { useEffect, useRef, useState } from 'react';
import { Clapperboard, Clock3, Loader2, MessageSquare, Send } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { getPublicFinal, submitPublicFeedback, type FinalFeedback, type PublicFinal } from '../services/finalProductShareService';

const formatTime = (value: number | null | undefined) => {
  const total = Math.max(0, Math.floor(Number(value || 0)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

export const FinalProductSharePage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [final, setFinal] = useState<PublicFinal | null>(null);
  const [feedback, setFeedback] = useState<FinalFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [withTime, setWithTime] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    getPublicFinal(token)
      .then(result => {
        if (!alive) return;
        setFinal(result.final);
        setFeedback(result.feedback || []);
      })
      .catch(err => { if (alive) setError(err?.message || '分享链接不可用'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token]);

  const submit = async () => {
    const clean = content.trim();
    if (!clean) return;
    setSending(true);
    setError('');
    try {
      const result = await submitPublicFeedback(token, {
        author_name: name.trim() || '访客',
        content: clean,
        timestamp_seconds: withTime ? Number(videoRef.current?.currentTime || 0) : null,
      });
      setFeedback(items => [result.feedback, ...items]);
      setContent('');
    } catch (err: any) {
      setError(err?.message || '提交失败，请稍后重试');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-n10 flex items-center justify-center text-n300"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载成品中…</div>;
  if (!final) return <div className="min-h-screen bg-n10 flex items-center justify-center text-n300 px-6 text-center">{error || '分享链接不存在或已停止'}</div>;

  return (
    <div className="min-h-screen bg-n10 text-n800">
      <header className="h-16 bg-n0 border-b border-n40 flex items-center px-6 md:px-10 gap-3">
        <span className="w-9 h-9 rounded-lg bg-primary text-white flex items-center justify-center"><Clapperboard size={19} /></span>
        <div>
          <div className="text-sm font-semibold">创剧成品审阅</div>
          <div className="text-[11px] text-n100">通过分享链接查看并提出修改意见</div>
        </div>
      </header>
      <main data-testid="final-product-share-content" className="mx-auto grid w-full max-w-[1680px] gap-5 px-4 py-7 md:px-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="bg-n0 border border-n40 rounded-xl overflow-hidden shadow-card self-start">
          <div className="px-4 py-3 border-b border-n40">
            <h1 className="text-base font-semibold">{final.title || '漫剧成品'}</h1>
            <div className="text-xs text-n100 mt-1 flex items-center gap-3">
              <span>{formatDate(final.created_at)}</span>
              {final.duration_seconds != null && <span>{formatTime(final.duration_seconds)}</span>}
            </div>
          </div>
          <video ref={videoRef} src={final.file_url} controls preload="metadata" className="w-full max-h-[72vh] bg-black block" />
          {final.description && <p className="px-4 py-3 text-sm text-n300">{final.description}</p>}
        </section>

        <aside className="space-y-4">
          <section className="bg-n0 border border-n40 rounded-xl p-4 shadow-card">
            <div className="flex items-center gap-2 mb-3"><MessageSquare size={16} className="text-primary" /><h2 className="text-sm font-semibold">给出意见</h2></div>
            <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="称呼（选填）" className="w-full border border-n40 rounded-lg px-3 py-2 text-sm mb-2 outline-none focus:border-primary" />
            <textarea value={content} onChange={e => setContent(e.target.value)} maxLength={1000} rows={5} placeholder="请说明需要调整的画面、节奏、声音或剧情…" className="w-full border border-n40 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-primary" />
            <label className="mt-2 flex items-center gap-2 text-xs text-n300 cursor-pointer">
              <input type="checkbox" checked={withTime} onChange={e => setWithTime(e.target.checked)} />
              记录当前播放时间，便于定位
            </label>
            {error && <p className="text-xs text-danger mt-2">{error}</p>}
            <button type="button" disabled={sending || !content.trim()} onClick={submit} className="mt-3 w-full rounded-lg bg-primary text-white px-3 py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
              {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}提交意见
            </button>
          </section>

          <section className="bg-n0 border border-n40 rounded-xl overflow-hidden shadow-card">
            <div className="px-4 py-3 border-b border-n40 text-sm font-semibold">审阅意见（{feedback.length}）</div>
            <div className="max-h-[45vh] overflow-y-auto divide-y divide-n30">
              {!feedback.length && <div className="p-5 text-center text-xs text-n100">还没有意见</div>}
              {feedback.map(item => (
                <article key={item.feedback_id} className="p-4">
                  <div className="flex items-center gap-2 text-xs"><span className="font-medium">{item.author_name || '访客'}</span><span className="text-n100 ml-auto">{formatDate(item.created_at)}</span></div>
                  {item.timestamp_seconds != null && <button type="button" onClick={() => { if (videoRef.current) { videoRef.current.currentTime = Number(item.timestamp_seconds); void videoRef.current.play(); } }} className="mt-2 inline-flex items-center gap-1 text-[11px] text-primary"><Clock3 size={12} />{formatTime(item.timestamp_seconds)}</button>}
                  <p className="text-sm text-n500 whitespace-pre-wrap mt-1.5">{item.content}</p>
                </article>
              ))}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
};

export default FinalProductSharePage;
