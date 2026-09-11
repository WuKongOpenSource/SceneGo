const STORAGE_KEY = 'comfyui_running_tasks';
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export interface RunningTask {
  taskId: string;
  shotId: string;
  fileId: string;
  model: string;
  startedAt: number;
}

export function saveRunningTask(task: RunningTask): void {
  try {
    const tasks = getAllTasks();
    tasks.push(task);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch { /* quota exceeded etc */ }
}

export function removeRunningTask(taskId: string): void {
  try {
    const tasks = getAllTasks().filter(t => t.taskId !== taskId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch { /* ignore */ }
}

export function getRecoverableTasks(): RunningTask[] {
  cleanupStaleTasks();
  return getAllTasks();
}

export function cleanupStaleTasks(): void {
  try {
    const now = Date.now();
    const tasks = getAllTasks().filter(t => now - t.startedAt < MAX_AGE_MS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch { /* ignore */ }
}

function getAllTasks(): RunningTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
