import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectScopeNavigation } from "@/modules/overview";
import { ProjectEvaluationScreen } from "@/modules/project-evaluation";
import { QualityScreen, useProjectQualityController } from "@/modules/quality";
import { TaskGenerationPanel } from "@/modules/taskGeneration";
import { measureProjectCodeSize, TechStackPanel } from "@/modules/techStack";
import type { ProjectDetailMetrics } from "../../../../shared/schemas/project-detail.schema";
import type {
	ProjectCodeSizeSnapshot,
	ProjectStackProfile,
} from "../../../../shared/schemas/tech-stack.schema";
import { ProjectDetailWorktrees } from "../../gitworktree";
import { createTask, fetchProjectDetailMetrics } from "../nightWorkersCommands";
import type { Task } from "../types";
import { emptyMetrics, readJsonResponse } from "./project-detail/data";
import { panelStyle, shellStyle } from "./project-detail/styles";
import type { ProjectDetailScreenProps } from "./project-detail/types";

export {
	applyMissionGoalTemplate,
	buildExpandedTaskGenerationState,
	buildTaskGenerationTreeRows,
	buildUnifiedTaskCandidates,
	GoalEditorDialog,
	TaskGenerationTreeTable,
	toggleMissionGoalTemplate,
} from "@/modules/taskGeneration";

export function isProjectStackDetected(
	stackProfile: ProjectStackProfile | null | undefined,
) {
	return Boolean(
		stackProfile &&
			stackProfile.manifestStatus === "found" &&
			stackProfile.technologies.length > 0,
	);
}

export function shouldRefreshProjectStackOnFocus(input: {
	stackProfile: ProjectStackProfile | null | undefined;
	stackRefreshInFlight: boolean;
	projectDetailLoadInFlight: boolean;
}) {
	return (
		!input.stackRefreshInFlight &&
		!input.projectDetailLoadInFlight &&
		!isProjectStackDetected(input.stackProfile)
	);
}

export function ProjectDetailScreen({
	project,
	activeTab,
	onActiveTabChange,
	onOpenProjectOverview,
	onEvaluationTasksCreated,
	onMissionTaskCandidatesCreated,
}: ProjectDetailScreenProps) {
	const [metrics, setMetrics] = useState<ProjectDetailMetrics>(emptyMetrics);
	const [busyAction, setBusyAction] = useState<string | null>(null);
	const [message, setMessage] = useState("");
	const stackFocusRefreshInFlightRef = useRef(false);
	const projectDetailLoadInFlightRef = useRef(false);
	const projectDetailLoadRequestRef = useRef(0);
	const qualityController = useProjectQualityController({
		repositoryId: project.id,
		projectRoot: project.localPath,
		onTasksCreated: onMissionTaskCandidatesCreated,
	});
	const loadProjectDetail = useCallback(async () => {
		const requestId = projectDetailLoadRequestRef.current + 1;
		projectDetailLoadRequestRef.current = requestId;
		projectDetailLoadInFlightRef.current = true;
		try {
			const metricsRes = await fetchProjectDetailMetrics(project.id);
			const nextMetrics =
				await readJsonResponse<ProjectDetailMetrics>(metricsRes);
			if (projectDetailLoadRequestRef.current === requestId) {
				setMetrics(nextMetrics);
			}
		} finally {
			if (projectDetailLoadRequestRef.current === requestId) {
				projectDetailLoadInFlightRef.current = false;
			}
		}
	}, [project.id]);

	useEffect(() => {
		let cancelled = false;
		projectDetailLoadRequestRef.current += 1;
		projectDetailLoadInFlightRef.current = false;
		stackFocusRefreshInFlightRef.current = false;
		setMetrics(emptyMetrics);
		setBusyAction(null);
		setMessage("");
		loadProjectDetail().catch((error) => {
			if (!cancelled)
				setMessage(error instanceof Error ? error.message : String(error));
		});
		return () => {
			cancelled = true;
		};
	}, [loadProjectDetail]);

	const refreshProjectStackOnFocus = useCallback(async () => {
		if (
			!shouldRefreshProjectStackOnFocus({
				stackProfile: metrics.stackProfile,
				stackRefreshInFlight: stackFocusRefreshInFlightRef.current,
				projectDetailLoadInFlight: projectDetailLoadInFlightRef.current,
			})
		) {
			return;
		}
		stackFocusRefreshInFlightRef.current = true;
		try {
			await loadProjectDetail();
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			stackFocusRefreshInFlightRef.current = false;
		}
	}, [loadProjectDetail, metrics.stackProfile]);

	useEffect(() => {
		const handleFocus = () => {
			void refreshProjectStackOnFocus();
		};
		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				void refreshProjectStackOnFocus();
			}
		};
		window.addEventListener("focus", handleFocus);
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			window.removeEventListener("focus", handleFocus);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [refreshProjectStackOnFocus]);

	const runCodeSizeAction = useCallback(async () => {
		setBusyAction("code-size:measure");
		setMessage("");
		try {
			const snapshot = await readJsonResponse<ProjectCodeSizeSnapshot>(
				await measureProjectCodeSize(project.id),
			);
			projectDetailLoadRequestRef.current += 1;
			projectDetailLoadInFlightRef.current = false;
			setMetrics((current) => ({ ...current, codeSizeSnapshot: snapshot }));
		} catch (error) {
			setMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusyAction(null);
		}
	}, [project.id]);

	return (
		<div
			className="nightworkers-scrollbar h-full min-h-0 overflow-y-auto p-4"
			style={shellStyle}
		>
			<div className="mx-auto max-w-7xl space-y-4">
				<ProjectScopeNavigation
					projectId={project.id}
					activeTab={activeTab}
					onTabChange={(tab) => {
						if (tab === "overview") onOpenProjectOverview();
						else onActiveTabChange(tab);
					}}
				/>
				{message ? (
					<div
						className="border px-3 py-2 text-xs"
						style={{ ...panelStyle, color: "var(--nw-danger)" }}
					>
						{message}
					</div>
				) : null}

				{activeTab === "mission" ? (
					<TaskGenerationPanel
						repositoryId={project.id}
						stackProfile={metrics.stackProfile}
						onTasksCreated={onMissionTaskCandidatesCreated}
					/>
				) : null}

				{activeTab === "evaluation" ? (
					<section
						className="min-h-[680px] overflow-hidden border"
						style={panelStyle}
					>
						<ProjectEvaluationScreen
							project={project}
							onTasksCreated={onEvaluationTasksCreated}
						/>
					</section>
				) : null}

				{activeTab === "quality" ? (
					<QualityScreen controller={qualityController} />
				) : null}

				{activeTab === "stack" ? (
					<TechStackPanel
						stackProfile={metrics.stackProfile}
						projectPath={project.localPath}
						codeSizeSnapshot={metrics.codeSizeSnapshot}
						currentGitHead={metrics.projectMeta?.git.head ?? null}
						measurementBusy={busyAction === "code-size:measure"}
						onMeasureCodeSize={() => void runCodeSizeAction()}
					/>
				) : null}

				{activeTab === "worktrees" ? (
					<ProjectDetailWorktrees
						repositoryId={project.id}
						onCreateTask={async (input) => {
							const task = await readJsonResponse<Task>(
								await createTask(input),
							);
							await onMissionTaskCandidatesCreated?.([task]);
						}}
					/>
				) : null}
			</div>
		</div>
	);
}
