import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeedreamPurposeControl } from '../../components/SeedreamPurposeControl';
import { SeedreamSourceBadge } from '../../components/SeedreamSourceBadge';
import { buildCandidates, buildVideoMaterialLibrary } from '../../utils/seedanceCandidateBuilder';
import { insertMention } from '../../utils/seedanceMedia';
import { baseParams } from '../utils/_fixtures/seedance';
const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }));
vi.mock('../../services/httpClient', () => ({ apiJson }));
afterEach(cleanup);
beforeEach(() => apiJson.mockReset());

describe('trusted text-to-image reference UI', () => {
  it('offers explicit purpose selection and explains zero-reference generation', () => {
    const change = vi.fn();
    const view = render(<SeedreamPurposeControl onChange={change} />);
    fireEvent.change(screen.getByLabelText('Seedream 素材用途'), { target: { value: 'character_four_view' } });
    expect(change).toHaveBeenCalledWith('character_four_view');
    view.rerender(<SeedreamPurposeControl value="character_four_view" onChange={change} />);
    expect(screen.getByText(/不发送任何参考图片/)).toBeInTheDocument();
  });
  it('only renders labels supplied by the verified server endpoint', async () => {
    apiJson.mockResolvedValue({ items: { file_original: { label: 'Seedream 5.0 Lite · 文生图', purpose: 'pure_background' }, file_i2i: {} } });
    render(<><SeedreamSourceBadge reference="file_original" /><SeedreamSourceBadge reference="file_i2i" /></>);
    await waitFor(() => expect(screen.getByText('Seedream 5.0 Lite · 文生图 · 纯背景')).toBeInTheDocument());
    expect(apiJson).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/文生图/)).toHaveLength(1);
  });
  it('does not label unregistered inline images', () => {
    render(<SeedreamSourceBadge reference="data:image/png;base64,AAAA" />);
    expect(apiJson).not.toHaveBeenCalled();
    expect(screen.queryByText(/文生图/)).not.toBeInTheDocument();
  });
  it('shows model plus generation method without granting portrait eligibility', async () => {
    apiJson.mockResolvedValue({ items: {
      file_i2i: { display_label: 'Seedream 5.0 Lite · 图生图', generation_mode: 'image_to_image' },
      file_other: { display_label: 'GPT Image 2 · 文生图', generation_mode: 'text_to_image' },
    } });
    render(<><SeedreamSourceBadge reference="file_i2i" /><SeedreamSourceBadge reference="file_other" /></>);
    await waitFor(() => expect(screen.getByText('Seedream 5.0 Lite · 图生图')).toBeInTheDocument());
    expect(screen.getByText('GPT Image 2 · 文生图')).toBeInTheDocument();
    expect(screen.queryByText(/已通过真人/)).not.toBeInTheDocument();
  });
  it('shows unknown history honestly and updates the label when the original changes', async () => {
    apiJson.mockResolvedValueOnce({ items: {} }).mockResolvedValueOnce({ items: { file_new: { display_label: 'Gemini 3.1 · 图生图' } } });
    const view = render(<SeedreamSourceBadge reference="file_old" />);
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(1));
    expect(screen.getByText('来源待确认')).toBeInTheDocument();
    view.rerender(<SeedreamSourceBadge reference="file_new" />);
    await waitFor(() => expect(screen.getByText('Gemini 3.1 · 图生图')).toBeInTheDocument());
  });
  it('keeps stable original file IDs through asset deduplication and mentions', () => {
    const url = '/storage/original.png';
    const library = buildVideoMaterialLibrary([{ assetId: 'asset_a', assetType: 'character', name: '人物', thumbnailUrl: url,
      entityFiles: [{ fileId: 'file_original', fileUrl: url, fileType: 'image' }] }]);
    const candidates = buildCandidates({ currentParams: baseParams(), materialLibrary: library,
      storyboardItems: [], historyVideos: [], userFiles: [] });
    const candidate = candidates.find(item => item.url === url)!;
    expect(candidate.fileId).toBe('file_original');
    const updated = insertMention(baseParams(), candidate);
    expect(updated.media_inputs[0].file_id).toBe('file_original');
    expect(updated.media_inputs[0].url).toBe(url);
  });
});
