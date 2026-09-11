import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, RotateCcw, Send, X } from 'lucide-react';
import {
  buildScriptIterationContext,
  type ScriptIterationMessage,
} from '../utils/scriptIteration';

interface ScriptIterationPanelProps {
  fileId: string;
  script: string;
  onGenerate: (
    currentScript: string,
    instruction: string,
    conversationContext: string,
  ) => Promise<string>;
  onApply: (content: string) => void;
  onClose: () => void;
}

export const ScriptIterationPanel: React.FC<ScriptIterationPanelProps> = ({
  fileId,
  script,
  onGenerate,
  onApply,
  onClose,
}) => {
  const [instruction, setInstruction] = useState('');
  const [draft, setDraft] = useState(script);
  const [messages, setMessages] = useState<ScriptIterationMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hasCandidate, setHasCandidate] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setInstruction('');
    setDraft(script);
    setMessages([]);
    setHasCandidate(false);
    setError('');
  }, [fileId]);

  useEffect(() => {
    if (!hasCandidate && !isGenerating) setDraft(script);
  }, [script, hasCandidate, isGenerating]);

  const conversationContext = useMemo(
    () => buildScriptIterationContext(messages),
    [messages],
  );

  const handleGenerate = async () => {
    const nextInstruction = instruction.trim();
    if (!nextInstruction || !draft.trim() || isGenerating) return;

    setIsGenerating(true);
    setError('');
    try {
      const result = await onGenerate(draft, nextInstruction, conversationContext);
      if (!result.trim()) throw new Error('AI 未返回可用的完整剧本');
      setDraft(result);
      setHasCandidate(true);
      setMessages((current) => [
        ...current,
        { role: 'user', content: nextInstruction },
        { role: 'assistant', content: '已生成新的完整候选版本。' },
      ]);
      setInstruction('');
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '生成失败，请稍后重试';
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApply = () => {
    if (!hasCandidate || !draft.trim()) return;
    onApply(draft);
    setHasCandidate(false);
    setMessages((current) => [
      ...current,
      { role: 'assistant', content: '候选版本已应用到当前文件。' },
    ]);
  };

  const handleReset = () => {
    setInstruction('');
    setDraft(script);
    setMessages([]);
    setHasCandidate(false);
    setError('');
  };

  return (
    <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-n0">
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-n40 px-4">
        <div>
          <div className="text-sm font-semibold text-n700">AI 对话修改</div>
          <div className="text-[10px] text-n300">候选稿确认后才会写回当前文件</div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleReset}
            className="flex h-8 w-8 items-center justify-center rounded border border-n40 text-n400 hover:bg-n20 hover:text-n700"
            title="重置本次对话"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded border border-n40 text-n400 hover:bg-n20 hover:text-n700"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-n20 p-3">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="font-semibold text-n500">
            {hasCandidate ? '待确认候选稿' : '当前剧本'}
          </span>
          {hasCandidate && <span className="text-primary">可继续提出意见</span>}
        </div>
        <textarea
          readOnly
          value={draft}
          className="min-h-0 w-full flex-1 resize-none rounded border border-n40 bg-n0 p-3 font-serif text-xs leading-relaxed text-n700 outline-none custom-scrollbar"
          aria-label="剧本候选稿"
        />
      </div>

      <div className="flex-shrink-0 border-t border-n40 bg-n0 p-3">
        {messages.length > 0 && (
          <div className="mb-2 max-h-16 overflow-y-auto text-[10px] leading-5 text-n400 custom-scrollbar">
            {messages.slice(-4).map((message, index) => (
              <div key={`${message.role}-${index}`}>
                <span className="font-semibold text-n500">
                  {message.role === 'user' ? '你' : 'AI'}：
                </span>
                {message.content}
              </div>
            ))}
          </div>
        )}
        {error && <div className="mb-2 text-[11px] text-red-600">{error}</div>}
        <div className="flex items-end gap-2">
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleGenerate();
              }
            }}
            placeholder="输入修改意见，例如：加强第一场冲突，但保留原结局"
            className="min-h-16 flex-1 resize-none rounded border border-n60 bg-n0 px-3 py-2 text-xs text-n700 outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={!instruction.trim() || isGenerating}
            className="flex h-9 items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            生成新版
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-n300">Ctrl + Enter 发送</span>
          <button
            type="button"
            onClick={handleApply}
            disabled={!hasCandidate || isGenerating}
            className="flex h-8 items-center gap-1.5 rounded border border-primary px-3 text-xs font-semibold text-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:border-n40 disabled:text-n200"
          >
            <Check className="h-4 w-4" />
            应用到当前文件
          </button>
        </div>
      </div>
    </div>
  );
};
