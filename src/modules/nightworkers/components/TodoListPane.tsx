import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  LoaderCircle,
  PauseCircle,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskRunTodo, TodoStatus } from '../types';

type TodoListPaneProps = {
  todos: TaskRunTodo[];
};

export function TodoListPane({ todos }: TodoListPaneProps) {
  const { t } = useTranslation();
  const completedCount = todos.filter((todo) => todo.status === 'passed').length;
  const currentTodo = todos.find((todo) => todo.status === 'running');

  return (
    <aside className="nightworkers-todo-pane flex flex-col">
      <div className="nightworkers-todo-pane-header shrink-0 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="nightworkers-todo-pane-title truncate text-sm font-semibold">
              {t('timeline.todoProgress')}
            </h2>
            <p className="nightworkers-todo-pane-subtitle mt-1 truncate text-xs">
              {currentTodo
                ? `#${currentTodo.seq} ${currentTodo.title}`
                : t('todoPane.noActiveTodo')}
            </p>
          </div>
          <span className="nightworkers-todo-pane-count shrink-0 rounded px-2 py-1 font-mono text-xs">
            {completedCount}/{todos.length}
          </span>
        </div>
      </div>
      <div className="p-3">
        <ol className="space-y-2">
          {todos.map((todo) => {
            const style = todoStatusStyle(todo.status);
            const Icon = style.icon;
            return (
              <li key={todo.id} className={`rounded border px-3 py-2.5 ${style.container}`}>
                <div className="flex min-w-0 items-start gap-2.5">
                  <Icon
                    aria-hidden="true"
                    className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconClass} ${
                      todo.status === 'running' ? 'animate-spin' : ''
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="nightworkers-todo-pane-subtitle shrink-0 pt-0.5 text-[10px]">
                        #{todo.seq}
                      </span>
                      <span className="nightworkers-todo-pane-title min-w-0 text-xs font-medium leading-5">
                        {todo.title}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
                      <span className={style.textClass}>{style.label}</span>
                      <span className="nightworkers-todo-pane-subtitle">{todo.taskType}</span>
                      {todo.procedureId ? (
                        <span className="nightworkers-todo-pane-subtitle max-w-full truncate">
                          {todo.procedureId}
                        </span>
                      ) : null}
                    </div>
                    {todo.statusReason ? (
                      <p className="nightworkers-todo-pane-muted mt-1 line-clamp-3 text-[10px] leading-4">
                        {todo.statusReason}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}

function todoStatusStyle(status: TodoStatus): {
  label: string;
  icon: typeof Circle;
  iconClass: string;
  textClass: string;
  container: string;
} {
  switch (status) {
    case 'passed':
      return {
        label: 'passed',
        icon: CheckCircle2,
        iconClass: 'nightworkers-todo-status-success',
        textClass: 'nightworkers-todo-status-success',
        container: 'nightworkers-todo-item nightworkers-todo-item-success',
      };
    case 'running':
      return {
        label: 'running',
        icon: LoaderCircle,
        iconClass: 'nightworkers-todo-status-running',
        textClass: 'nightworkers-todo-status-running',
        container: 'nightworkers-todo-item nightworkers-todo-item-running',
      };
    case 'failed':
      return {
        label: 'failed',
        icon: XCircle,
        iconClass: 'nightworkers-todo-status-danger',
        textClass: 'nightworkers-todo-status-danger',
        container: 'nightworkers-todo-item nightworkers-todo-item-danger',
      };
    case 'skipped':
      return {
        label: 'skipped',
        icon: PauseCircle,
        iconClass: 'nightworkers-todo-pane-muted',
        textClass: 'nightworkers-todo-pane-muted',
        container: 'nightworkers-todo-item',
      };
    case 'needs_human':
      return {
        label: 'needs human',
        icon: AlertTriangle,
        iconClass: 'nightworkers-todo-status-warning',
        textClass: 'nightworkers-todo-status-warning',
        container: 'nightworkers-todo-item nightworkers-todo-item-warning',
      };
    case 'pending':
      return {
        label: 'pending',
        icon: Circle,
        iconClass: 'nightworkers-todo-pane-muted',
        textClass: 'nightworkers-todo-pane-muted',
        container: 'nightworkers-todo-item',
      };
  }
}
