import { useMemo } from "react";
import { buildEvidenceCheckArtifact } from "../../codingAgent";
import {
	resolveLatestPlanWorkspaceArtifact,
	resolveLatestPlanWorkspaceTab,
} from "../../specification";
import type {
	ActivityArtifact,
	ImplementationQueueDashboard,
	PlanModeWorkspace,
	Repository,
	ReviewResult,
	ReviewSessionDetail,
	Task,
	TaskEvent,
	TaskMessage,
	TaskRun,
	TaskRunTodo,
	WorkbenchArtifactRef,
} from "../types";
import {
	buildWorkbenchArtifactRefs,
	buildWorkbenchSessionView,
	groupWorkbenchSessions,
} from "../workbenchSelectors";
import { toMs } from "../workbenchSelectorUtils";
import type { ProjectSessionGroups } from "./nightWorkersWorkspaceState";

function hasPlanModeWorkspaceEvidence(workspace: PlanModeWorkspace) {
	return Boolean(
		workspace.featurePlanArtifacts.length ||
			workspace.blueprintArtifacts.length ||
			workspace.dataModelArtifacts.length ||
			workspace.dedicatedViewArtifacts.length ||
			workspace.questionnaireSessions.length ||
			workspace.decisionReviews.length ||
			workspace.implementationReferences.length,
	);
}

function summarizePlanModeWorkspace(workspace: PlanModeWorkspace) {
	return [
		`${workspace.featurePlanArtifacts.length} spec`,
		`${workspace.blueprintArtifacts.length} Blueprint`,
		`${workspace.dataModelArtifacts.length} Data Model`,
		`${workspace.dedicatedViewArtifacts.length} Plan Views`,
		`${workspace.questionnaireSessions.length} Questionnaire`,
		`${workspace.decisionReviews.length} Decision Review`,
		`${workspace.implementationReferences.length} Implementation`,
	].join(" · ");
}

function buildPlanModeWorkspaceSourceMessageId(workspace: PlanModeWorkspace) {
	return (
		resolveLatestPlanWorkspaceArtifact(workspace)?.sourceMessageId ||
		workspace.decisionReviews[0]?.sourceMessageId ||
		workspace.implementationReferences[0]?.sourceMessageId ||
		workspace.questionnaireSessions[0]?.sourceBlueprintMessageId ||
		""
	);
}

export function restorePlanModeWorkspaceArtifactRefs(input: {
	refs: WorkbenchArtifactRef[];
	activeSession: Task;
	activePlanModeWorkspace: PlanModeWorkspace | null;
}): WorkbenchArtifactRef[] {
	if (
		!input.activePlanModeWorkspace ||
		!hasPlanModeWorkspaceEvidence(input.activePlanModeWorkspace)
	) {
		return input.refs;
	}
	const refs = [...input.refs];
	const existingIndex = refs.findIndex(
		(artifact) => artifact.kind === "plan_mode_workspace",
	);
	const existing = existingIndex >= 0 ? refs[existingIndex] : null;
	const latestArtifact = resolveLatestPlanWorkspaceArtifact(
		input.activePlanModeWorkspace,
	);
	const latestTab = resolveLatestPlanWorkspaceTab(
		input.activePlanModeWorkspace,
	);
	const restoredWorkspaceRef = {
		...(existing || {}),
		id: `plan-mode-workspace-${input.activeSession.id}`,
		taskId: input.activeSession.id,
		runId: existing?.runId,
		kind: "plan_mode_workspace" as const,
		title: "Plan Mode Workspace",
		summary: summarizePlanModeWorkspace(input.activePlanModeWorkspace),
		source: {
			type: "task_message" as const,
			messageId: buildPlanModeWorkspaceSourceMessageId(
				input.activePlanModeWorkspace,
			),
		},
		createdAt: String(
			latestArtifact?.createdAt ||
				existing?.createdAt ||
				input.activePlanModeWorkspace.generatedAt ||
				input.activeSession.updatedAt,
		),
		metadata: {
			...existing?.metadata,
			planModeWorkspace: input.activePlanModeWorkspace,
			...(latestTab ? { initialTab: latestTab } : {}),
		},
	};
	if (existingIndex >= 0) refs[existingIndex] = restoredWorkspaceRef;
	else refs.unshift(restoredWorkspaceRef);
	return refs.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
}

export function restoreEvidenceCheckArtifactRef(input: {
	refs: WorkbenchArtifactRef[];
	activeSession: Task;
	taskMessages: TaskMessage[];
}) {
	if (input.refs.some((artifact) => artifact.kind === "evidence_check")) {
		return input.refs;
	}
	const evidence = buildEvidenceCheckArtifact({
		taskId: input.activeSession.id,
		updatedAt: String(
			input.activeSession.updatedAt || input.activeSession.createdAt,
		),
		taskMessages: input.taskMessages,
		title: "Evidence Check",
		summary:
			"Implementation plan traceability and current verification evidence",
	});
	return evidence
		? [...input.refs, evidence].sort(
				(left, right) => toMs(right.createdAt) - toMs(left.createdAt),
			)
		: input.refs;
}

