export interface StoryboardVideoPromptSource {
  action_text?: unknown;
  actionText?: unknown;
  dialogue?: unknown;
  video_prompt?: unknown;
  videoPrompt?: unknown;
  image_prompt?: unknown;
  imagePrompt?: unknown;
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

/**
 * Upgrade only untouched legacy defaults. A prompt that differs from the old
 * storyboard-derived value is treated as a user edit and is preserved.
 */
export function upgradeLegacyStoryboardVideoPrompt(
  currentPrompt: string,
  sources: StoryboardVideoPromptSource[],
): string {
  const legacyPrompt = sources
    .map(storyboardBaseVideoPrompt)
    .filter(Boolean)
    .join('\n');
  const enrichedPrompt = sources
    .map(buildStoryboardVideoPrompt)
    .filter(Boolean)
    .join('\n');

  if (!legacyPrompt || !enrichedPrompt || normalized(enrichedPrompt) === normalized(legacyPrompt)) {
    return currentPrompt;
  }
  return normalized(currentPrompt) === normalized(legacyPrompt)
    ? enrichedPrompt
    : currentPrompt;
}
