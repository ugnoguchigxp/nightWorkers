import type { TodoRuntimeTodo } from './types';

function statusLabel(status: string) {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'needs_human':
      return 'needs human';
    case 'skipped':
      return 'skipped';
    case 'running':
      return 'running';
    default:
      return 'pending';
  }
}

export function appendTodoSummaryToFinalReport(input: {
  finalReport: string;
  todos: TodoRuntimeTodo[];
}): string {
  const base = input.finalReport.trim();
  if (input.todos.length === 0) return base;

  const lines = input.todos.map((todo) => {
    const reason = typeof todo.statusReason === 'string' ? ` - ${todo.statusReason}` : '';
    return `- #${todo.seq} ${statusLabel(todo.status)}: ${todo.title}${reason}`;
  });

  return `${base || 'Run finished.'}\n\nTodo summary:\n${lines.join('\n')}`;
}
