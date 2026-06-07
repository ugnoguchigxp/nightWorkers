import { useTranslation } from 'react-i18next';
import type { NightWorkersWorkspaceState } from '../hooks/useNightWorkersWorkspace';

type SettingsTodoPanelProps = {
  workspace: NightWorkersWorkspaceState;
};

export function SettingsTodoPanel({ workspace }: SettingsTodoPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-zinc-100">{t('settings.todo.title')}</h2>
          <p className="mt-1 text-xs text-zinc-500">{t('settings.todo.description')}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          ['requirePerTodoReview', t('settings.todo.reviewEveryTodo')],
          ['requirePerTodoFix', t('settings.todo.fixAfterReview')],
          ['requireFinalVerification', t('settings.todo.finalVerify')],
          ['askCommitOnCompletion', t('settings.todo.commitPrompt')],
        ].map(([key, label]) => (
          <label
            key={key}
            className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300"
          >
            <input
              type="checkbox"
              checked={Boolean(
                workspace.todoWorkflowSettings?.[key as keyof typeof workspace.todoWorkflowSettings]
              )}
              onChange={(event) =>
                void workspace.updateTodoWorkflowSettings({ [key]: event.target.checked })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
