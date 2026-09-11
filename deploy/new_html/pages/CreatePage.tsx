






import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Sparkles } from 'lucide-react';
import { apiJson } from '../services/httpClient';
import AppSidebar from '../components/AppSidebar';
import { saveCreateIdeaSeed } from '../utils/createIdeaSeed';
import {
  aspectRatioForOrientation,
  orientationLabel,
  projectCreationSettings,
  type ProjectOrientation,
} from '../utils/projectCreationPreferences';

const GENRES = ['悬疑', '爱情', '科幻', '喜剧', '温情', '恐怖', '校园'];
const DURATIONS = [30, 60, 90, 180];
const EXAMPLES = [
  '深夜便利店的收银员发现，每晚午夜都有一个从不离开的顾客。',
  '外卖骑手接到一单，送餐地址是三年前已经拆掉的老房子。',
  '相亲对象太完美，直到我发现他是我自己训练的 AI。',
];
const PIPELINE_CARDS = [
  { n: '1', title: '写故事', sub: 'AI 把一句想法整理成完整故事和对白', bg: '#ECE9FF', fg: '#5B49F0' },
  { n: '2', title: '定角色和场景', sub: '选定人物、地点和整部作品的画风', bg: '#FFF0EB', fg: '#FF6A3D' },
  { n: '3', title: '排好每个画面', sub: '安排画面顺序、对白和声音', bg: '#E4F7EE', fg: '#12B76A' },
  { n: '4', title: '生成并导出', sub: '生成视频，自动合成可分享的短片', bg: '#E6F0FF', fg: '#3B7BE5' },
];

const chipClass = (active: boolean) =>
  `rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-all ${
    active ? 'border-b300 bg-primary-light text-primary' : 'border-n40 bg-n0 text-n300 hover:border-b300 hover:text-primary'
  }`;

