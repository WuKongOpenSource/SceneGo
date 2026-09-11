import { describe, expect, it } from 'vitest';
import { toTextTaskPayload } from '../../services/textTaskContext';

describe('text task context', () => {
  it('only sends the notification suppression flag for internal repair calls', () => {
    expect(toTextTaskPayload({
      operation: 'script_rewrite',
      sourceItemId: 'script_1',
      suppressNotification: true,
    })).toEqual({
      operation: 'script_rewrite',
      source_item_id: 'script_1',
      suppress_notification: true,
    });

    expect(toTextTaskPayload({
      operation: 'script_rewrite',
      suppressNotification: false,
    })).toEqual({
      operation: 'script_rewrite',
    });
  });
});
