import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const studioRoot = resolve(__dirname);

function readStudioFile(path: string): string {
  return readFileSync(resolve(studioRoot, path), 'utf8');
}

describe('Studio light canvas element theme styles', () => {
  it('defines light node surfaces and dark-mode overrides', () => {
    const css = readStudioFile('styles.css');

    expect(css).toContain('--studio-node-surface: rgba(255, 255, 255');
    expect(css).toContain('--studio-node-panel: rgba(255, 255, 255');
    expect(css).toContain('--studio-node-media-bg: #F0F0EC');
    expect(css).toContain('.studio-canvas[data-studio-theme="dark"]');
    expect(css).toContain('--studio-node-surface: #1B1C22');
    expect(css).toContain('--studio-node-media-bg: #1E1E26');
  });

  it('keeps canvas boxes wired to theme classes instead of inline dark surfaces', () => {
    const node = readStudioFile('components/Node.tsx');
    const app = readStudioFile('App.tsx');
    const videoNodeModules = readStudioFile('components/VideoNodeModules.tsx');

    expect(node).toContain('className={`studio-node absolute');
    expect(node).toContain('data-selected={isSelected ?');
    expect(node).toContain('studio-node-inner-box');
    expect(node).toContain('studio-node-control-panel');
    expect(node).toContain('studio-node-media-frame');
    expect(node).not.toContain("background: isSelected ? 'rgba(28, 28, 30");

    expect(app).toContain('studio-node-menu fixed');
    expect(app).toContain('studio-canvas-toolbar absolute');
    expect(videoNodeModules).toContain('studio-node-mode-button');
  });

  it('switches only the free-canvas lockup between approved light and dark assets', () => {
    const app = readStudioFile('App.tsx');

    expect(app).toContain("const isDarkCanvas = canvasTheme === 'dark'");
    expect(app).toContain("'/static/branding/chuangju-logo-on-dark.svg?v=20260824-chuangju-v1'");
    expect(app).toContain("'/static/branding/chuangju-logo-on-light.svg?v=20260824-chuangju-v1'");
    expect(app).toContain('alt="创剧"');
  });

  it('uses the same first-and-last-frame label in every Studio entry point', () => {
    const app = readStudioFile('App.tsx');
    const videoNodeModules = readStudioFile('components/VideoNodeModules.tsx');
    const visibleCopy = `${app}\n${videoNodeModules}`;

    expect(app).toContain('>首尾帧</span>');
    expect(videoNodeModules).toContain("title: '首尾帧 (FrameWeaver)'");
    expect(visibleCopy).not.toMatch(/收尾插帧|首尾插帧/);
  });
});
