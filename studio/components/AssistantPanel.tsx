
import React, { useRef, useEffect, useState } from 'react';
import { X, Eraser, Copy, CornerDownLeft, Loader2, Sparkles, Brain, PenLine, Wand2, Coins } from 'lucide-react';
import { useStudioRuntime } from '../services/runtime';
import {
  buildStudioTextCreditRequest,
  summarizeStudioCreditQuote,
  type StudioCreditQuote,
} from '../services/creditPolicy';

interface Message {
  role: 'user' | 'model';
  text: string;
}

interface AssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
}


const parseInlineStyles = (text: string): React.ReactNode[] => {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
          const content = part.slice(2, -2);
          // Highlight key values or important labels with brighter white/cyan
          return <span key={i} className="text-white font-bold mx-0.5">{content}</span>;
      }
      return part;
  });
};

const renderFormattedMessage = (text: string) => {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, index) => {
    const key = `line-${index}`;
    const trimmed = line.trim();

    // Empty lines
    if (!trimmed) {
       elements.push(<div key={key} className="h-2" />);
       return;
    }

    // H1 (# Title)
    if (line.startsWith('# ')) {
        elements.push(
            <h1 key={key} className="text-base font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 mt-5 mb-3 border-b border-white/10 pb-2">
                {line.replace(/^#\s/, '')}
            </h1>
        );
        return;
    }

    // H2 (## Title)
    if (line.startsWith('## ')) {
         elements.push(
            <h2 key={key} className="text-sm font-bold text-white mt-4 mb-2 flex items-center gap-2">
                <span className="w-1 h-4 bg-cyan-500 rounded-full inline-block" />
                {line.replace(/^##\s/, '')}
            </h2>
        );
        return;
    }

    // H3/H4 (### Title)
    if (line.startsWith('### ') || line.startsWith('#### ')) {
        const content = line.replace(/^#+\s/, '');
         elements.push(
            <h3 key={key} className="text-xs font-bold text-cyan-300 mt-3 mb-1 uppercase tracking-wider">
                {content}
            </h3>
        );
        return;
    }

    // List Items (* Item or - Item)
    if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
        const content = trimmed.replace(/^[\*\-]\s/, '');
        elements.push(
            <div key={key} className="flex gap-2 ml-1 mb-1.5 items-start group/list">
                <span className="w-1.5 h-1.5 rounded-full bg-white/20 mt-[7px] shrink-0 group-hover/list:bg-cyan-400 transition-colors" />
                <div className="text-[13px] leading-relaxed text-slate-300 flex-1">
                    {parseInlineStyles(content)}
                </div>
            </div>
        );
        return;
    }

    if (/^\d+\.\s/.test(trimmed)) {
        const [num, ...rest] = trimmed.split(/\.\s/);
        const content = rest.join('. ');
        elements.push(
            <div key={key} className="flex gap-2 ml-1 mb-1.5 items-start">
                <span className="text-xs font-mono text-cyan-500/80 mt-[2px] shrink-0">{num}.</span>
                <div className="text-[13px] leading-relaxed text-slate-300 flex-1">
                    {parseInlineStyles(content)}
                </div>
            </div>
        );
        return;
    }

    // Blockquotes (> Quote)
    if (trimmed.startsWith('> ')) {
        const content = trimmed.replace(/^>\s/, '');
        elements.push(
            <div key={key} className="pl-3 border-l-2 border-cyan-500/30 italic text-slate-400 my-2 text-xs">
                {parseInlineStyles(content)}
            </div>
        );
        return;
    }

    elements.push(
        <div key={key} className="text-[13px] leading-relaxed text-slate-300 mb-1">
            {parseInlineStyles(line)}
        </div>
    );
  });

  return <div className="space-y-0.5 select-text cursor-text">{elements}</div>;
};

export const AssistantPanel: React.FC<AssistantPanelProps> = ({ isOpen, onClose }) => {
  const runtime = useStudioRuntime();
  const [messages, setMessages] = useState<Message[]>([{ role: 'model', text: '你好！我是您的创意助手。今天想创作些什么？' }]);
  const [isLoading, setIsLoading] = useState(false);
  const [input, setInput] = useState('');
  const [creditQuote, setCreditQuote] = useState<StudioCreditQuote | null>(null);
  const [isCreditLoading, setIsCreditLoading] = useState(false);

  // States for different modes
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [isStoryboardActive, setIsStoryboardActive] = useState(false);
  const [isHelpMeWriteActive, setIsHelpMeWriteActive] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const creditText = `${messages.slice(-12).map(message => message.text).join('\n')}\n${input}`.trim();
  const creditRequest = buildStudioTextCreditRequest(creditText);
  const creditRequestKey = JSON.stringify(creditRequest);
  const creditSummary = summarizeStudioCreditQuote(creditRequest, creditQuote);
  const creditInsufficient = Boolean(input.trim() && creditSummary.enabled && !creditSummary.enough);

  useEffect(() => {
    if (!isOpen || !input.trim()) {
      setCreditQuote(null);
      setIsCreditLoading(false);
      return;
    }
    let active = true;
    setIsCreditLoading(true);
    const timer = window.setTimeout(() => {
      runtime.estimateCredits(creditRequest.featureKey, creditRequest.params)
        .then(quote => { if (active) setCreditQuote(quote); })
        .catch(error => {
          console.warn('[studio] failed to estimate assistant credits', error);
          if (active) setCreditQuote(null);
        })
        .finally(() => { if (active) setIsCreditLoading(false); });
    }, 160);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [creditRequestKey, input, isOpen, runtime]);

  // Auto-scroll
  useEffect(() => {
    if (isOpen) {
        setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }
  }, [messages, isLoading, isOpen]);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // If panel is open and click is outside the panel container
      if (isOpen && panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading || creditInsufficient) return;

    const userText = input;
    setInput('');

    const newMessages: Message[] = [...messages, { role: 'user', text: userText }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
        const history = messages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));

        const responseText = await runtime.sendChatMessage(history, userText, {
            isThinkingMode,
            isStoryboard: isStoryboardActive,
            isHelpMeWrite: isHelpMeWriteActive
        });

        setMessages(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (error: any) {
        setMessages(prev => [...prev, { role: 'model', text: error.message || "连接错误，请稍后重试。" }]);
    } finally {
        setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([{ role: 'model', text: '你好！我是您的创意助手。今天想创作些什么？' }]);
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text).then(() => {
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    }).catch(err => console.error("Copy failed", err));
  };

  const SPRING_ANIMATION = "transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label="AI 创意助手"
      aria-hidden={!isOpen}
      className={`fixed right-6 top-1/2 z-[180] h-[85vh] w-[min(420px,calc(100vw-3rem))] -translate-y-1/2 rounded-[24px] border border-white/10 bg-[#1c1c1e]/95 shadow-2xl backdrop-blur-3xl flex flex-col overflow-hidden ${SPRING_ANIMATION} ${isOpen ? 'opacity-100 translate-x-0 scale-100' : 'opacity-0 translate-x-10 scale-95 pointer-events-none'}`}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-full text-slate-500 hover:text-white transition-colors group"
          >
            <X size={14} className="group-hover:scale-110 transition-transform" />
          </button>
          <button
            onClick={handleClearChat}
            className="p-2 hover:bg-white/10 rounded-full text-slate-500 hover:text-red-400 transition-colors group"
            title="清空对话"
          >
            <Eraser size={14} className="group-hover:scale-110 transition-transform" />
          </button>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col items-end">
            <span className="text-xs font-bold text-slate-200 tracking-wide">AI 创意助手</span>
            <span className="text-[10px] text-slate-500 font-medium">提示词优化 & 灵感生成</span>
          </div>
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-cyan-500/20 to-blue-500/20 flex items-center justify-center border border-white/10 shadow-inner">
             <Sparkles size={14} className="text-cyan-400" />
          </div>
        </div>
      </div>

      {/* Chat Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar bg-[#0a0a0c]/50">
        {messages.map((m, i) => (
          <div key={i} className={`flex w-full ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex flex-col max-w-[92%] gap-1.5 ${m.role === 'user' ? 'items-end' : 'items-start'}`}>

                {/* Role Label */}
                <div className="flex items-center gap-2 px-1">
                    {m.role === 'model' && <span className="text-[10px] font-bold text-cyan-500/80 uppercase tracking-wider">创剧 AI</span>}
                    {m.role === 'user' && <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">You</span>}
                </div>

                {/* Message Bubble */}
                <div className="group relative transition-all w-full">
                    <div
                        className={`
                            relative px-5 py-4 rounded-2xl shadow-sm border select-text cursor-text
                            ${m.role === 'user'
                                ? 'bg-[#2c2c2e] border-white/10 text-slate-100 rounded-tr-sm'
                                : 'bg-[#1c1c1e] border-white/5 text-slate-300 rounded-tl-sm w-full pr-10' // Add padding right for copy button
                            }
                        `}
                    >
                        {m.role === 'model' ? renderFormattedMessage(m.text) : <p className="leading-6 text-[13px] whitespace-pre-wrap">{m.text}</p>}

                        {/* Copy Button (Inside Bubble for reliability) */}
                        <button
                            onClick={() => handleCopy(m.text, i)}
                            className={`absolute top-2 right-2 p-1.5 rounded-full bg-black/20 hover:bg-black/50 border border-white/5 text-slate-400 opacity-0 group-hover:opacity-100 transition-all hover:text-white hover:scale-110 z-10`}
                            title="复制内容"
                        >
                            {copiedIndex === i ? <span className="text-[10px] font-bold text-green-400">OK</span> : <Copy size={10} />}
                        </button>
                    </div>
                </div>
            </div>
          </div>
        ))}

        {isLoading && (
            <div className="flex justify-start w-full animate-in fade-in slide-in-from-bottom-2">
                <div className="flex flex-col gap-2 max-w-[85%]">
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-1 ${isThinkingMode ? 'text-indigo-400' : 'text-cyan-500/80'}`}>
                        {isThinkingMode ? 'Deep Thinking' : 'Thinking'}
                    </span>
                    <div className={`px-5 py-4 bg-[#1c1c1e] border rounded-2xl rounded-tl-sm flex items-center gap-3 w-fit shadow-lg ${isThinkingMode ? 'border-indigo-500/30 shadow-indigo-900/20' : 'border-white/5 shadow-cyan-900/10'}`}>
                        <Loader2 size={16} className={`animate-spin ${isThinkingMode ? 'text-indigo-400' : 'text-cyan-500'}`} />
                        <span className={`text-xs font-medium tracking-wide ${isThinkingMode ? 'text-indigo-200' : 'text-slate-400'}`}>
                            {isThinkingMode ? "深度思考中..." : isStoryboardActive ? "正在规划分镜..." : isHelpMeWriteActive ? "正在润色文本..." : "正在思考创意..."}
                        </span>
                    </div>
                </div>
            </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-[#1c1c1e] border-t border-white/5 shrink-0 flex flex-col gap-2">

        {/* Tool Bar */}
        <div className="flex items-center justify-between px-1">
             <div className="flex items-center gap-2">
                 <button
                    onClick={() => { setIsThinkingMode(!isThinkingMode); setIsStoryboardActive(false); setIsHelpMeWriteActive(false); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${isThinkingMode ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'bg-white/5 text-slate-500 border-transparent hover:text-slate-300'}`}
                 >
                    <Brain size={12} className={isThinkingMode ? "animate-pulse" : ""} />
                    <span>深度思考模式</span>
                 </button>

                 <button
                    onClick={() => { setIsStoryboardActive(!isStoryboardActive); setIsThinkingMode(false); setIsHelpMeWriteActive(false); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${isStoryboardActive ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-white/5 text-slate-500 border-transparent hover:text-slate-300'}`}
                 >
                    <PenLine size={12} />
                    <span>分镜脚本</span>
                 </button>

                 <button
                    onClick={() => { setIsHelpMeWriteActive(!isHelpMeWriteActive); setIsThinkingMode(false); setIsStoryboardActive(false); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all border ${isHelpMeWriteActive ? 'bg-pink-500/20 text-pink-300 border-pink-500/50 shadow-[0_0_10px_rgba(236,72,153,0.2)]' : 'bg-white/5 text-slate-500 border-transparent hover:text-slate-300'}`}
                 >
                    <Wand2 size={12} />
                    <span>帮我写</span>
                 </button>
             </div>

             {isThinkingMode && <span className="text-[9px] text-indigo-400/70 font-mono tracking-tight">深度思考</span>}
        </div>

        <div className="relative group/input">
          <textarea
            className="w-full bg-black/20 border border-white/10 rounded-[20px] pl-4 pr-12 py-3.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:bg-black/40 focus:border-cyan-500/30 transition-all resize-none custom-scrollbar leading-5"
            placeholder={
                isStoryboardActive ? "输入视频描述，我将为您生成专业分镜脚本..." :
                isThinkingMode ? "输入复杂问题，进行深度逻辑推理..." :
                isHelpMeWriteActive ? "输入简短想法，我将帮您扩写和润色..." :
                "输入您的想法，让 AI 为您完善..."
            }
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                }
            }}
            rows={1}
            style={{ minHeight: '48px', maxHeight: '120px' }}
          />
          <button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading || creditInsufficient}
            title={creditInsufficient ? '创作点数不足，请先补充创作点数' : undefined}
            className={`absolute right-2 top-2 p-2 rounded-full transition-all duration-300 ${input.trim() && !isLoading && !creditInsufficient ? 'bg-cyan-500 text-black hover:bg-cyan-400 hover:scale-105 shadow-lg shadow-cyan-500/20' : 'bg-white/5 text-slate-600 cursor-not-allowed'}`}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <CornerDownLeft size={16} />}
          </button>
        </div>
        <div className="flex items-center justify-between px-1 text-[9px] font-medium tracking-wide">
            <span className="text-slate-600">Shift + Enter 换行</span>
            {input.trim() && (
              <span className={`inline-flex items-center gap-1 ${creditInsufficient ? 'text-red-400' : 'text-slate-500'}`}>
                <Coins size={10} />
                {isCreditLoading
                  ? '创作点数计算中…'
                  : creditSummary.enabled
                    ? `预计 ${creditSummary.totalCost} 创作点数 · 成功后扣除`
                    : '当前不计创作点数'}
              </span>
            )}
        </div>
      </div>
    </div>
  );
};
