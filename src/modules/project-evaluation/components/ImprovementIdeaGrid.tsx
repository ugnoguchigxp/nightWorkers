import { BrainCircuit, ClipboardList, Loader2, Sparkles } from 'lucide-react';
import type {
  ProjectEvaluationDimensionKey,
  ProjectEvaluationDimensionScore,
  ProjectImprovementIdea,
} from '../model/projectEvaluationTypes';
import { ImprovementIdeaCard } from './ImprovementIdeaCard';

export function ImprovementIdeaGrid({
  dimensions,
  ideas,
  selectedKeys,
  selectedIdeaIds,
  isGenerating,
  isCreatingTasks,
  onGenerate,
  onToggleIdea,
  onCreateTasks,
}: {
  dimensions: ProjectEvaluationDimensionScore[];
  ideas: ProjectImprovementIdea[];
  selectedKeys: Set<ProjectEvaluationDimensionKey>;
  selectedIdeaIds: Set<string>;
  isGenerating: boolean;
  isCreatingTasks: boolean;
  onGenerate: () => void;
  onToggleIdea: (id: string) => void;
  onCreateTasks: () => void;
}) {
  const selectedLabels = dimensions
    .filter((dimension) => selectedKeys.has(dimension.key))
    .map((dimension) => dimension.label);
  return (
    <section className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] shadow-sm">
      <div className="flex min-h-12 items-center justify-between gap-3 border-[var(--nw-border)] border-b px-3 py-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 font-semibold text-[var(--nw-muted-text)] text-xs uppercase">
            <Sparkles className="h-4 w-4 text-[var(--nw-primary)]" />
            Round 2 / 選択軸から改善案を生成
          </div>
          <div className="mt-1 truncate text-[var(--nw-subtle-text)] text-xs">
            {selectedLabels.length
              ? `selected: ${selectedLabels.join(' / ')}`
              : 'Round 1 の選択を使って、100点に近づくための改善案を生成します。'}
          </div>
        </div>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-3 font-medium text-[var(--nw-text)] text-xs transition hover:bg-[var(--nw-surface)] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={selectedKeys.size === 0 || isGenerating}
          onClick={onGenerate}
          type="button"
        >
          {isGenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <BrainCircuit className="h-3.5 w-3.5" />
          )}
          {isGenerating ? '改善案を生成中' : '改善案を生成'}
        </button>
      </div>
      {ideas.length === 0 ? (
        <div className="p-6 text-center text-[var(--nw-subtle-text)] text-sm">
          {isGenerating ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--nw-primary)]" />
              選択軸から改善案を生成しています。
            </span>
          ) : (
            'まだ改善案は生成されていません。Round 1 で軸を選び、改善案を生成してください。'
          )}
        </div>
      ) : (
        <>
          <div className="flex min-h-10 items-center justify-between border-[var(--nw-border)] border-b px-3 py-2">
            <span className="text-[var(--nw-subtle-text)] text-xs">
              {isGenerating
                ? '改善案を再生成しています。'
                : `${ideas.length} improvement tasks / ${selectedIdeaIds.size} selected`}
            </span>
            <button
              className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                selectedIdeaIds.size > 0
                  ? 'border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] text-[var(--nw-text)] hover:bg-[var(--nw-surface)]'
                  : 'border-[var(--nw-border)] text-[var(--nw-muted-text)]'
              }`}
              disabled={selectedIdeaIds.size === 0 || isCreatingTasks || isGenerating}
              onClick={onCreateTasks}
              type="button"
            >
              <ClipboardList className="h-3.5 w-3.5" />
              {isCreatingTasks ? 'Task 作成中' : '選択候補を Task 化'}
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-2 2xl:grid-cols-3">
            {ideas.map((idea) =>
              idea.id ? (
                <ImprovementIdeaCard
                  dimensions={dimensions}
                  idea={idea}
                  key={idea.id}
                  onToggle={() => onToggleIdea(idea.id as string)}
                  selected={selectedIdeaIds.has(idea.id)}
                />
              ) : null
            )}
          </div>
        </>
      )}
    </section>
  );
}
