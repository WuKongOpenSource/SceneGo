import React, { useState, useRef, useEffect } from 'react';
import { X, Check, Crop, Move } from 'lucide-react';

interface ImageCropperProps {
  imageSrc: string;
  onConfirm: (croppedBase64: string) => void;
  onCancel: () => void;
}

const RATIOS = [
    { label: '自由', value: null },
    { label: '16:9', value: 16/9 },
    { label: '9:16', value: 9/16 },
    { label: '4:3', value: 4/3 },
    { label: '3:4', value: 3/4 },
    { label: '1:1', value: 1 },
];

type InteractionType = 'create' | 'move' | 'resize';
type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export const ImageCropper: React.FC<ImageCropperProps> = ({ imageSrc, onConfirm, onCancel }) => {
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null); // null means free

  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [interaction, setInteraction] = useState<{
      type: InteractionType;
      handle?: ResizeHandle;
      startPos: { x: number; y: number };
      startCrop: CropRect | null;
  }>({ type: 'create', startPos: { x: 0, y: 0 }, startCrop: null });

  const getRelativePos = (e: React.MouseEvent | MouseEvent) => {
    if (!imgRef.current) return { x: 0, y: 0 };
    const rect = imgRef.current.getBoundingClientRect();
    return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        rawX: e.clientX,
        rawY: e.clientY
    };
  };

  const clampRect = (rect: CropRect, maxW: number, maxH: number): CropRect => {
      let { x, y, width, height } = rect;

      if (x < 0) x = 0;
      if (y < 0) y = 0;
      if (width > maxW) width = maxW;
      if (height > maxH) height = maxH;

      if (x + width > maxW) x = maxW - width;
      if (y + height > maxH) y = maxH - height;

      return { x, y, width, height };
  };

  const handleMouseDown = (e: React.MouseEvent, type: InteractionType, handle?: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();

    const pos = getRelativePos(e);

    // Starting outside the current crop creates a new selection.
    let startCrop = crop;
    if (type === 'create') {
        startCrop = { x: pos.x, y: pos.y, width: 0, height: 0 };
        setCrop(startCrop);
    }

    setInteraction({
        type,
        handle,
        startPos: { x: pos.x, y: pos.y },
        startCrop: startCrop ? { ...startCrop } : null
    });
  };

  const handleGlobalMouseMove = (e: MouseEvent) => {
    if (!imgRef.current || !interaction.startCrop) return;

    if (e.buttons === 0) {
        setInteraction(prev => ({ ...prev, type: 'create' })); // Reset to default
        return;
    }

    const pos = getRelativePos(e);
    const maxW = imgRef.current.width;
    const maxH = imgRef.current.height;
    const { startPos, startCrop } = interaction;

    if (interaction.type === 'move') {
        const dx = pos.x - startPos.x;
        const dy = pos.y - startPos.y;

        const newRect = {
            ...startCrop,
            x: startCrop.x + dx,
            y: startCrop.y + dy
        };

        setCrop(clampRect(newRect, maxW, maxH));
    }
    else if (interaction.type === 'create') {
        let currentX = Math.max(0, Math.min(pos.x, maxW));
        let currentY = Math.max(0, Math.min(pos.y, maxH));

        const anchorX = startCrop.x;
        const anchorY = startCrop.y;

        let width = Math.abs(currentX - anchorX);
        let height = Math.abs(currentY - anchorY);

        if (aspectRatio) {
            if (width / height > aspectRatio) {
                height = width / aspectRatio;
            } else {
                width = height * aspectRatio;
            }
        }

        const dirX = currentX >= anchorX ? 1 : -1;
        const dirY = currentY >= anchorY ? 1 : -1;

        let x = anchorX + (dirX === -1 ? -width : 0);
        let y = anchorY + (dirY === -1 ? -height : 0);

        if (x < 0) { x = 0; if (aspectRatio) height = width/aspectRatio; }
        if (y < 0) { y = 0; if (aspectRatio) width = height*aspectRatio; }
        if (x + width > maxW) {
             if (dirX === 1) width = maxW - x;
             else x = maxW - width;
             if (aspectRatio) height = width / aspectRatio;
        }
        if (y + height > maxH) {
             if (dirY === 1) height = maxH - y;
             else y = maxH - height;
             if (aspectRatio) width = height * aspectRatio;
        }

        setCrop({ x, y, width, height });
    }
    else if (interaction.type === 'resize' && interaction.handle) {
        let anchorX = 0, anchorY = 0;
        switch (interaction.handle) {
            case 'nw': anchorX = startCrop.x + startCrop.width; anchorY = startCrop.y + startCrop.height; break;
            case 'ne': anchorX = startCrop.x; anchorY = startCrop.y + startCrop.height; break;
            case 'sw': anchorX = startCrop.x + startCrop.width; anchorY = startCrop.y; break;
            case 'se': anchorX = startCrop.x; anchorY = startCrop.y; break;
        }

        const currentX = Math.max(0, Math.min(pos.x, maxW));
        const currentY = Math.max(0, Math.min(pos.y, maxH));

        let newW = Math.abs(currentX - anchorX);
        let newH = Math.abs(currentY - anchorY);

        if (aspectRatio) {
            // Width drives corner resizing unless that would exceed vertical bounds.
            newH = newW / aspectRatio;

            const isNorth = interaction.handle.includes('n');
            const projectedY = isNorth ? anchorY - newH : anchorY + newH;

            if (projectedY < 0 || projectedY > maxH) {
                newH = Math.abs(currentY - anchorY); // Revert to raw Y
                newW = newH * aspectRatio;
            }
        }

        let newX = interaction.handle.includes('w') ? anchorX - newW : anchorX;
        let newY = interaction.handle.includes('n') ? anchorY - newH : anchorY;

        if (newX < 0) newX = 0;
        if (newY < 0) newY = 0;
        if (newX + newW > maxW) newW = maxW - newX;
        if (newY + newH > maxH) newH = maxH - newY;

        // Bounds take precedence over exact aspect ratio at the image edge.

        setCrop({ x: newX, y: newY, width: newW, height: newH });
    }
  };

  const handleGlobalMouseUp = () => {
      setInteraction(prev => ({ ...prev, type: 'create', startCrop: null }));
  };

  useEffect(() => {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
          window.removeEventListener('mousemove', handleGlobalMouseMove);
          window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
  }, [interaction]);

  useEffect(() => {
      if (crop && aspectRatio && crop.width > 0 && crop.height > 0) {
          const centerX = crop.x + crop.width / 2;
          const centerY = crop.y + crop.height / 2;

          let newW = crop.width;
          let newH = newW / aspectRatio;

          if (newH > (imgRef.current?.height || 0)) {
              newH = imgRef.current?.height || 0;
              newW = newH * aspectRatio;
          }

          let newX = centerX - newW / 2;
          let newY = centerY - newH / 2;

          if (imgRef.current) {
             const rect = clampRect({ x: newX, y: newY, width: newW, height: newH }, imgRef.current.width, imgRef.current.height);
             setCrop(rect);
          }
      }
  }, [aspectRatio]);

  const handleConfirm = () => {
    if (!imgRef.current || !crop || crop.width === 0) { onConfirm(imageSrc); return; }
    const canvas = document.createElement('canvas');
    const sx = imgRef.current.naturalWidth / imgRef.current.width;
    const sy = imgRef.current.naturalHeight / imgRef.current.height;

    canvas.width = crop.width * sx;
    canvas.height = crop.height * sy;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(imgRef.current, crop.x * sx, crop.y * sy, crop.width * sx, crop.height * sy, 0, 0, crop.width * sx, crop.height * sy);
      onConfirm(canvas.toDataURL('image/png'));
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex flex-col items-center justify-center animate-in fade-in duration-300">

      {/* Top Bar: Title */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <div className="bg-[#2c2c2e]/90 backdrop-blur-md px-6 py-2.5 rounded-full border border-white/10 text-slate-300 text-xs font-medium flex items-center gap-2 shadow-2xl">
            <Crop size={14} className="text-cyan-400" />
            <span>局部分镜截取</span>
            <SeedreamSourceBadge reference={imageSrc} />
        </div>
        <span className="text-[10px] text-slate-500 font-medium">拖拽四角调整 • 按住中间移动</span>
      </div>

      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        className="relative max-w-[85vw] max-h-[65vh] border border-white/10 shadow-2xl rounded-lg overflow-hidden select-none bg-black/50 group"
        style={{ cursor: 'crosshair' }}
        onMouseDown={(e) => handleMouseDown(e, 'create')}
      >
        <img ref={imgRef} src={imageSrc} className="max-w-full max-h-[65vh] object-contain block opacity-50" draggable={false} />

        {/* Active Crop Area */}
        {crop && crop.width > 0 && (
            <div className="absolute" style={{ left: crop.x, top: crop.y, width: crop.width, height: crop.height }}>
                 {/* 1. Clear Image View Inside */}
                 <div className="absolute inset-0 overflow-hidden">
                    <img
                        src={imageSrc}
                        className="absolute max-w-none"
                        style={{
                            width: imgRef.current?.width,
                            height: imgRef.current?.height,
                            left: -crop.x,
                            top: -crop.y,
                            opacity: 1
                        }}
                    />
                 </div>

                 {/* 2. Dark Overlay Outline (Outside shadow trick) */}
                 <div className="absolute inset-0 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)] pointer-events-none" />

                 {/* 3. Grid & Border */}
                 <div className="absolute inset-0 border-2 border-cyan-400 z-10 pointer-events-none">
                     <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
                        <div className="border-r border-white/50"/><div className="border-r border-white/50"/><div className="col-span-3 border-b border-white/50 -mt-[33%]"/><div className="col-span-3 border-b border-white/50 mt-[33%]"/>
                     </div>
                 </div>

                 {/* 4. Move Handler (Invisible Center) */}
                 <div
                    className="absolute inset-0 z-20 cursor-move group/move"
                    onMouseDown={(e) => handleMouseDown(e, 'move')}
                 >
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/move:opacity-100 transition-opacity duration-200">
                        <div className="bg-black/50 p-2 rounded-full backdrop-blur-sm">
                            <Move size={16} className="text-white" />
                        </div>
                    </div>
                 </div>

                 {/* 5. Resize Handles (Corners) */}
                 {['nw', 'ne', 'sw', 'se'].map((h) => (
                     <div
                        key={h}
                        className={`
                            absolute w-4 h-4 bg-white border-2 border-cyan-500 rounded-full z-30 shadow-sm
                            hover:scale-125 transition-transform
                        `}
                        style={{
                            cursor: `${h}-resize`,
                            left: h.includes('w') ? -8 : 'auto',
                            right: h.includes('e') ? -8 : 'auto',
                            top: h.includes('n') ? -8 : 'auto',
                            bottom: h.includes('s') ? -8 : 'auto',
                        }}
                        onMouseDown={(e) => handleMouseDown(e, 'resize', h as ResizeHandle)}
                     />
                 ))}

                 {/* Size Label */}
                 <div className="absolute -top-7 left-0 flex gap-2 z-20 pointer-events-none">
                    <div className="bg-cyan-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-sm shadow-md">
                        {Math.round(crop.width)} × {Math.round(crop.height)}
                    </div>
                    {aspectRatio && (
                        <div className="bg-black/60 text-cyan-400 border border-cyan-500/30 text-[9px] font-bold px-1.5 py-0.5 rounded-sm shadow-md">
                           {RATIOS.find(r => r.value === aspectRatio)?.label}
                        </div>
                    )}
                </div>
            </div>
        )}
      </div>

      {/* Bottom Bar: Aspect Ratios & Actions */}
      <div className="flex flex-col items-center gap-6 mt-8 w-full max-w-2xl px-4">

        {/* Aspect Ratio Selector */}
        <div className="flex items-center gap-2 p-1 bg-[#1c1c1e] border border-white/10 rounded-xl shadow-lg overflow-x-auto custom-scrollbar max-w-full">
            {RATIOS.map(ratio => (
                <button
                    key={ratio.label}
                    onClick={() => setAspectRatio(ratio.value)}
                    className={`
                        relative px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap
                        ${aspectRatio === ratio.value
                            ? 'bg-cyan-500 text-black shadow-md scale-105 z-10'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }
                    `}
                >
                    {ratio.label}
                </button>
            ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4">
            <button onClick={onCancel} className="px-6 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-white text-xs font-medium transition-colors border border-white/5">
                取消
            </button>
            <button
                onClick={handleConfirm}
                disabled={!crop || crop.width === 0}
                className={`
                    px-8 py-2.5 rounded-full text-xs font-bold shadow-lg transition-all flex items-center gap-2
                    ${(!crop || crop.width === 0)
                        ? 'bg-white/5 text-slate-500 cursor-not-allowed'
                        : 'bg-cyan-500 hover:bg-cyan-400 text-black hover:scale-105 shadow-cyan-500/20'
                    }
                `}
            >
                <Check size={14}/> 确认裁剪
            </button>
        </div>
      </div>
    </div>
  );
};
import { SeedreamSourceBadge } from '@app/components/SeedreamSourceBadge';
