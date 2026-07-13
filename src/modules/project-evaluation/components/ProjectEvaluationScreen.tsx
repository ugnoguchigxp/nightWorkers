import { useEffect, useRef, useState } from "react";
import type { Task } from "../../nightworkers/types";
import { useProjectEvaluationController } from "../hooks/useProjectEvaluationController";
import type { ProjectEvaluationProject } from "../model/projectEvaluationTypes";
import { DimensionSelector } from "./DimensionSelector";
import { EvaluationHistorySidebar } from "./EvaluationHistorySidebar";
import { EvaluationSummaryPanel } from "./EvaluationSummaryPanel";
import { ImprovementIdeaGrid } from "./ImprovementIdeaGrid";
import { ProjectEvaluationActivityPanel } from "./ProjectEvaluationActivityPanel";
import { ProjectEvaluationEmptyState } from "./ProjectEvaluationEmptyState";
import { ProjectEvaluationTaskLinks } from "./ProjectEvaluationTaskLinks";
import { ProjectEvaluationToolbar } from "./ProjectEvaluationToolbar";

type EvaluationTab = "result" | "activity";

export function ProjectEvaluationScreen({
	project,
	onTasksCreated,
}: {
	project: ProjectEvaluationProject;
	onTasksCreated?: (tasks: Task[]) => Promise<void> | void;
}) {
	const controller = useProjectEvaluationController(project.id, {
		onTasksCreated,
	});
	const detail = controller.detail;
	const [activeTab, setActiveTab] = useState<EvaluationTab>("result");
	const wasRunningRef = useRef(false);

	useEffect(() => {
		if (controller.isRunning) setActiveTab("activity");
	}, [controller.isRunning]);

	useEffect(() => {
		if (controller.isRunning) {
			wasRunningRef.current = true;
			return;
		}
		if (wasRunningRef.current && detail?.evaluation.status === "completed") {
			setActiveTab("result");
		}
		if (!controller.isRunning) {
			wasRunningRef.current = false;
		}
	}, [controller.isRunning, detail?.evaluation.status]);

	const hasEvaluationSurface = Boolean(
		detail || controller.isRunning || controller.activityEvents.length > 0,
	);

	return (
		<main className="flex h-full min-h-0 flex-col bg-[var(--nw-background)] text-[var(--nw-text)]">
			<ProjectEvaluationToolbar
				error={controller.error}
				evaluation={detail?.evaluation ?? null}
				isRunning={controller.isRunning}
				onRun={controller.runEvaluation}
			/>
			<div className="nightworkers-scrollbar min-h-0 flex-1 overflow-auto">
				<div className="min-w-[1120px] space-y-4 p-4">
					{controller.error ? (
						<div className="rounded-md border border-[var(--nw-danger)] bg-[var(--nw-panel)] px-3 py-2 text-[var(--nw-danger)] text-sm">
							{controller.error}
						</div>
					) : null}
					{!detail &&
					!controller.isRunning &&
					controller.activityEvents.length === 0 ? (
						<ProjectEvaluationEmptyState
							isLoading={controller.isLoading || controller.isRunning}
							onRun={controller.runEvaluation}
						/>
					) : (
						<>
							{hasEvaluationSurface ? (
								<div className="inline-flex rounded-md border border-[var(--nw-border)] bg-[var(--nw-panel)] p-1">
									<button
										className={`h-8 rounded px-3 text-xs transition ${
											activeTab === "result"
												? "bg-[var(--nw-surface-soft)] text-[var(--nw-text)]"
												: "text-[var(--nw-subtle-text)] hover:text-[var(--nw-text)]"
										}`}
										disabled={!detail}
										onClick={() => setActiveTab("result")}
										type="button"
									>
										LLM総評
									</button>
									<button
										className={`h-8 rounded px-3 text-xs transition ${
											activeTab === "activity"
												? "bg-[var(--nw-surface-soft)] text-[var(--nw-text)]"
												: "text-[var(--nw-subtle-text)] hover:text-[var(--nw-text)]"
										}`}
										onClick={() => setActiveTab("activity")}
										type="button"
									>
										LLMアクティビティ
									</button>
								</div>
							) : null}
							{activeTab === "activity" ? (
								<section className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
									{detail ? (
										<EvaluationHistorySidebar
											activeId={detail.evaluation.id}
											evaluations={controller.history}
											onSelect={controller.selectEvaluation}
										/>
									) : null}
									<ProjectEvaluationActivityPanel
										events={controller.activityEvents}
										isRunning={controller.isViewingRunningEvaluation}
									/>
								</section>
							) : detail ? (
								<>
									<EvaluationSummaryPanel
										evaluation={detail.evaluation}
										previous={controller.previousEvaluation}
									/>
									<section className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
										<EvaluationHistorySidebar
											activeId={detail.evaluation.id}
											evaluations={controller.history}
											onSelect={controller.selectEvaluation}
										/>
										<DimensionSelector
											dimensions={detail.evaluation.dimensions}
											onChange={controller.setSelectedKeys}
											selectedKeys={controller.selectedKeys}
										/>
									</section>
									<ImprovementIdeaGrid
										dimensions={detail.evaluation.dimensions}
										ideas={detail.improvements}
										isCreatingTasks={controller.isCreatingTasks}
										isGenerating={controller.isGenerating}
										onCreateTasks={controller.createTasks}
										onGenerate={controller.generateIdeas}
										onToggleIdea={controller.toggleIdea}
										selectedIdeaIds={controller.selectedIdeaIds}
										selectedKeys={controller.selectedKeys}
									/>
									<ProjectEvaluationTaskLinks links={detail.taskLinks} />
								</>
							) : null}
						</>
					)}
				</div>
			</div>
		</main>
	);
}
