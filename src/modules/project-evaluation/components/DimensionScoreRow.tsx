import { Check } from 'lucide-react';
import type { ProjectEvaluationDimensionScore } from '../model/projectEvaluationTypes';

export function DimensionScoreRow({
  dimension,
  selected,
  onToggle,
}: {
  dimension: ProjectEvaluationDimensionScore;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      aria-pressed={selected}
      className={`grid w-full grid-cols-[44px_1fr_104px] gap-3 px-4 py-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nw-primary)] ${
        selected
          ? 'bg-[var(--nw-surface-soft)]'
          : 'bg-[var(--nw-panel)] hover:bg-[var(--nw-surface)]'
      }`}
      onClick={onToggle}
      type="button"
    >
      <span aria-hidden="true" className="flex items-start justify-center pt-1.5">
        <Check
          className={`h-5 w-5 ${selected ? 'text-[var(--nw-primary)]' : 'text-transparent'}`}
          strokeWidth={3}
        />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="font-semibold text-[var(--nw-text)] text-base">{dimension.label}</span>
          <span className="text-[var(--nw-subtle-text)] text-xs">
            confidence {Math.round(dimension.confidence * 100)}%
          </span>
        </span>
        <span className="mt-1 block text-[var(--nw-muted-text)] text-[15px] leading-7">
          {dimension.rationale}
        </span>
      </span>
      <span className="flex flex-col items-end justify-start">
        <span className="text-3xl font-semibold text-[var(--nw-text)]">
          {Math.round(dimension.score)}
        </span>
      </span>
    </button>
  );
}
