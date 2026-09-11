


















const LS_KEY = 'voice_preview_cache_v1';
const MAX_ENTRIES = 100;

export type VoicePreviewEntry = {
  voiceId: string;
  audioUrl: string;
  ts: number;
};

type Store = Record<string, VoicePreviewEntry>;

function safeLoad(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

let memory: Store = safeLoad();

function persist() {
  if (typeof window === 'undefined') return;
  try {
    const entries = Object.entries(memory);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].ts - a[1].ts);
      memory = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    }
    window.localStorage.setItem(LS_KEY, JSON.stringify(memory));
  } catch (e) {
    console.warn('[voicePreviewCache] persist failed:', e);
  }
}

export function getVoicePreview(key: string): VoicePreviewEntry | null {
  if (!key) return null;
  const e = memory[key];
  if (!e || !e.audioUrl) return null;

  e.ts = Date.now();
  return e;
}

export function setVoicePreview(
  key: string,
  entry: { voiceId: string; audioUrl: string }
): void {
  if (!key || !entry.audioUrl) return;
  if (entry.audioUrl.startsWith('blob:')) return;
  memory[key] = { ...entry, ts: Date.now() };
  persist();
}

export function clearVoicePreview(key?: string): void {
  if (key) {
    delete memory[key];
  } else {
    memory = {};
  }
  persist();
}





export function makeSystemKey(voiceId: string): string {
  return `system:${voiceId}`;
}
export function makeDesignKey(settingStableJSON: string, text: string): string {
  return `design:${settingStableJSON}:${text}`;
}
export function makeCloneKey(fileId: string): string {
  return `clone:${fileId}`;
}
