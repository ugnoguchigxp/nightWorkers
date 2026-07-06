import type { ProjectEvaluationRun } from "../model/projectEvaluationTypes";

export function EvaluationSummaryPanel({
	evaluation,
	previous,
}: {
	evaluation: ProjectEvaluationRun;
	previous: ProjectEvaluationRun | null;
}) {
	const scoreDelta = previous
		? Math.round(evaluation.overallScore - previous.overallScore)
		: null;
	return (
		<section className="rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] p-5 shadow-sm">
			<div className="grid grid-cols-[1fr_220px] items-start gap-5">
				<div className="min-w-0">
					<div className="font-semibold text-[var(--nw-text)] text-xl tracking-normal">
						LLM総評
					</div>
					<p className="mt-2 text-[15px] text-[var(--nw-muted-text)] leading-7">
						{evaluation.summary}
					</p>
				</div>
				<div className="flex min-h-32 shrink-0 flex-col items-center justify-center rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-4 py-4 text-center">
					<div className="font-semibold text-[var(--nw-primary)] text-xs">
						Overall score
					</div>
					<div className="mt-2 flex items-baseline justify-center gap-1 text-5xl font-semibold text-[var(--nw-text)]">
						{Math.round(evaluation.overallScore)}
						<span className="text-xl text-[var(--nw-subtle-text)]">/ 100</span>
					</div>
					<div className="mt-1 text-[var(--nw-primary)] text-xs">
						{scoreDelta === null
							? "baseline evaluation"
							: `${scoreDelta >= 0 ? "+" : ""}${scoreDelta} from previous`}
					</div>
				</div>
			</div>
		</section>
	);
}
