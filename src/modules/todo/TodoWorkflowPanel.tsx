import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TodoWorkflowSettings } from '../nightworkers/types';
import { useTodoWorkflowSettings } from './useTodoWorkflowSettings';

export function TodoWorkflowPanel() {
  const { t } = useTranslation();
  const { todoWorkflowSettings, updateTodoWorkflowSettings } = useTodoWorkflowSettings();
  const options: Array<{ key: keyof TodoWorkflowSettings; label: string }> = [
    { key: 'requirePerTodoReview', label: t('queue.todo.reviewEveryTodo') },
    { key: 'requirePerTodoFix', label: t('queue.todo.fixAfterReview') },
    { key: 'requireFinalVerification', label: t('queue.todo.finalVerify') },
    { key: 'askCommitOnCompletion', label: t('queue.todo.commitPrompt') },
  ];
  return (
    <div className="border-slate-800 border-y p-3">
      <div className="mb-2 flex items-center gap-2 font-semibold text-slate-200 text-xs uppercase">
        <SlidersHorizontal className="h-4 w-4" />
        <span>{t('queue.todoWorkflow')}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => (
          <label
            key={option.key}
            className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/45 px-2 py-1.5 text-slate-300 text-xs"
          >
            <input
              type="checkbox"
              checked={Boolean(todoWorkflowSettings?.[option.key])}
              onChange={(event) =>
                void updateTodoWorkflowSettings({ [option.key]: event.target.checked })
              }
            />
            <span className="truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