type UseNightWorkersSessionPresentationInput = {
	activeSession: Task | null;
	activePlanModeWorkspace: PlanModeWorkspace | null;
	implementationQueue: ImplementationQueueDashboard | null;
	latestRun: TaskRun | undefined;
	latestRunEvents: TaskEvent[];
	latestRunReviews: ReviewResult[];
	latestRunTodos: TaskRunTodo[];
	activeReviewSession: ReviewSessionDetail | null;
	taskMessages: TaskMessage[];
	activityArtifacts: ActivityArtifact[];
	sessions: Task[];
	projects: Repository[];
};

export function useNightWorkersSessionPresentation({
	activeSession,
	activePlanModeWorkspace,
	implementationQueue,
	latestRun,
	latestRunEvents,
	latestRunReviews,
	latestRunTodos,
	activeReviewSession,
	taskMessages,
	activityArtifacts,
	sessions,
	projects,
}: UseNightWorkersSessionPresentationInput) {
	const activeArtifactRefs = useMemo(() => {
		if (!activeSession) return [];
		const refs = buildWorkbenchArtifactRefs({
			task: activeSession,
			latestRun,
			todos: latestRunTodos,
			events: latestRunEvents,
			reviews: latestRunReviews,
			reviewSession: activeReviewSession,
			messages: taskMessages,
			activityArtifacts,
		});
		return restorePlanModeWorkspaceArtifactRefs({
			refs: restoreEvidenceCheckArtifactRef({
				refs,
				activeSession,
				taskMessages,
			}),
			activeSession,
			activePlanModeWorkspace,
		});
	}, [
		activeSession,
		activePlanModeWorkspace,
		activeReviewSession,
		latestRun,
		latestRunEvents,
		latestRunReviews,
		latestRunTodos,
		taskMessages,
		activityArtifacts,
	]);
	const queueEntryByTaskId = useMemo(() => {
		const map = new Map<
			string,
			ImplementationQueueDashboard["queued"][number]
		>();
		if (!implementationQueue) return map;
		const processorEntries = implementationQueue.processors
			.map((processor) => processor.entry)
			.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
		for (const entry of [
			...implementationQueue.queued,
			...processorEntries,
			...implementationQueue.completed,
		]) {
			map.set(entry.taskId, entry);
		}
		return map;
	}, [implementationQueue]);
	const planReadyTaskIds = useMemo(
		() =>
			new Set(
				(implementationQueue?.notQueued || []).map((item) => item.task.id),
			),
		[implementationQueue],
	);
	const activeSessionView = useMemo(
		() =>
			activeSession
				? buildWorkbenchSessionView(activeSession, {
						latestRun,
						queueEntry: queueEntryByTaskId.get(activeSession.id),
						planReady: planReadyTaskIds.has(activeSession.id),
						todos: latestRunTodos,
						events: latestRunEvents,
						reviews: latestRunReviews,
						messages: taskMessages,
					})
				: null,
		[
			activeSession,
			latestRun,
			latestRunEvents,
			latestRunReviews,
			latestRunTodos,
			planReadyTaskIds,
			queueEntryByTaskId,
			taskMessages,
		],
	);
	const sessionViews = useMemo(
		() =>
			sessions.map((session) =>
				session.id === activeSession?.id && activeSessionView
					? activeSessionView
					: buildWorkbenchSessionView(session, {
							queueEntry: queueEntryByTaskId.get(session.id),
							planReady: planReadyTaskIds.has(session.id),
						}),
			),
		[
			activeSession?.id,
			activeSessionView,
			planReadyTaskIds,
			queueEntryByTaskId,
			sessions,
		],
	);
	const groupedSessionViews = useMemo(() => {
		const grouped: Record<string, ProjectSessionGroups> = {};
		for (const project of projects) {
			grouped[project.id] = { processing: [], queue: [], archive: [] };
		}
		for (const session of sessionViews) {
			const repositoryId = session.task.repositoryId;
			grouped[repositoryId] ||= { processing: [], queue: [], archive: [] };
			grouped[repositoryId][session.group].push(session);
		}
		for (const groups of Object.values(grouped)) {
			const sorted = groupWorkbenchSessions([
				...groups.processing,
				...groups.queue,
				...groups.archive,
			]);
			let queuePosition = 0;
			groups.processing = sorted.processing;
			groups.queue = sorted.queue.map((session) => {
				if (session.emailState !== "queued")
					return { ...session, queuePosition: undefined };
				queuePosition += 1;
				return {
					...session,
					queuePosition: session.queueEntry?.queuePosition ?? queuePosition,
				};
			});
			groups.archive = sorted.archive;
		}
		return grouped;
	}, [projects, sessionViews]);
	const activeSessionViewWithQueuePosition = useMemo(() => {
		if (!activeSessionView) return null;
		const groups = groupedSessionViews[activeSessionView.task.repositoryId];
		if (!groups) return activeSessionView;
		return (
			groups.processing.find(
				(session) => session.task.id === activeSessionView.task.id,
			) ||
			groups.queue.find(
				(session) => session.task.id === activeSessionView.task.id,
			) ||
			groups.archive.find(
				(session) => session.task.id === activeSessionView.task.id,
			) ||
			activeSessionView
		);
	}, [activeSessionView, groupedSessionViews]);

	return {
		activeArtifactRefs,
		activeSessionView,
		activeSessionViewWithQueuePosition,
		groupedSessionViews,
		sessionViews,
	};
}
