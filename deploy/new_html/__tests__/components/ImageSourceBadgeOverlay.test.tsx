import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ImageSourceBadgeOverlay, PortraitReferenceStar, PortraitReferenceLegend } from '../../components/SeedreamSourceBadge';

const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }));
vi.mock('../../services/httpClient', () => ({ apiJson }));

let resize: () => void;
let width = 80;
let height = 80;
const disconnect = vi.fn();
beforeEach(() => {
  width = height = 80;
  disconnect.mockReset();
  apiJson.mockReset().mockResolvedValue({ items: { file_original: { display_label: 'Gemini 3.1 Flash Image Preview · 文生图' } } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height }) as DOMRect);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('image source overlays', () => {
  it('does not obscure small thumbnails with text and requests eligibility only from the server', async () => {
    const { container } = render(<div><ImageSourceBadgeOverlay reference="file_original" /></div>);
    expect(container.textContent).toBe('');
    await waitFor(() => expect(apiJson).toHaveBeenCalledOnce());
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(JSON.parse(apiJson.mock.calls[0][1].body).include_portrait_eligibility).toBe(true);
  });

  it('shows a single-line compact label in large previews and hides it again when shrunk', async () => {
    const view = render(<div><ImageSourceBadgeOverlay reference="file_original" /></div>);
    act(() => { width = 320; height = 180; resize(); });
    await waitFor(() => expect(screen.getByText('Gemini · 文生图')).toBeInTheDocument());
    expect(screen.getByText('Gemini · 文生图')).toHaveClass('truncate');
    expect(apiJson).toHaveBeenCalledWith('/api/materials/seedream-source', expect.objectContaining({ body: JSON.stringify({ references: ['file_original'] }) }), '图片生成来源');
    act(() => { width = 120; height = 68; resize(); });
    expect(screen.queryByText('Gemini · 文生图')).not.toBeInTheDocument();
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('removes fixed small overlays while preserving preview and removal controls', () => {
    const design = readFileSync(resolve(__dirname, '../../pages/DesignPage.tsx'), 'utf8');
    const row = design.slice(design.indexOf('const AssetImageRow'), design.indexOf('const AssetImageRow') + 3500);
    expect(row).toContain('w-20 h-20');
    expect(row).not.toContain('SeedreamSourceBadge');
    expect(row).toContain('onDeleteImage');
    expect(row).toContain('<PortraitReferenceStar reference={img.fileId || img.rawUrl}');
    const panel = readFileSync(resolve(__dirname, '../../components/SeedanceMultimodalPanel.tsx'), 'utf8');
    expect(panel).not.toContain('<SeedreamSourceBadge reference={media.file_id || media.url}');
    expect(panel).toContain('预览${label}');
    expect(panel).toContain('删除${label}');
  });

  it('shows only a bottom-right star for a verified, unexpired original in the correct scope', async () => {
    apiJson.mockResolvedValue({ items: { file_original: { display_label: 'Seedream 5.0 Lite · 文生图',
      portrait_reference_scopes: ['workflow'], portrait_reference_expires_at: Date.now() / 1000 + 60 } } });
    const view = render(<div><ImageSourceBadgeOverlay reference="file_original" /></div>);
    const star = await screen.findByRole('img', { name: '可用于仿真人视频的 Seedream 文生图' });
    expect(star).toHaveClass('bottom-0.5', 'right-0.5', 'pointer-events-none');
    expect(view.container.textContent).toBe('');
    view.rerender(<div><ImageSourceBadgeOverlay reference="file_original" scope="studio" /></div>);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not infer stars from names and never carries a previous reference star to a replacement', async () => {
    apiJson.mockResolvedValueOnce({ items: { file_original: { portrait_reference_scopes: ['workflow'], portrait_reference_expires_at: Date.now() / 1000 + 60 } } })
      .mockResolvedValueOnce({ items: { file_other: { display_label: 'Seedream 5.0 Lite · 文生图' } } });
    const view = render(<PortraitReferenceStar reference="file_original" />);
    await screen.findByRole('img');
    view.rerender(<PortraitReferenceStar reference="file_other" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps stars off large and medium images even when the original is eligible', async () => {
    apiJson.mockResolvedValue({ items: { file_original: { display_label: 'Seedream 5.0 Lite · 文生图',
      portrait_reference_scopes: ['workflow'], portrait_reference_expires_at: Date.now() / 1000 + 60 } } });
    width = 320; height = 180;
    render(<div><ImageSourceBadgeOverlay reference="file_original" /></div>);
    await screen.findByText('Seedream 5.0 Lite · 文生图');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    act(() => { width = 120; height = 68; resize(); });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    act(() => { width = height = 80; resize(); });
    await screen.findByRole('img');
    expect(screen.queryByText('Seedream 5.0 Lite · 文生图')).not.toBeInTheDocument();
    act(() => { width = 320; height = 180; resize(); });
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not put thumbnail legends on canvas or global large-image tools', () => {
    for (const file of ['../../../../studio/App.tsx', '../../layouts/GlobalToolsLayout.tsx', '../../components/ProjectMaterialPicker.tsx', '../../components/SeedanceAssetPickerModal.tsx']) {
      expect(readFileSync(resolve(__dirname, file), 'utf8')).not.toContain('PortraitReferenceLegend');
    }
    const workflow = readFileSync(resolve(__dirname, '../../layouts/WorkflowLayout.tsx'), 'utf8');
    expect(workflow).toContain("['design', 'materials', 'storyboard'].includes(segment)");
  });

  it('never renders provenance overlays on project or episode title covers', () => {
    for (const file of ['../../components/ProjectHub.tsx', '../../pages/EpisodeHubPage.tsx']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8');
      expect(source).toContain('coverImageSrc(');
      expect(source).not.toContain('ImageSourceBadgeOverlay');
      expect(source).not.toContain('SeedreamSourceBadge');
    }
  });

  it('hides expired stars and explains the meaning without granting moderation approval', async () => {
    apiJson.mockResolvedValue({ items: { file_original: { portrait_reference_scopes: ['workflow'], portrait_reference_expires_at: Date.now() / 1000 - 1 } } });
    render(<><PortraitReferenceStar reference="file_original" /><PortraitReferenceLegend /></>);
    await waitFor(() => expect(apiJson).toHaveBeenCalledOnce());
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('可用于仿真人视频的 Seedream 文生图')).toHaveAttribute('title', expect.stringContaining('上游审核'));
  });
});
