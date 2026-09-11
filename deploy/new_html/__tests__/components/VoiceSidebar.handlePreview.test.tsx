import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@runtime/audioGenerationService', () => ({


  minimaxTTSSync: vi.fn().mockResolvedValue({
    success: true,
    audio_url: '/storage/audio/preview_x.mp3',
    file_id: 'fid-99',
    file_url: '/storage/audio/preview_x.mp3',
    duration_ms: 1500,
  }),
  minimaxTTS: vi.fn(),
  minimaxVoiceDesign: vi.fn(),
  minimaxFileUpload: vi.fn(),
  minimaxVoiceClone: vi.fn(),
  createCharacterVoice: vi.fn(),
  updateCharacterVoice: vi.fn(),
  deleteCharacterVoice: vi.fn(),
}));



vi.mock('../../services/ttsTaskPoller', () => ({
  pollTtsTaskUntilDone: vi.fn(),
  TtsTimeoutError: class extends Error {},
}));

// Import AFTER vi.mock so the component picks up the mocked modules.

import { VoiceDrawer } from '../../components/audio/VoiceSidebar';
import { clearVoicePreview } from '../../utils/voicePreviewCache';

const MOCK_ROLE_NO_VOICE = { name: '测试角色', voice: null, asset: null } as any;

const baseProps = {
  roleName: '测试角色',
  role: MOCK_ROLE_NO_VOICE,
  projectId: 'p1',
  onClose: () => {},
  onSaved: async () => {},
};

describe('VoiceSidebar.handlePreview — fast-path 同步 (2026-05-25)', () => {
  beforeEach(() => {
    vi.clearAllMocks();



    clearVoicePreview();
    localStorage.clear();
  });

  it('点击试听后调 minimaxTTSSync 一次拿到 audio_url（不再轮询）', async () => {
    const { minimaxTTSSync, minimaxTTS } = await import('@runtime/audioGenerationService');
    const { pollTtsTaskUntilDone } = await import('../../services/ttsTaskPoller');

    render(<VoiceDrawer {...baseProps} open />);
    fireEvent.click(screen.getByRole('button', { name: /试听/ }));

    await waitFor(() => {
      expect(minimaxTTSSync).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.any(String), voice_id: expect.any(String) }),
        expect.any(AbortSignal),
      );
    });


    expect(minimaxTTS).not.toHaveBeenCalled();
    expect(pollTtsTaskUntilDone).not.toHaveBeenCalled();


    await waitFor(() => {
      const audio = document.querySelector('audio') as HTMLAudioElement | null;
      expect(audio).toBeTruthy();
      expect(audio!.src).toContain('/storage/audio/preview_x.mp3');
    });
  });

  it('Drawer 关闭时 AbortController 必须取消进行中的 fast-path 请求', async () => {
    const { minimaxTTSSync } = await import('@runtime/audioGenerationService');
    let abortSignal: AbortSignal | undefined;
    (minimaxTTSSync as any).mockImplementation((_p: any, signal: AbortSignal) => {
      abortSignal = signal;
      return new Promise(() => {});
    });

    const { rerender } = render(<VoiceDrawer {...baseProps} open />);
    fireEvent.click(screen.getByRole('button', { name: /试听/ }));
    await waitFor(() => expect(abortSignal).toBeDefined());

    rerender(<VoiceDrawer {...baseProps} open={false} />);
    expect(abortSignal?.aborted).toBe(true);
  });

  it('克隆模式点击生成试听会上传音频并调用 voice-clone', async () => {
    const { minimaxFileUpload, minimaxVoiceClone, minimaxTTSSync } = await import('@runtime/audioGenerationService');
    (minimaxFileUpload as any).mockResolvedValue({ success: true, file_id: '123456789' });
    (minimaxVoiceClone as any).mockResolvedValue({
      success: true,
      voice_id: 'clone_test_123456',
      audio_url: '/storage/audio/voice_clone_preview.mp3',
    });

    render(<VoiceDrawer {...baseProps} open />);
    fireEvent.click(screen.getByRole('button', { name: /声音克隆/ }));

    const file = new File(['voice-bytes'], 'voice.mp3', {
      type: 'audio/mpeg',
      lastModified: 123,
    });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /生成试听/ }));

    await waitFor(() => {
      expect(minimaxFileUpload).toHaveBeenCalledWith(file, 'voice_clone');
      expect(minimaxVoiceClone).toHaveBeenCalledWith(
        '123456789',
        undefined,
        expect.any(String),
        '测试角色',
      );
    });
    expect(minimaxTTSSync).not.toHaveBeenCalled();

    await waitFor(() => {
      const audio = document.querySelector('audio') as HTMLAudioElement | null;
      expect(audio).toBeTruthy();
      expect(audio!.src).toContain('/storage/audio/voice_clone_preview.mp3');
    });
  });
});
