import { describe, expect, it } from 'vitest';
import { qoderPlanTodos } from './planTodos';

describe('qoderPlanTodos', () => {
  it('maps a Qoder plan update to TodoWrite todos', () => {
    expect(qoderPlanTodos({
      entries: [
        { content: '#1 Protocol alignment', status: 'completed', priority: 'high' },
        { content: '#2 Plan visibility', status: 'in_progress', priority: 'medium' },
      ],
    })).toEqual([
      { id: 'plan-1', content: '#1 Protocol alignment', status: 'completed', priority: 'high' },
      { id: 'plan-2', content: '#2 Plan visibility', status: 'in_progress', priority: 'medium' },
    ]);
  });

  it('accepts a bare entries array', () => {
    expect(qoderPlanTodos([{ content: 'Ship it', status: 'pending', priority: 'low' }]))
      .toEqual([{ id: 'plan-1', content: 'Ship it', status: 'pending', priority: 'low' }]);
  });

  it('keeps usable entries when one is malformed', () => {
    expect(qoderPlanTodos({
      entries: [
        null,
        { content: '   ', status: 'completed', priority: 'high' },
        { content: 'Still visible', status: 'finished', priority: 'urgent' },
      ],
    })).toEqual([{ id: 'plan-1', content: 'Still visible', status: 'pending' }]);
  });

  it.each([null, undefined, {}, { entries: [] }, { entries: [null] }])('has no todos for %j', (payload) => {
    expect(qoderPlanTodos(payload)).toBeNull();
  });
});
