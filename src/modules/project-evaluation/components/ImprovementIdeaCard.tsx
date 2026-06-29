import { Check } from 'lucide-react';
import type {
  ProjectEvaluationDimensionScore,
  ProjectImprovementIdea,
} from '../model/projectEvaluationTypes';

export function ImprovementIdeaCard({
  idea,
  dimensions,
  selected,
  onToggle,
}: {
  idea: ProjectImprovementIdea;
  dimensions: ProjectEvaluationDimensionScore[];
  selected: boolean;
  onToggle: () => void;
}) {
  const dimensionByKey = new Map(dimensions.map((dimension) => [dimension.key, dimension]));
  const maxGain = Math.max(0, ...idea.scoreImpacts.map((impact) => impact.expectedScoreGain));
  return (
    <div className="flex min-h-64">
      <ProjectEvaluationImprovementInstructionField idea={idea} />
      <button
        aria-pressed={selected}
        className={`flex min-h-64 w-full flex-col rounded-md border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nw-primary)] ${
          selected
            ? 'border-[var(--nw-primary)] bg-[var(--nw-surface-soft)]'
            : 'border-[var(--nw-border)] bg-[var(--nw-surface)] hover:border-[var(--nw-primary)]'
        }`}
        onClick={onToggle}
        type="button"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="flex flex-wrap gap-1.5">
            {idea.targetDimensions.map((key) => (
              <span
                className="rounded-full border border-[var(--nw-primary)] bg-[var(--nw-surface-soft)] px-2 py-0.5 text-[11px] text-[var(--nw-primary)]"
                key={key}
              >
                {dimensionByKey.get(key)?.label ?? key}
              </span>
            ))}
          </span>
          <Check
            aria-hidden="true"
            className={`h-5 w-5 shrink-0 transition ${
              selected ? 'text-[var(--nw-primary)]' : 'text-transparent'
            }`}
            strokeWidth={3}
          />
        </span>
        <span className="mt-3 font-semibold text-[var(--nw-text)] text-base">{idea.title}</span>
        <span className="mt-2 block text-[var(--nw-muted-text)] text-sm leading-6">
          {idea.summary}
        </span>
        <span className="mt-3 space-y-1.5 text-[var(--nw-muted-text)] text-sm">
          {idea.implementationFocus.map((item) => (
            <span className="flex gap-2" key={item}>
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nw-primary)]" />
              <span>{item}</span>
            </span>
          ))}
        </span>
        <span className="mt-auto pt-4 font-medium text-[var(--nw-primary)] text-sm">
          expected score gain +{maxGain}
        </span>
      </button>
    </div>
  );
}

export function ProjectEvaluationImprovementInstructionField({
  idea,
}: {
  idea: Pick<ProjectImprovementIdea, 'title'> &
    Partial<Pick<ProjectImprovementIdea, 'agentPrompt'>> & { implementationInstruction?: string };
}) {
  const instruction = idea.agentPrompt || idea.implementationInstruction || '';
  return (
    <input
      data-llm-implementation-instruction="project-evaluation"
      data-title={idea.title}
      name="projectEvaluationLlmImplementationInstruction"
      type="hidden"
      value={instruction}
    />
  );
}
