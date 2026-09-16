import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ImageSourceBadgeOverlay } from '../../components/SeedreamSourceBadge';
import { ImagePreviewLightbox } from '../../components/ImagePreviewLightbox';
import { SeedanceMentionTokensRow } from '../../components/SeedanceMentionTokensRow';

const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }));
vi.mock('../../services/httpClient', () => ({ apiJson }));

let resize: () => void;
let width = 80;
let height = 80;
const disconnect = vi.fn();
const label = 'Seedream 5.0 Lite · 文生图';
beforeEach(() => {
  width = height = 80;
  disconnect.mockReset();
  apiJson.mockReset().mockResolvedValue({ items: { file_original: { display_label: label,
    portrait_reference_scopes: ['workflow'], portrait_reference_expires_at: Date.now() / 1000 + 60 } } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height }) as DOMRect);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('image source overlays without portrait stars', () => {
  it('leaves small thumbnails unobstructed without requesting portrait eligibility', async () => {
    const { container } = render(<div><ImageSourceBadgeOverlay reference="file_original" /></div>);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(apiJson).not.toHaveBeenCalled();
  });

  it('preserves large-preview source text and never restores stars after resizing', async () => {
    const view = render(<div><ImageSourceBadgeOverlay reference="file_original" /></div>);
    act(() => { width = 320; height = 180; resize(); });
    await screen.findByText(label);
    expect(screen.getByText(label)).toHaveClass('truncate');
    expect(apiJson).toHaveBeenCalledWith('/api/materials/seedream-source', expect.objectContaining({ body: JSON.stringify({ references: ['file_original'] }) }), '图片生成来源');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    act(() => { width = 120; height = 68; resize(); });
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    act(() => { width = height = 80; resize(); });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(apiJson).toHaveBeenCalledOnce();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('keeps the upper-left source label in the full-size lightbox', async () => {
    render(<ImagePreviewLightbox images={['file_original']} currentIndex={0} onIndexChange={vi.fn()} onClose={vi.fn()} />);
    const badge = await screen.findByText(label);
    expect(badge.parentElement).toHaveClass('top-6', 'left-6');
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'file_original');
  });

  it('keeps source text on hover, image preview and reference removal without a star', async () => {
    const onPreview = vi.fn(); const onChange = vi.fn();
    render(<SeedanceMentionTokensRow value={{ sub_model: 'mini', prompt: '图片1', reference_mode: 'reference', media_inputs: [{ kind: 'image', url: 'file_original' }] }} onChange={onChange} onPreview={onPreview} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    const preview = screen.getByTitle('点击预览 图片1');
    fireEvent.mouseEnter(preview.parentElement!);
    await screen.findByText(label);
    fireEvent.click(preview);
    expect(onPreview).toHaveBeenCalledWith('file_original', 'image');
    fireEvent.click(screen.getByRole('button', { name: '删除 图片1' }));
    expect(onChange.mock.calls[0][0].media_inputs).toEqual([]);
    expect(screen.queryByRole('img', { name: '可用于仿真人视频的 Seedream 文生图' })).not.toBeInTheDocument();
  });

  it('removes all star and legend entry points while preserving design image controls', () => {
    for (const file of ['../../pages/DesignPage.tsx', '../../pages/GenerationPage.tsx', '../../components/Header.tsx', '../../layouts/WorkflowLayout.tsx', '../../components/SeedanceMentionPromptEditor.tsx', '../../components/SeedanceMentionTokensRow.tsx', '../../components/SeedanceReferenceShelf.tsx', '../../components/SeedanceMultimodalPanel.tsx', '../../components/SeedreamSourceBadge.tsx', '../../../../studio/App.tsx', '../../layouts/GlobalToolsLayout.tsx', '../../components/ProjectMaterialPicker.tsx', '../../components/SeedanceAssetPickerModal.tsx']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source).not.toMatch(/PortraitReferenceStar|PortraitReferenceLegend|可用于仿真人视频的 Seedream 文生图/);
    }
    const design = readFileSync(resolve(__dirname, '../../pages/DesignPage.tsx'), 'utf8');
    const row = design.slice(design.indexOf('const AssetImageRow'), design.indexOf('const AssetImageRow') + 3500);
    expect(row).toContain('w-20 h-20');
    expect(row).toContain('onDeleteImage');
    expect(row).toContain('onLightbox');
    expect(row).not.toContain('SeedreamSourceBadge');
  });

  it('never renders provenance overlays on project or episode title covers', () => {
    for (const file of ['../../components/ProjectHub.tsx', '../../pages/EpisodeHubPage.tsx']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source).toContain('coverImageSrc(');
      expect(source).not.toContain('ImageSourceBadgeOverlay');
      expect(source).not.toContain('SeedreamSourceBadge');
    }
  });
});
