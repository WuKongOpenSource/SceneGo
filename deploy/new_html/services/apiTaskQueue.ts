




interface QueuedApiTask<T> {
    id: string;
    category: string;
    name: string;
    execute: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: any) => void;
    addedAt: number;
}

type ApiQueueEventCallback = (event: ApiQueueEvent) => void;

export interface ApiQueueEvent {
    type: 'task_added' | 'task_started' | 'task_completed' | 'task_failed';
    taskId: string;
    taskName: string;
    category: string;
    runningCount: number;
    queueLength: number;
}

class ApiTaskQueue {
    private queues = new Map<string, QueuedApiTask<any>[]>();
    private runningCounts = new Map<string, number>();
    private maxConcurrentPerCategory = 4;
    private listeners: ApiQueueEventCallback[] = [];
    private idCounter = 0;

    async enqueue<T>(
        taskFn: () => Promise<T>,
        category: string,
        taskName = 'API任务'
    ): Promise<T> {
        const taskId = `api_${category}_${++this.idCounter}_${Date.now()}`;

        return new Promise<T>((resolve, reject) => {
            if (!this.queues.has(category)) {
                this.queues.set(category, []);
                this.runningCounts.set(category, 0);
            }

            this.queues.get(category)!.push({
                id: taskId,
                category,
                name: taskName,
                execute: taskFn,
                resolve,
                reject,
                addedAt: Date.now()
            });

            this.emit({
                type: 'task_added',
                taskId,
                taskName,
                category,
                runningCount: this.runningCounts.get(category) || 0,
                queueLength: this.queues.get(category)!.length
            });

            this.processCategory(category);
        });
    }

    private async processCategory(category: string) {
        const queue = this.queues.get(category);
        if (!queue) return;

        while (
            (this.runningCounts.get(category) || 0) < this.maxConcurrentPerCategory &&
            queue.length > 0
        ) {
            this.runningCounts.set(category, (this.runningCounts.get(category) || 0) + 1);
            const task = queue.shift()!;
            this.runTask(task);
        }
    }

    private async runTask(task: QueuedApiTask<any>) {
        const waitTime = Date.now() - task.addedAt;
        const running = this.runningCounts.get(task.category) || 0;
        console.log(`🚀 [API队列/${task.category}] 开始: ${task.name} (等待 ${Math.round(waitTime / 1000)}s, 并发: ${running}/${this.maxConcurrentPerCategory})`);

        this.emit({
            type: 'task_started',
            taskId: task.id,
            taskName: task.name,
            category: task.category,
            runningCount: running,
            queueLength: this.queues.get(task.category)?.length || 0
        });

        try {
            const result = await task.execute();
            this.emit({
                type: 'task_completed',
                taskId: task.id,
                taskName: task.name,
                category: task.category,
                runningCount: (this.runningCounts.get(task.category) || 1) - 1,
                queueLength: this.queues.get(task.category)?.length || 0
            });
            task.resolve(result);
        } catch (error) {
            this.emit({
                type: 'task_failed',
                taskId: task.id,
                taskName: task.name,
                category: task.category,
                runningCount: (this.runningCounts.get(task.category) || 1) - 1,
                queueLength: this.queues.get(task.category)?.length || 0
            });
            task.reject(error);
        } finally {
            const current = this.runningCounts.get(task.category) || 1;
            this.runningCounts.set(task.category, Math.max(0, current - 1));
            this.processCategory(task.category);
        }
    }

    getStatus() {
        const categories: Record<string, { running: number; queued: number }> = {};
        for (const [cat, queue] of this.queues) {
            categories[cat] = {
                running: this.runningCounts.get(cat) || 0,
                queued: queue.length
            };
        }
        return categories;
    }

    addEventListener(callback: ApiQueueEventCallback): () => void {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private emit(event: ApiQueueEvent) {
        this.listeners.forEach(cb => {
            try { cb(event); } catch (e) { console.error('API队列事件处理器错误:', e); }
        });
    }
}

export const apiTaskQueue = new ApiTaskQueue();

export const enqueueApiTask = <T>(
    taskFn: () => Promise<T>,
    category: string,
    taskName?: string
) => apiTaskQueue.enqueue(taskFn, category, taskName);

export const getApiQueueStatus = () => apiTaskQueue.getStatus();

export const onApiQueueEvent = (callback: ApiQueueEventCallback) =>
    apiTaskQueue.addEventListener(callback);
