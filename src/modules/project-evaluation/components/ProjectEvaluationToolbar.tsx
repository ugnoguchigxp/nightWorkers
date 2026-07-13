import { CheckCircle2, Loader2, Play } from "lucide-react";
import type { ProjectEvaluationRun } from "../model/projectEvaluationTypes";

export function ProjectEvaluationToolbar({
	evaluation,
	isRunning,
	error,
	onRun,
}: {
	evaluation: ProjectEvaluationRun | null;
	isRunning: boolean;
	error: string | null;
	onRun: () => void;
}) {
	const selectedModel = evaluation?.selectedModel as
		| { providerId?: string; modelOrDeployment?: string }
		| null
		| undefined;
	return (
		<header className="flex h-12 shrink-0 items-center justify-end bg-[var(--nw-panel)] px-4">
			<div className="flex items-center gap-2">
				<span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-2.5 text-[var(--nw-text)] text-xs">
					<CheckCircle2 className="h-3.5 w-3.5" />
					{selectedModel?.providerId
						? `${selectedModel.providerId} / ${selectedModel.modelOrDeployment || "default"}`
						: error
							? "evaluation error"
							: "evaluation role"}
				</span>
				<button
					className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--nw-strong-border)] bg-[var(--nw-surface-soft)] px-3 text-[var(--nw-text)] text-xs transition hover:bg-[var(--nw-surface)] disabled:cursor-not-allowed disabled:opacity-50"
					disabled={isRunning}
					onClick={onRun}
					type="button"
				>
					{isRunning ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Play className="h-4 w-4" />
					)}
					{isRunning ? "LLMに依頼中" : "評価を実行"}
				</button>
			</div>
		</header>
	);
}
