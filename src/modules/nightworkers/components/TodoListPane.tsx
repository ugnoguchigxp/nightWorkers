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
    <aside className="flex h-full min-h-0 flex-col border-l border-slate-800 bg-slate-950/80">
      <div className="shrink-0 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-slate-100">
              {t('timeline.todoProgress')}
            </h2>
            <p className="mt-1 truncate text-xs text-slate-500">
              {currentTodo
                ? `#${currentTodo.seq} ${currentTodo.title}`
                : t('todoPane.noActiveTodo')}
            </p>
          </div>
          <span className="shrink-0 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-300">
            {completedCount}/{todos.length}
          </span>
        </div>
      </div>
      <div className="nightworkers-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
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
                      <span className="shrink-0 pt-0.5 text-[10px] text-slate-500">
                        #{todo.seq}
                      </span>
                      <span className="min-w-0 text-xs font-medium leading-5 text-slate-100">
                        {todo.title}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">
                      <span className={style.textClass}>{style.label}</span>
                      <span className="text-slate-500">{todo.taskType}</span>
                      {todo.procedureId ? (
                        <span className="max-w-full truncate text-slate-500">
                          {todo.procedureId}
                        </span>
                      ) : null}
                    </div>
                    {todo.statusReason ? (
                      <p className="mt-1 line-clamp-3 text-[10px] leading-4 text-slate-400">
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
        iconClass: 'text-emerald-300',
        textClass: 'text-emerald-200',
        container: 'border-emerald-500/35 bg-emerald-950/15',
      };
    case 'running':
      return {
        label: 'running',
        icon: LoaderCircle,
        iconClass: 'text-cyan-300',
        textClass: 'text-cyan-200',
        container: 'border-cyan-500/35 bg-cyan-950/15',
      };
    case 'failed':
      return {
        label: 'failed',
        icon: XCircle,
        iconClass: 'text-rose-300',
        textClass: 'text-rose-200',
        container: 'border-rose-500/35 bg-rose-950/15',
      };
    case 'skipped':
      return {
        label: 'skipped',
        icon: PauseCircle,
        iconClass: 'text-slate-400',
        textClass: 'text-slate-300',
        container: 'border-slate-600/50 bg-slate-900/25',
      };
    case 'needs_human':
      return {
        label: 'needs human',
        icon: AlertTriangle,
        iconClass: 'text-amber-300',
        textClass: 'text-amber-200',
        container: 'border-amber-500/35 bg-amber-950/15',
      };
    case 'pending':
      return {
        label: 'pending',
        icon: Circle,
        iconClass: 'text-slate-400',
        textClass: 'text-slate-300',
        container: 'border-slate-700/70 bg-slate-900/20',
      };
  }
}
