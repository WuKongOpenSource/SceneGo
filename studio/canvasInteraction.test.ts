import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(__dirname, 'App.tsx'), 'utf-8');
const nodeSource = readFileSync(resolve(__dirname, 'components/Node.tsx'), 'utf-8');
const videoModulesSource = readFileSync(resolve(__dirname, 'components/VideoNodeModules.tsx'), 'utf-8');
const stylesSource = readFileSync(resolve(__dirname, 'styles.css'), 'utf-8').replace(/\r\n/g, '\n');

describe('Studio canvas interaction contracts', () => {
  it('uses held Space as an actual canvas-pan gesture, including over child nodes', () => {
    expect(appSource).toContain('isSpacePressedRef.current = true');
    expect(appSource).toContain('if (e.button !== 0 || !isSpacePressedRef.current) return');
    expect(appSource).toContain('onMouseDownCapture={handleCanvasMouseDownCapture}');
    expect(appSource).toContain("window.addEventListener('blur', handleWindowBlur)");
    expect(appSource).toContain('setIsDraggingCanvas(false)');
  });

  it('keeps compact node controls and action labels on one line', () => {
    expect(nodeSource).toContain('className="max-w-[132px]"');
    expect(nodeSource).toContain('ariaLabel="选择画布模型"');
    expect(nodeSource).toContain('flex shrink-0 items-center justify-center gap-2 whitespace-nowrap');
    expect(nodeSource).toContain('<span className="whitespace-nowrap">');
    expect(videoModulesSource).toContain('flex min-w-max items-center gap-0.5');
    expect(videoModulesSource).toContain('flex shrink-0 items-center gap-1 whitespace-nowrap px-1.5');
    expect(nodeSource).toContain('studio-node-mode-strip w-full overflow-x-auto');
  });

  it('keeps the Space-pan instruction visible beside the canvas controls', () => {
    expect(appSource).toContain('studio-canvas-pan-hint pointer-events-none');
    expect(appSource).toContain('按住空格拖动画布');
    expect(appSource).toContain('按住空格并拖动鼠标可移动画布');
  });

  it('renders readable canvas text without scaling the whole DOM as a bitmap-like layer', () => {
    expect(appSource).toContain('const MIN_CANVAS_SCALE = 0.2');
    expect(appSource).toContain('Math.round(value * 100) === 100 ? 1 : value');
    expect(appSource).toContain('snapCanvasScale(Math.min(Math.max(MIN_CANVAS_SCALE');
    expect(appSource).toContain("left: Math.round(pan.x), top: Math.round(pan.y)");
    expect(appSource).toContain("style={{ zoom: scale === 1 ? undefined : scale, width: '100%', height: '100%' }}");
    expect(appSource).not.toContain('translate3d');
    expect(appSource).not.toContain('scale(${scale})');
    expect(nodeSource).toContain('left: Math.round(node.x), top: Math.round(node.y)');
    expect(nodeSource).not.toContain('backdropFilter:');
    expect(nodeSource).not.toContain('left-1/2 -translate-x-1/2');
    expect(nodeSource).not.toContain('translate-y-0 scale-100');
    expect(videoModulesSource).not.toContain('backdrop-blur-md');
    expect(stylesSource).toContain('-webkit-font-smoothing: auto');
  });

  it('uses a clean opaque dark canvas without the noise texture', () => {
    expect(stylesSource).toContain('--studio-canvas-background: #111216');
    expect(stylesSource).toContain('--studio-node-surface: #1B1C22');
    expect(stylesSource).toContain('.noise-bg {\n  background: transparent;');
  });
});
