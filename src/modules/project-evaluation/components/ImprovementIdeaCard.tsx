import { Check, Loader2, Route } from "lucide-react";
import type {
	ProjectEvaluationDimensionScore,
	ProjectImprovementIdea,
} from "../model/projectEvaluationTypes";

export function ImprovementIdeaCard({
	idea,
	dimensions,
	selected,
	onToggle,
	onCreateMission,
	isCreatingMission = false,
}: {
	idea: ProjectImprovementIdea;
	dimensions: ProjectEvaluationDimensionScore[];
	selected: boolean;
	onToggle: () => void;
	onCreateMission?: () => void;
	isCreatingMission?: boolean;
}) {
	const dimensionByKey = new Map(
		dimensions.map((dimension) => [dimension.key, dimension]),
	);
	return (
		<div className="flex min-h-64">
			<ProjectEvaluationImprovementInstructionField idea={idea} />
			<button
				aria-pressed={selected}
				className={`flex min-h-64 w-full flex-col rounded-md border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nw-primary)] ${
					selected
						? "border-[var(--nw-primary)] bg-[var(--nw-surface-soft)]"
						: "border-[var(--nw-border)] bg-[var(--nw-surface)] hover:border-[var(--nw-primary)]"
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
							selected ? "text-[var(--nw-primary)]" : "text-transparent"
						}`}
						strokeWidth={3}
					/>
				</span>
				<span className="mt-3 font-semibold text-[var(--nw-text)] text-base">
					{idea.title}
				</span>
				<span className="mt-2 block text-[var(--nw-muted-text)] text-sm leading-6">
					{idea.summary}
				</span>
				<span className="mt-auto grid gap-4 pt-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.75fr)]">
					<span className="min-w-0 space-y-1.5 text-[var(--nw-muted-text)] text-sm">
						{idea.implementationFocus.map((item) => (
							<span className="flex gap-2" key={item}>
								<span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nw-primary)]" />
								<span>{item}</span>
							</span>
						))}
					</span>
					<span className="min-w-0 rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] p-3">
						<span className="block font-medium text-[var(--nw-subtle-text)] text-[11px] uppercase">
							改善見込み
						</span>
						<span className="mt-2 grid gap-2">
							{idea.scoreImpacts.length > 0 ? (
								idea.scoreImpacts.map((impact) => (
									<span
										className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
										key={`${impact.dimensionKey}-${impact.expectedScoreGain}`}
									>
										<span className="min-w-0">
											<span className="block truncate font-medium text-[var(--nw-text)] text-xs">
												{dimensionByKey.get(impact.dimensionKey)?.label ??
													impact.dimensionKey}
											</span>
											<span className="mt-0.5 block text-[var(--nw-subtle-text)] text-[11px]">
												{impact.currentScore} → {impact.expectedScoreAfter}
											</span>
										</span>
										<span className="font-semibold text-[var(--nw-primary)] text-sm">
											+{impact.expectedScoreGain}
										</span>
									</span>
								))
							) : (
								<span className="text-[var(--nw-subtle-text)] text-xs">
									score impact 未算出
								</span>
							)}
						</span>
					</span>
				</span>
			</button>
			{onCreateMission ? (
				<button
					type="button"
					onClick={onCreateMission}
					disabled={isCreatingMission}
					className="ml-2 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--nw-primary)] bg-[var(--nw-surface-soft)] px-3 font-semibold text-[var(--nw-primary)] text-xs disabled:opacity-50"
				>
					{isCreatingMission ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<Route className="h-3.5 w-3.5" />
					)}
					{isCreatingMission ? "作成中" : "Missionを作成"}
				</button>
			) : null}
		</div>
	);
}

export function ProjectEvaluationImprovementInstructionField({
	idea,
}: {
	idea: Pick<ProjectImprovementIdea, "title"> &
		Partial<Pick<ProjectImprovementIdea, "agentPrompt">> & {
			implementationInstruction?: string;
		};
}) {
	const instruction = idea.agentPrompt || idea.implementationInstruction || "";
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