export const CreatePage: React.FC = () => {
  const navigate = useNavigate();
  const [sentence, setSentence] = useState('');
  const [genrePreset, setGenrePreset] = useState('悬疑');
  const [customGenre, setCustomGenre] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [orientation, setOrientation] = useState<ProjectOrientation>('portrait');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const genre = genrePreset === '自定义' ? customGenre.trim() : genrePreset;
  const aspectRatio = aspectRatioForOrientation(orientation);
  const canGenerate = !!sentence.trim() && !!genre && !busy;

  const generate = async () => {
    const idea = sentence.trim();
    if (!idea || busy) return;
    setBusy(true);
    setError('');
    try {
      const projectName = idea.length > 14 ? `${idea.slice(0, 14)}…` : idea;
      const created = await apiJson<any>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({
          project_name: projectName,
          description: `一句话创意：${idea}（题材：${genre} · 时长：${durationSeconds}秒 · 画面：${orientationLabel(orientation)} ${aspectRatio}）`,
          visibility: 'private',
          member_usernames: [],
          settings: projectCreationSettings({
            genre,
            durationSeconds,
            orientation,
            aspectRatio,
          }),
        }),
      }, '创建项目');
      const newProjectId = created?.project?.project_id;
      if (!created?.success || !newProjectId) throw new Error(created?.error || '创建项目失败');

      const epCreated = await apiJson<any>(`/api/projects/${newProjectId}/episodes`, {
        method: 'POST',
        body: JSON.stringify({ episode_name: '第一集' }),
      }, '创建分集');
      if (!epCreated?.success) throw new Error(epCreated?.error || '创建分集失败');

      const list = await apiJson<any>(`/api/projects/${newProjectId}/episodes`, {}, '读取分集');
      const row = (list?.episodes ?? [])[0];
      const newEpisodeId = row?.episode_id ?? row?.episodeId;
      if (!newEpisodeId) throw new Error('未找到新建分集');

      saveCreateIdeaSeed(sessionStorage, {
        sentence: idea,
        genre,
        durationSeconds,
        orientation,
        aspectRatio,
        projectId: newProjectId,
        episodeId: newEpisodeId,
      });
      navigate(`/projects/${newProjectId}/ep/${newEpisodeId}/workflow/script`);
    } catch (e: any) {
      console.error('一句话创建失败:', e);
      setError(e?.message || '创建失败，请稍后再试');
      setBusy(false);
    }
  };

  return (
    <div className="layout-safe flex min-h-screen bg-n20 text-n800">
      <AppSidebar className="sticky top-0 hidden h-screen lg:flex" />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div data-testid="create-page-content" className="mx-auto w-full max-w-[1440px] px-5 pb-16 pt-[6vh] sm:px-8">

          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-primary-light px-3.5 py-1.5 font-mono text-xs font-bold tracking-[0.03em] text-primary">
            <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-primary" />
            不懂专业制作，也能完成一部短片
          </div>

          <h1 className="mb-3.5 font-display text-[44px] font-extrabold leading-[1.08] tracking-[-1.5px] text-n900">
            一句话，
            <br />
            从创意到成片。
          </h1>
          <p className="mb-7 max-w-[560px] text-base leading-relaxed text-n300">
            只需说清楚“谁、发生了什么”。其余内容先交给 AI，你可以在每一步查看、修改，再决定是否生成。
          </p>


          <div className="rounded-[20px] border border-n40 bg-n0 p-2" style={{ boxShadow: '0 14px 44px rgba(20,20,25,.07)' }}>
            <textarea
              value={sentence}
              onChange={e => setSentence(e.target.value)}
              placeholder={'用一句话描述你的故事创意…\n例：深夜便利店的收银员发现，每晚午夜都会进来同一个从不离开的顾客。'}
              className="min-h-[104px] w-full resize-none border-none bg-transparent px-4 pb-2 pt-4 text-base leading-[1.55] text-n800 outline-none placeholder:text-n100 focus:ring-0"
              style={{ boxShadow: 'none' }}
            />
            <div className="flex flex-wrap items-end justify-between gap-3.5 px-3 pb-2.5 pt-2">
              <details className="group min-w-0 flex-1">
                <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 py-1 text-[12.5px] text-n300 hover:text-primary">
                  <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                  可选：调整故事类型、成片时长和画面方向
                  <span className="text-n100">（{genre || '自定义'} · {durationSeconds}秒 · {orientationLabel(orientation)}）</span>
                </summary>
                <div className="mt-2 flex flex-col gap-2 rounded-xl bg-n20 p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 w-12 text-[11px] text-n100">故事类型</span>
                    {[...GENRES, '自定义'].map(g => (
                      <button key={g} type="button" onClick={() => setGenrePreset(g)} className={chipClass(genrePreset === g)}>
                        {g}
                      </button>
                    ))}
                    {genrePreset === '自定义' && (
                      <input
                        aria-label="自定义故事类型"
                        value={customGenre}
                        onChange={event => setCustomGenre(event.target.value)}
                        maxLength={20}
                        placeholder="输入故事类型"
                        className="min-w-[140px] flex-1 rounded-lg border border-n40 bg-n0 px-3 py-1.5 text-[12.5px] text-n700 outline-none placeholder:text-n100 focus:border-b300"
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 w-12 text-[11px] text-n100">成片时长</span>
                    {DURATIONS.map(d => (
                      <button key={d} type="button" onClick={() => setDurationSeconds(d)} className={chipClass(durationSeconds === d)}>
                        {d}秒
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-0.5 w-12 text-[11px] text-n100">画面方向</span>
                    {(['landscape', 'portrait'] as ProjectOrientation[]).map(value => (
                      <button key={value} type="button" onClick={() => setOrientation(value)} className={chipClass(orientation === value)}>
                        {orientationLabel(value)} · {aspectRatioForOrientation(value)}
                      </button>
                    ))}
                  </div>
                </div>
              </details>
              <button
                type="button"
                onClick={generate}
                disabled={!canGenerate}
                className={`inline-flex items-center gap-2 rounded-[11px] border-none px-5 py-3 text-[14.5px] font-semibold text-n0 transition-all ${
                  canGenerate ? 'shadow-glow hover:brightness-105' : 'cursor-not-allowed opacity-100'
                }`}
                style={{ background: canGenerate ? 'linear-gradient(135deg,#5B49F0,#7A5BFF)' : '#c9c5e8' }}
              >
                <Sparkles size={16} />
                {busy ? '正在准备…' : '开始创作'}
              </button>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}


          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] text-n100">不知道怎么写？试试这些</span>
            {EXAMPLES.map(example => (
              <button
                key={example}
                type="button"
                onClick={() => setSentence(example)}
                className="rounded-full border border-n40 bg-n0 px-3.5 py-1.5 text-left text-[12.5px] text-n400 transition-colors hover:border-b300 hover:text-primary"
              >
                {example}
              </button>
            ))}
          </div>


          <div className="mt-9 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {PIPELINE_CARDS.map(card => (
              <div key={card.n} className="rounded-[14px] border border-n40 bg-n0 p-4">
                <div
                  className="mb-3 flex h-[34px] w-[34px] items-center justify-center rounded-[9px] font-mono text-[13px] font-extrabold"
                  style={{ background: card.bg, color: card.fg }}
                >
                  {card.n}
                </div>
                <div className="mb-1 font-display text-[13.5px] font-bold">{card.title}</div>
                <div className="text-xs leading-normal text-n200">{card.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default CreatePage;
