export interface StoryboardVideoPromptSource {
  action_text?: unknown;
  actionText?: unknown;
  dialogue?: unknown;
  video_prompt?: unknown;
  videoPrompt?: unknown;
  image_prompt?: unknown;
  imagePrompt?: unknown;
  source_video_shot_no?: unknown;
  sourceVideoShotNo?: unknown;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return '';
}

function meaningful(value: string): boolean {
  return Boolean(value && !/^(?:无|none|null|n\/a)$/i.test(value));
}

export function storyboardBaseVideoPrompt(source: StoryboardVideoPromptSource): string {
  return firstText(source.video_prompt, source.videoPrompt, source.image_prompt, source.imagePrompt);
}

/** Build the default model prompt without changing the storyboard source fields. */
export function buildStoryboardVideoPrompt(source: StoryboardVideoPromptSource): string {
  const action = firstText(source.action_text, source.actionText);
  const dialogue = text(source.dialogue);
  const basePrompt = storyboardBaseVideoPrompt(source);
  const context: string[] = [];

  if (meaningful(action) && !basePrompt.includes(action)) {
    context.push(`动作说明：${action}`);
  }
  if (meaningful(dialogue) && !basePrompt.includes(dialogue)) {
    context.push(`对白：${dialogue}`);
  }
  if (context.length === 0) return basePrompt;
  if (basePrompt) context.push(`视频提示词：${basePrompt}`);
  return context.join('\n');
}

function normalized(value: string): string {
  return value.replace(/\r\n/g, '\n').trim();
}

/** Only identical, explicitly labelled video blocks are shared. Never dedupe
 * action/dialogue lines: repeating an action in a later shot can be intentional. */
export function mergeStoryboardVideoPrompts(prompts: string[]): string {
  const output: string[] = [];
  let shared: string[] = [];
  let segment = '';
  const flush = () => { output.push(...shared); shared = []; };
  for (const prompt of prompts.filter(Boolean)) {
    const value = normalized(prompt);
    const shots = value.split(/(?=^(?:【?镜头\s*\d[^\n]*】?\s*$|动作说明\s*[:：]))/m);
    // A heading and its action belong together; do not flush scene constraints between them.
    const entries: string[] = [];
    for (const shot of shots.filter(Boolean)) {
      if (entries.length && /^(?:【?镜头\s*\d[^\n]*】?)\s*$/.test(entries[entries.length - 1])) entries[entries.length - 1] += shot;
      else entries.push(shot);
    }
    for (const entry of entries) {
      const nextSegment = entry.match(/^【?镜头\s*(\d+)\s*[-－—]/)?.[1];
      if (nextSegment && segment && nextSegment !== segment) flush();
      if (nextSegment) segment = nextSegment;
      const parts = entry.split(/(?=^\s*(?:视频提示词|动作说明|对白)\s*[:：])/m).map(part => part.trim()).filter(Boolean);
      const video = [...new Set(parts.filter(part => /^视频提示词\s*[:：]/.test(part)))];
      const body = parts.filter(part => !/^视频提示词\s*[:：]/.test(part));
      if (video.length && shared.length && video.join('\n') !== shared.join('\n')) flush();
      output.push(...body);
      if (video.length) shared = video;
    }
  }
  flush();
  return output.join('\n');
}

/**
 * Upgrade only untouched legacy defaults. A prompt that differs from the old
 * storyboard-derived value is treated as a user edit and is preserved.
 */
export function upgradeLegacyStoryboardVideoPrompt(
    currentPrompt: string,
    sources: StoryboardVideoPromptSource[],
    firstLastPair = false,
): string {
  const legacyPrompt = sources
    .map(storyboardBaseVideoPrompt)
    .filter(Boolean)
    .join('\n');
  const enrichedPrompt = sources
    .map(buildStoryboardVideoPrompt)
    .filter(Boolean)
    .join('\n');

  if (!legacyPrompt || !enrichedPrompt) {
    return currentPrompt;
  }
  const oldDefaults = [legacyPrompt, enrichedPrompt];
  // Old first/last pairs kept only the first shot's untouched default prompt.
  // Upgrade that precise signature, never overwrite a manually edited prompt.
  if (firstLastPair && sources.length === 2) {
    oldDefaults.push(storyboardBaseVideoPrompt(sources[0]), buildStoryboardVideoPrompt(sources[0]));
  }
  if (oldDefaults.some(prompt => prompt && normalized(currentPrompt) === normalized(prompt))) {
    return mergeStoryboardVideoPrompts(sources.map(source => {
      const label = firstText(source.source_video_shot_no, source.sourceVideoShotNo).replace(/^分镜/, '镜头');
      return `${sources.length > 1 && label ? label + '\n' : ''}${buildStoryboardVideoPrompt(source)}`;
    }));
  }
  return sources.length > 1 ? mergeStoryboardVideoPrompts([currentPrompt]) : currentPrompt;
}
