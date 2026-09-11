import { apiJson } from '../services/httpClient';
import { localConnectorUnavailable } from './runtimeUnavailable';

export async function createAudioTrack(episodeId: string, data: any) {
  return apiJson<any>(`/api/episodes/${episodeId}/audio-tracks`, { method: 'POST', body: JSON.stringify(data) }, 'createAudioTrack');
}

export async function updateAudioTrack(trackId: string, data: Record<string, any>) {
  return apiJson<any>(`/api/audio-tracks/${trackId}`, { method: 'PUT', body: JSON.stringify(data) }, 'updateAudioTrack');
}

export async function deleteAudioTrack(trackId: string) {
  return apiJson<any>(`/api/audio-tracks/${trackId}`, { method: 'DELETE' }, 'deleteAudioTrack');
}

export async function generateSpeech(data: Record<string, any>) {
  return apiJson<any>('/api/audio/generate-speech', { method: 'POST', body: JSON.stringify(data) }, 'generateSpeech');
}
export async function generateSFX(data: { description: string }) {
  return apiJson<any>('/api/audio/generate-sfx', { method: 'POST', body: JSON.stringify(data) }, 'generateSFX');
}

export async function generateMusic(data: { description: string; duration_ms?: number }) {
  return apiJson<any>('/api/audio/generate-music', { method: 'POST', body: JSON.stringify(data) }, 'generateMusic');
}

export async function createCharacterVoice(data: Record<string, any>) {
  return apiJson<any>('/api/character-voices', { method: 'POST', body: JSON.stringify(data) }, 'createCharacterVoice');
}

export async function updateCharacterVoice(voiceId: string, data: Record<string, any>) {
  return apiJson<any>(`/api/character-voices/${voiceId}`, { method: 'PUT', body: JSON.stringify(data) }, 'updateCharacterVoice');
}

export async function deleteCharacterVoice(voiceId: string) {
  return apiJson<any>(`/api/character-voices/${voiceId}`, { method: 'DELETE' }, 'deleteCharacterVoice');
}

export async function minimaxVoiceDesign(prompt: string, previewText: string, voiceId?: string) {
  return apiJson<any>('/api/minimax/voice-design', { method: 'POST', body: JSON.stringify({ prompt, preview_text: previewText, voice_id: voiceId }) }, 'minimaxVoiceDesign');
}

export async function minimaxVoiceClone(fileId: string, voiceId?: string, demoText = '你好，这是一段测试语音。', voiceIdPrefix = 'clone') {
  return apiJson<any>('/api/minimax/voice-clone', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId, voice_id: voiceId, demo_text: demoText, voice_id_prefix: voiceIdPrefix }),
  }, 'minimaxVoiceClone');
}

export async function minimaxListVoices(voiceType = 'all') {
  return apiJson<any>(`/api/minimax/voices?voice_type=${encodeURIComponent(voiceType)}`, { method: 'GET' }, 'minimaxListVoices');
}

export async function minimaxGetVoice(voiceId: string) {
  return apiJson<any>(`/api/minimax/voices/${voiceId}`, { method: 'GET' }, 'minimaxGetVoice');
}

export async function minimaxDeleteVoice(voiceId: string, voiceType = 'voice_cloning') {
  return apiJson<any>(`/api/minimax/voices/${voiceId}?voice_type=${encodeURIComponent(voiceType)}`, { method: 'DELETE' }, 'minimaxDeleteVoice');
}

export async function minimaxTTS(data: Record<string, any>, signal?: AbortSignal): Promise<any> {
  return apiJson<any>('/api/minimax/tts', { method: 'POST', body: JSON.stringify(data), signal }, 'minimaxTTS');
}

export async function minimaxTTSSync(data: Record<string, any>, signal?: AbortSignal): Promise<any> {
  return apiJson<any>('/api/minimax/tts/sync', { method: 'POST', body: JSON.stringify(data), signal }, 'minimaxTTSSync');
}

export async function minimaxMusic(lyrics = '', referVoice = '', referInstrumental = '') {
  return apiJson<any>('/api/minimax/music', { method: 'POST', body: JSON.stringify({ lyrics, refer_voice: referVoice, refer_instrumental: referInstrumental }) }, 'minimaxMusic');
}

export type LocalMiniMaxMusic3Request = {
  caption: string;
  lyrics?: string;
  durationSeconds?: number;
  seed?: number;
  projectId?: string;
  episodeId: string;
};

// Disabled connectors still expose the shared caller contract; they never fake success.
export const submitLocalMiniMaxMusic3 = async (
  _data: LocalMiniMaxMusic3Request,
): Promise<{ task_id: string; tasks_ahead?: number; estimated_wait_seconds?: number }> => localConnectorUnavailable();
export const waitForLocalMiniMaxMusic3 = async (
  _taskId: string,
  _onProgress?: (progress: number) => void,
  _timeoutMs?: number,
): Promise<{ url: string; fileId?: string | null; result: unknown }> => localConnectorUnavailable();
export const cancelLocalMiniMaxMusic3 = async (_taskId: string): Promise<never> => localConnectorUnavailable();

export async function minimaxLyrics(text: string, language = 'zh') {
  return apiJson<any>('/api/minimax/lyrics', { method: 'POST', body: JSON.stringify({ text, language }) }, 'minimaxLyrics');
}

export async function minimaxFileUpload(file: File, purpose = 'voice_clone') {
  const body = new FormData();
  body.append('file', file);
  body.append('purpose', purpose);
  return apiJson<any>('/api/minimax/files/upload', { method: 'POST', body }, 'minimaxFileUpload', { includeContentType: false });
}

export async function minimaxFileRetrieve(fileId: string) {
  return apiJson<any>(`/api/minimax/files/${fileId}`, { method: 'GET' }, 'minimaxFileRetrieve');
}

export async function minimaxFileDelete(fileId: string) {
  return apiJson<any>(`/api/minimax/files/${fileId}`, { method: 'DELETE' }, 'minimaxFileDelete');
}
