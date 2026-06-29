import { GitCompare } from 'lucide-react';
import type { ProjectEvaluationRun } from '../model/projectEvaluationTypes';

export function EvaluationHistorySidebar({
  evaluations,
  activeId,
  onSelect,
}: {
  evaluations: ProjectEvaluationRun[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="h-full rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] shadow-sm">
      <div className="flex h-10 items-center gap-2 border-[var(--nw-border)] border-b px-3 font-semibold text-[var(--nw-muted-text)] text-xs uppercase">
        <GitCompare className="h-4 w-4 text-[var(--nw-subtle-text)]" />
        History
      </div>
      <div className="space-y-1 p-2">
        {evaluations.map((item) => (
          <button
            className={`flex h-9 w-full items-center justify-between rounded-md border px-3 text-left transition ${
              item.id === activeId
                ? 'border-[var(--nw-primary)] bg-[var(--nw-surface-soft)] text-[var(--nw-text)]'
                : 'border-transparent bg-[var(--nw-panel)] text-[var(--nw-muted-text)] hover:border-[var(--nw-border)]'
            }`}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span className="font-semibold text-sm">{Math.round(item.overallScore)}</span>
            <span className="text-[var(--nw-subtle-text)] text-xs">
              {new Date(item.createdAt).toLocaleString()}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
