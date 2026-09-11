import React, { useState } from 'react';
import { X, Scissors, Layers, Loader2 } from 'lucide-react';

interface MattingModalProps {
    imageUrl: string;
    onClose: () => void;
    onSubmit: (mattingType: 'subject' | 'split', seed: number) => void;
    isProcessing?: boolean;
}





export const MattingModal: React.FC<MattingModalProps> = ({
    imageUrl,
    onClose,
    onSubmit,
    isProcessing = false
}) => {
    const [mattingType, setMattingType] = useState<'subject' | 'split'>('subject');
    const [seed, setSeed] = useState(-1);
    const [useRandomSeed, setUseRandomSeed] = useState(true);

    const handleSubmit = () => {
        const finalSeed = useRandomSeed ? -1 : seed;
        onSubmit(mattingType, finalSeed);
    };

    return (
        <div className="app-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-n900/50 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-label="抠图" className="app-modal-surface bg-n0 rounded-2xl border border-n40 shadow-bottom w-[500px] max-h-[90vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-n40">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-g50 rounded-lg">
                            <Scissors className="w-5 h-5 text-success" />
                        </div>
                        <h2 className="text-lg font-bold text-n800">抠图</h2>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="p-2 hover:bg-n20 rounded-lg transition-colors disabled:opacity-50"
                    >
                        <X className="w-5 h-5 text-n300" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">

                    <div className="aspect-video bg-black rounded-md overflow-hidden border border-n40">
                        <img
                            src={imageUrl}
                            alt="Preview"
                            className="w-full h-full object-contain"
                        />
                    </div>


                    <div className="space-y-3">
                        <label className="text-sm font-medium text-n700">抠图模式</label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={() => setMattingType('subject')}
                                disabled={isProcessing}
                                className={`p-4 rounded-md border-2 transition-all ${
                                    mattingType === 'subject'
                                        ? 'border-success bg-g50'
                                        : 'border-n40 bg-n0 hover:border-n40'
                                } disabled:opacity-50`}
                            >
                                <div className="flex flex-col items-center gap-2">
                                    <Scissors className={`w-6 h-6 ${mattingType === 'subject' ? 'text-success' : 'text-n300'}`} />
                                    <span className={`font-medium ${mattingType === 'subject' ? 'text-success' : 'text-n700'}`}>
                                        主体脱离
                                    </span>
                                    <span className="text-xs text-n100 text-center">
                                        抠出主体，透明背景
                                    </span>
                                </div>
                            </button>
                            <button
                                onClick={() => setMattingType('split')}
                                disabled={isProcessing}
                                className={`p-4 rounded-md border-2 transition-all ${
                                    mattingType === 'split'
                                        ? 'border-success bg-g50'
                                        : 'border-n40 bg-n0 hover:border-n40'
                                } disabled:opacity-50`}
                            >
                                <div className="flex flex-col items-center gap-2">
                                    <Layers className={`w-6 h-6 ${mattingType === 'split' ? 'text-success' : 'text-n300'}`} />
                                    <span className={`font-medium ${mattingType === 'split' ? 'text-success' : 'text-n700'}`}>
                                        主体背景分离
                                    </span>
                                    <span className="text-xs text-n100 text-center">
                                        分离为主体和背景两张图
                                    </span>
                                </div>
                            </button>
                        </div>
                    </div>


                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-n700">种子值</label>
                            <label className="flex items-center gap-2 text-sm text-n300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useRandomSeed}
                                    onChange={(e) => setUseRandomSeed(e.target.checked)}
                                    disabled={isProcessing}
                                    className="rounded border-n40 bg-n0 text-success focus:ring-green-500"
                                />
                                随机
                            </label>
                        </div>
                        {!useRandomSeed && (
                            <input
                                type="number"
                                value={seed}
                                onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
                                disabled={isProcessing}
                                className="w-full px-4 py-2 bg-n0 border border-n40 rounded-lg text-n800 focus:outline-none focus:border-green-500 disabled:opacity-50"
                                placeholder="输入种子值"
                            />
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-n40">
                    <button
                        onClick={onClose}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-n0 hover:bg-n20 text-n700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing}
                        className="px-6 py-2 bg-success hover:bg-success text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                处理中...
                            </>
                        ) : (
                            <>
                                <Scissors className="w-4 h-4" />
                                开始抠图
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MattingModal;
