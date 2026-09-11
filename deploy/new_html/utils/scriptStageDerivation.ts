import type { ProjectFile, ScriptSegment, StoryboardItem } from '../types';












export function deriveScriptStagesFromPersisted(
  segments: ScriptSegment[],
  scriptContent: string | null,
  storyboardItems: StoryboardItem[],
): ProjectFile['generationStages'] | undefined {
  const segCount = segments.length;
  const segsWithVideo = segments.filter(s => s.videoScript).length;
  const itemsWithPrompt = storyboardItems.filter(i => i.imagePrompt).length;

  const splitDone = segCount > 0;
  const videoDone = !!scriptContent && segCount > 0 && segsWithVideo === segCount;
  const storyboardDone = itemsWithPrompt > 0;

  if (!splitDone && !videoDone && !storyboardDone) return undefined;

  const stages: NonNullable<ProjectFile['generationStages']> = {};
  if (splitDone) {
    stages.split = { status: 'done', total: segCount, completed: segCount };
  }
  if (videoDone) {
    stages.videoScript = { status: 'done', total: segCount, completed: segsWithVideo };
  }
  if (storyboardDone) {
    stages.storyboardPrompt = { status: 'done', total: storyboardItems.length, completed: itemsWithPrompt };
  }
  return stages;
}
