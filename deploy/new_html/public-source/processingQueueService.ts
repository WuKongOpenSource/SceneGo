export type ProcessingQueuePreflight = {
  queue_mode: 'external';
  tasks_ahead: number;
  estimated_wait_seconds: number;
  requires_confirmation: false;
  can_cancel_before_submit: boolean;
  accepting_submissions: true;
};

export class QueueSubmissionCancelledError extends Error {}
export class QueueMaintenanceError extends Error {}

export async function confirmProcessingQueue(_payload: Record<string, unknown>): Promise<ProcessingQueuePreflight> {
  return {
    queue_mode: 'external',
    tasks_ahead: 0,
    estimated_wait_seconds: 0,
    requires_confirmation: false,
    can_cancel_before_submit: true,
    accepting_submissions: true,
  };
}
