
import React from 'react';
import { Loader2, Sparkles } from 'lucide-react';

interface SkeletonScreenProps {
  message?: string;
}





export const SkeletonScreen: React.FC<SkeletonScreenProps> = ({
  message = '正在加载数据...'
}) => {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-n20/50 backdrop-blur-sm">

      <div className="relative mb-6">
        <div className="absolute inset-0 bg-primary/20 blur-xl animate-pulse rounded-full"></div>
        <div className="relative bg-n0/80 border border-b75 p-4 rounded-md shadow-card flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
        <div className="absolute -top-1 -right-1">
          <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
        </div>
      </div>


      <p className="text-sm font-mono text-n300 tracking-wider animate-pulse">
        {message}
      </p>


      <div className="w-48 h-0.5 bg-n30 rounded-full mt-4 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-primary to-b200 w-1/3 animate-loading-shimmer rounded-full"></div>
      </div>

      <style>{`
        @keyframes loading-shimmer {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(200%); }
          100% { transform: translateX(-100%); }
        }
        .animate-loading-shimmer {
          animation: loading-shimmer 1.5s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};
