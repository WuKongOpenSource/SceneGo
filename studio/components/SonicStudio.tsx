import React, { useRef, useState } from 'react';
import { AudioLines, Download, Loader2, Mic2, Pause, Play, X } from 'lucide-react';
import { useStudioRuntime } from '../services/runtime';

interface SonicStudioProps {
  isOpen: boolean;
  onClose: () => void;
  history: any[];
  onGenerate: (src: string, prompt: string, duration: number) => void;
}

const VOICES = [
  { id: 'presenter_male', label: '深沉叙述' },
  { id: 'presenter_female', label: '知性解说' },
];

export const SonicStudio: React.FC<SonicStudioProps> = ({
  isOpen,
  onClose,
  history,
  onGenerate,
}) => {
  const runtime = useStudioRuntime();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [text, setText] = useState('');
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<any>(history[0] || null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!text.trim() || isGenerating) return;
    setIsGenerating(true);
    setError('');
    try {
      const src = await runtime.generateAudio(text.trim(), { voiceId });
      const track = {
        id: `studio-audio-${Date.now()}`,
        src,
        title: text.trim().slice(0, 32),
        timestamp: Date.now(),
      };
      setCurrentTrack(track);
      onGenerate(src, text.trim(), 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '音频生成失败');
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlay = () => {
    const player = audioRef.current;
    if (!player || !currentTrack) return;
    if (player.paused) {
      void player.play();
      setIsPlaying(true);
    } else {
      player.pause();
      setIsPlaying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="创剧声音工厂"
      aria-hidden={!isOpen}
      className={`fixed inset-0 z-[180] bg-[#0a0a0c] text-slate-200 transition-all duration-300 ${
        isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <div className="flex h-16 items-center justify-between border-b border-white/10 px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/20">
            <AudioLines size={18} className="text-purple-300" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">创剧声音工厂</div>
            <div className="text-[10px] text-slate-500">使用流程化制作相同的 MiniMax TTS 通道</div>
          </div>
        </div>
        <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white">
          <X size={18} />
        </button>
      </div>

      <div className="mx-auto grid h-[calc(100%-4rem)] max-w-6xl grid-cols-[1fr_320px] gap-8 p-8">
        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-7">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-white">
            <Mic2 size={17} className="text-cyan-300" /> 文本转语音
          </div>
          <textarea
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder="输入要朗读的文本"
            className="h-52 w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-4 text-sm outline-none focus:border-cyan-500/50"
          />
          <div className="mt-4 flex items-center gap-3">
            <select
              value={voiceId}
              onChange={event => setVoiceId(event.target.value)}
              className="rounded-xl border border-white/10 bg-[#18181b] px-3 py-2 text-xs"
            >
              {VOICES.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
            </select>
            <button
              onClick={generate}
              disabled={!text.trim() || isGenerating}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-5 py-2 text-xs font-bold text-black disabled:opacity-40"
            >
              {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <AudioLines size={15} />}
              生成语音
            </button>
          </div>
          {error && <p className="mt-3 text-xs text-red-300">{error}</p>}

          {currentTrack && (
            <div className="mt-8 flex items-center gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <button onClick={togglePlay} className="rounded-full bg-white/10 p-3 hover:bg-white/20">
                {isPlaying ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{currentTrack.title}</div>
                <div className="text-[10px] text-slate-500">生成结果</div>
              </div>
              <a href={currentTrack.src} download className="rounded-full p-2 text-slate-400 hover:text-white">
                <Download size={17} />
              </a>
              <audio
                ref={audioRef}
                src={currentTrack.src}
                onEnded={() => setIsPlaying(false)}
                onPause={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
              />
            </div>
          )}
        </section>

        <aside className="overflow-auto rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <div className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">本集生成历史</div>
          <div className="space-y-2">
            {history.length === 0 && <p className="text-xs text-slate-600">暂无音频</p>}
            {history.map(track => (
              <button
                key={track.id}
                onClick={() => setCurrentTrack(track)}
                className="w-full rounded-xl border border-white/5 bg-black/20 p-3 text-left hover:border-white/15"
              >
                <div className="truncate text-xs text-slate-200">{track.title || '未命名音频'}</div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
};
