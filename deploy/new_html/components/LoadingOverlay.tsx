
import React, { useEffect, useState } from 'react';
import { Loader2, Cpu, Zap, Database, Layers, Sparkles } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export const LoadingOverlay: React.FC = () => {
  const [message, setMessage] = useState('Initializing Studio...');
  
  const messages = [
    "加载工作台...",
    "渲染界面...",
    "连接数据库...",
    "同步分镜数据...",
    "加载神经模型...",
    "获取角色资源...",
    "创建标准矩阵..."
  ];

  useEffect(() => {
    // Cycle through messages rapidly for a "hacker/tech" feel
    const interval = setInterval(() => {
      const randomMsg = messages[Math.floor(Math.random() * messages.length)];
      setMessage(randomMsg);
    }, 250);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center bg-n20 text-n800 overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary-light via-n20 to-n20 z-0"></div>
      <div className="absolute inset-0 z-0 opacity-20" 
           style={{ backgroundImage: 'radial-gradient(circle, #5B49F0 1px, transparent 1px)', backgroundSize: '30px 30px' }}>
      </div>

      <div className="relative z-10 flex flex-col items-center">
        {/* Central Logo/Spinner */}
        <div className="relative mb-8">
            <div className="absolute inset-0 bg-primary blur-xl opacity-20 animate-pulse rounded-full"></div>
            <div className="relative bg-n0 border border-b75 p-5 rounded-2xl shadow-bottom flex items-center justify-center">
                <BrandLogo variant="mark" className="h-14 w-14" />
                <Loader2 className="absolute -inset-2 h-[72px] w-[72px] text-primary/35 animate-spin" />
                <div className="absolute -top-2 -right-2">
                    <Sparkles className="w-6 h-6 text-cyan-400 animate-bounce" />
                </div>
            </div>
            
            {/* Orbiting Icons */}
            <div className="absolute inset-0 animate-spin-slow pointer-events-none">
                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-n0 p-1.5 rounded-full border border-n40">
                    <Cpu className="w-4 h-4 text-success" />
                </div>
                <div className="absolute top-1/2 -right-10 -translate-y-1/2 bg-n0 p-1.5 rounded-full border border-n40">
                    <Database className="w-4 h-4 text-b400" />
                </div>
                <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-n0 p-1.5 rounded-full border border-n40">
                    <Layers className="w-4 h-4 text-primary" />
                </div>
                <div className="absolute top-1/2 -left-10 -translate-y-1/2 bg-n0 p-1.5 rounded-full border border-n40">
                    <Zap className="w-4 h-4 text-warning" />
                </div>
            </div>
        </div>

        {/* Text */}
        <BrandLogo className="mb-2 h-8 w-auto max-w-[132px]" />
        
        <div className="h-6 flex items-center justify-center">
             <p className="text-xs font-mono text-n100 uppercase tracking-widest animate-pulse">
                {message}
            </p>
        </div>

        {/* Progress Bar Line */}
        <div className="w-64 h-1 bg-n30 rounded-full mt-6 overflow-hidden">
            <div className="h-full bg-primary w-1/3 animate-loading-bar rounded-full"></div>
        </div>
      </div>
      
      <style>{`
        @keyframes spin-slow {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        @keyframes loading-bar {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(100%); width: 50%; }
            100% { transform: translateX(-100%); }
        }
        .animate-spin-slow {
            animation: spin-slow 8s linear infinite;
        }
        .animate-loading-bar {
            animation: loading-bar 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};
