



import React, { useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { ArrowLeft, Wand2, Volume2, ArrowUpCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const PostProcessPage: React.FC = () => {
    const { projectId, project } = useProject();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'upscale' | 'voice'>('upscale');

    return (
        <div className="h-screen bg-n0 text-n800 flex flex-col">

            <div className="h-12 bg-n0 border-b border-n40 flex items-center px-4 gap-4 flex-shrink-0">
                <button
                    onClick={() => navigate(`/projects/${projectId}/episodes`)}
                    className="flex items-center gap-1 text-sm text-n300 hover:text-n800"
                >
                    <ArrowLeft className="w-4 h-4" />
                    返回视频
                </button>
                <div className="w-px h-6 bg-n0" />
                <h2 className="text-sm font-medium">
                    视频后处理 — {project?.projectName || ''}
                </h2>
            </div>


            <div className="flex border-b border-n40">
                <button
                    onClick={() => setActiveTab('upscale')}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'upscale'
                            ? 'border-primary text-n800'
                            : 'border-transparent text-n300 hover:text-n700'
                    }`}
                >
                    <ArrowUpCircle className="w-4 h-4" />
                    视频放大
                </button>
                <button
                    onClick={() => setActiveTab('voice')}
                    className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'voice'
                            ? 'border-primary text-n800'
                            : 'border-transparent text-n300 hover:text-n700'
                    }`}
                >
                    <Volume2 className="w-4 h-4" />
                    配音
                </button>
            </div>


            <div className="flex-1 overflow-auto p-6">
                {activeTab === 'upscale' ? (
                    <div data-testid="post-process-content" className="mx-auto w-full max-w-[1680px]">
                        <div className="bg-n0 rounded-md p-8 border border-n40 text-center shadow-card">
                            <ArrowUpCircle className="w-16 h-16 text-n100 mx-auto mb-4" />
                            <h3 className="text-lg font-medium mb-2">视频放大</h3>
                            <p className="text-sm text-n300 mb-6">
                                选择已生成的视频，使用 AI 将其放大至更高分辨率
                            </p>
                            <p className="text-xs text-n100">
                                功能开发中，将从视频页面的放大功能迁移至此
                            </p>
                        </div>
                    </div>
                ) : (
                    <div data-testid="post-process-content" className="mx-auto w-full max-w-[1680px]">
                        <div className="bg-n0 rounded-md p-8 border border-n40 text-center shadow-card">
                            <Volume2 className="w-16 h-16 text-n100 mx-auto mb-4" />
                            <h3 className="text-lg font-medium mb-2">配音</h3>
                            <p className="text-sm text-n300 mb-6">
                                为视频添加 AI 语音旁白或角色对话配音
                            </p>
                            <p className="text-xs text-n100">
                                功能开发中，将从视频页面的配音功能迁移至此
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PostProcessPage;
