/** A plan entry in the shape TodoWrite renders. */
export interface QoderPlanTodo {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'high' | 'medium' | 'low';
}

const STATUSES = new Set<QoderPlanTodo['status']>(['pending', 'in_progress', 'completed']);
const PRIORITIES = new Set<NonNullable<QoderPlanTodo['priority']>>(['high', 'medium', 'low']);

/**
 * An ACP plan update as TodoWrite todos, or null when it carries no usable entry. Qoder sends
 * `{ entries }` (the ACP shape); a bare entries array is accepted as well. An unknown status
 * falls back to pending so one bad entry does not hide the rest of the plan.
 */
export function qoderPlanTodos(payload: unknown): QoderPlanTodo[] | null {
  const entries = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { entries?: unknown }).entries)
      ? (payload as { entries: unknown[] }).entries
      : null;
  if (!entries) return null;

  const todos: QoderPlanTodo[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content.trim() : '';
    if (!content) continue;
    const status = typeof record.status === 'string' && STATUSES.has(record.status as QoderPlanTodo['status'])
      ? record.status as QoderPlanTodo['status']
      : 'pending';
    const priority = typeof record.priority === 'string' && PRIORITIES.has(record.priority as NonNullable<QoderPlanTodo['priority']>)
      ? record.priority as NonNullable<QoderPlanTodo['priority']>
      : undefined;
    todos.push({
      id: `plan-${todos.length + 1}`,
      content,
      status,
      ...(priority ? { priority } : {}),
    });
  }

  return todos.length > 0 ? todos : null;
}
