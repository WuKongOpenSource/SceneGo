// Route changes must wait for the previous editor's final queued save before
// reading its snapshot. Failures remain visible to the editor that owns them.
const pending = new Map<string, Promise<void>>();

export function registerEnhanceSave(episodeId: string, save: Promise<void>): void {
  pending.set(episodeId, save);
  void save.finally(() => { if (pending.get(episodeId) === save) pending.delete(episodeId); }).catch(() => {});
}

export async function waitForEnhanceSaves(episodeId: string): Promise<void> {
  while (pending.has(episodeId)) await pending.get(episodeId);
}
