const handlers = new Map<string, () => void>();

export function registerPendingCancellation(taskId: string, cancel: () => void): void {
  handlers.set(taskId, cancel);
}

export function removePendingCancellation(taskId: string): void {
  handlers.delete(taskId);
}

export function cancelPendingSubmission(taskId: string): boolean {
  const cancel = handlers.get(taskId);
  if (!cancel) return false;
  handlers.delete(taskId);
  cancel();
  return true;
}
