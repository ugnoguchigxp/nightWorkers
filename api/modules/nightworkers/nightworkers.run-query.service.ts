import { NotFoundError } from "../../lib/errors";
import { getRunControlMetrics } from "../../services/run-control/metrics";
import { nativeLocalRunner } from "../../services/runner/NativeLocalRunner";
import { resolveMissionPilotRuntimeOwnership } from "../missionPilot/agent/mission-pilot-runtime-ownership.service";
import type { ReviewResult } from "../review/results/types";
import * as repo from "./nightworkers.repository";
import { hasFreshActiveRunHeartbeat } from "./run-orchestration/runtime-heartbeat";
import { applyMissionPilotTaskStatusAfterRun } from "./run-orchestration/task-status-projection-policy";

export async function getActiveTaskRun(taskId: string) {
	const task = await repo.getTask(taskId);
	if (!task) {
		throw new NotFoundError("Task not found");
	}
	const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
	return activeRuns[0] ?? null;
}

export async function recoverStaleActiveRuns(
	taskId: string,
	options: { force?: boolean } = {},
) {
	const task = await repo.getTask(taskId);
	if (!task) {
		throw new NotFoundError("Task not found");
	}

	const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
	if (activeRuns.length === 0) {
		return { hasRunning: false as const, recoveredRunIds: [] as string[] };
	}

	const recoveredRunIds: string[] = [];
	const ownership = await resolveMissionPilotRuntimeOwnership({ taskId });
	for (const activeRun of activeRuns) {
		const runnerStatus = await nativeLocalRunner.getStatus(activeRun.id);
		if (runnerStatus.status === "running") {
			return { hasRunning: true as const, recoveredRunIds };
		}
		if (!options.force && hasFreshActiveRunHeartbeat(activeRun.updatedAt)) {
			return { hasRunning: true as const, recoveredRunIds };
		}

		await repo.updateTaskRun(activeRun.id, {
			status: "failed",
			endedAt: new Date(),
			finishedAt: new Date(),
			summary: "Run recovered as failed after stale active-state detection.",
			finalJudgment: null,
		});
		if (ownership.kind === "agent") {
			await applyMissionPilotTaskStatusAfterRun({
				taskId,
				runId: activeRun.id,
				runStatus: "failed",
			});
			await import(
				"../missionPilot/agent/mission-pilot-task-event.adapter"
			).then(({ recordMissionPilotTaskEvent }) =>
				recordMissionPilotTaskEvent({
					taskId,
					type: "task_run.failed",
					sourceEventId: `stale-run-failed:${activeRun.id}:${activeRun.updatedAt.getTime()}`,
					taskRevision: task.updatedAt.getTime(),
					payload: { runId: activeRun.id, status: "failed" },
				}),
			);
		} else {
			await repo.updateTaskStatus(taskId, "failed");
		}
		await repo.createRunEvent({
			version: 1,
			runId: activeRun.id,
			taskId,
			timestamp: new Date().toISOString(),
			type: "run.recovered",
			severity: "warning",
			actor: "system",
			message: `Stale active run auto-recovered. Previous status was active but runner state is "${runnerStatus.status}".`,
			data: { runnerStatus: runnerStatus.status },
		});
		await repo.createTaskMessage({
			taskId,
			runId: activeRun.id,
			role: "system",
			content:
				"前回の実行は中断状態のまま残っていたため、失敗として確定しました。新しい依頼を継続します。",
			messageType: "text",
		});
		recoveredRunIds.push(activeRun.id);
	}

	return { hasRunning: false as const, recoveredRunIds };
}

export async function getTaskRun(runId: string) {
	const run = await repo.getTaskRun(runId);
	if (!run) return null;
	const todos = await repo.listTaskRunTodosForRun(runId);
	const events = await repo.listTaskEventsForRun(runId);
	const commitRecord = await repo.getTaskRunCommitRecord(runId);
	const runControl = await getRunControlMetrics(runId);
	const reviews = events
		.map(
			(event) =>
				(event.payloadJson as { reviewResult?: ReviewResult } | null)
					?.reviewResult,
		)
		.filter((reviewResult): reviewResult is ReviewResult =>
			Boolean(reviewResult),
		);
	return {
		...run,
		todos,
		events,
		reviews,
		...(commitRecord ? { commitRecord } : {}),
		...(runControl ? { runControl } : {}),
	};
}

export async function getOntologyRunDebugReport(runId: string) {
	const run = await repo.getTaskRun(runId);
	if (!run) return null;
	const events = await repo.listTaskEventsForRun(runId);
	const contextSnapshot = asRecord(run.contextSnapshot);
	const snapshotOntologyContext = asRecordOrNull(
		contextSnapshot.ontologyContext,
	);
	const snapshotBoundaryAudit = asRecordOrNull(
		contextSnapshot.ontologyBoundaryAudit,
	);
	const ontologyContext =
		snapshotOntologyContext ??
		findOntologyPayload(
			events,
			"ontology.runtime_context_snapshot",
			"ontologyContext",
		);
	const ontologyBoundaryAudit =
		snapshotBoundaryAudit ??
		findOntologyPayload(
			events,
			"ontology.boundary_closeout_audit",
			"ontologyBoundaryAudit",
		);

	const runtimeContextEvent = events.some(
		(event) =>
			readRunEventAction(event) === "ontology.runtime_context_snapshot",
	);
	const boundaryAuditEvent = events.some(
		(event) => readRunEventAction(event) === "ontology.boundary_closeout_audit",
	);
	const runtimeLane = stringOrNull(ontologyContext?.runtimeLane);
	const secondaryModules = arrayOfStrings(ontologyContext?.secondaryModules);
	const boundaryCrossings = arrayOfRecords(
		ontologyBoundaryAudit?.boundaryCrossings,
	);
	const needsConfirmation = arrayOfRecords(
		ontologyBoundaryAudit?.needsConfirmation,
	);
	const forbiddenTouched = arrayOfRecords(
		ontologyBoundaryAudit?.forbiddenTouched,
	);
	const unexplainedCrossingsCount = countUnexplainedCrossingPaths({
		boundaryCrossings,
		needsConfirmation,
		forbiddenTouched,
	});
	const focusedVerification = arrayOfStrings(
		asRecord(ontologyBoundaryAudit?.verificationSelection).focused,
	);
	const contextWarnings = arrayOfStrings(ontologyContext?.warnings);
	const boundaryWarnings = arrayOfStrings(ontologyBoundaryAudit?.warnings);

	return {
		runId: run.id,
		taskId: run.taskId,
		repositoryId: run.repositoryId ?? null,
		status: run.status,
		runtimeLane,
		ontologyContext,
		ontologyBoundaryAudit,
		evidenceSources: {
			contextSnapshot: Boolean(
				snapshotOntologyContext || snapshotBoundaryAudit,
			),
			runtimeContextEvent,
			boundaryAuditEvent,
		},
		summary: {
			available: Boolean(ontologyContext?.available),
			primaryModule: stringOrNull(ontologyContext?.primaryModule),
			secondaryModules,
			taskGenerationEvidence: Boolean(ontologyContext?.taskGenerationEvidence),
			boundaryDecision: stringOrNull(ontologyBoundaryAudit?.decision),
			touchedFilesCount: arrayOfStrings(ontologyBoundaryAudit?.touchedFiles)
				.length,
			unexplainedCrossingsCount,
			focusedVerificationCount: focusedVerification.length,
			focusedVerificationState: readFocusedVerificationState({
				testResults: run.testResults,
				auditAvailable: Boolean(ontologyBoundaryAudit?.available),
				focusedVerificationCount: focusedVerification.length,
			}),
		},
		warnings: uniqueStrings([...contextWarnings, ...boundaryWarnings]),
	};
}

export async function listTaskRunEvents(
	runId: string,
	options?: { afterSeq?: number },
) {
	const run = await repo.getTaskRun(runId);
	if (!run) throw new NotFoundError("Run not found");
	return repo.listTaskEventsForRun(runId, { afterSeq: options?.afterSeq });
}

export async function listTaskRunActivityEvents(
	runId: string,
	options?: { afterSeq?: number },
) {
	const run = await repo.getTaskRun(runId);
	if (!run) throw new NotFoundError("Run not found");
	const events = await repo.listActivityEventsForRun(runId, {
		afterSeq: options?.afterSeq,
	});
	const artifacts = await listReferencedActivityArtifacts(run.taskId, events);
	return { events, artifacts };
}

async function listReferencedActivityArtifacts(
	taskId: string,
	events: Array<{ artifactId?: string | null }>,
) {
	const artifactIds = new Set(
		events.map((event) => event.artifactId).filter(Boolean),
	);
	if (artifactIds.size === 0) return [];
	const artifacts = await repo.listActivityArtifactsForTask(taskId);
	return artifacts.filter((artifact) => artifactIds.has(artifact.id));
}

export async function listTaskRunEventsForReplay(input: {
	taskId: string;
	runId: string;
	afterSeq?: number;
}) {
	const run = await repo.getTaskRun(input.runId);
	if (!run || run.taskId !== input.taskId) {
		throw new NotFoundError("Run not found for task");
	}
	return repo.listTaskEventsForRun(input.runId, { afterSeq: input.afterSeq });
}

export async function getTaskRunsForTask(taskId: string) {
	return repo.listTaskRunsForTask(taskId);
}

function findOntologyPayload(
	events: Array<{ payloadJson?: unknown }>,
	action: string,
	field: string,
) {
	for (const event of events) {
		if (readRunEventAction(event) !== action) continue;
		const payload = readRunEventData(event);
		const value = asRecordOrNull(payload[field]);
		if (value) return value;
	}
	return null;
}

function readRunEventAction(event: { payloadJson?: unknown }) {
	return stringOrNull(readRunEventData(event).action);
}

function readRunEventData(event: { payloadJson?: unknown }) {
	const payload = asRecord(event.payloadJson);
	const runEvent = asRecord(payload.runEvent);
	return {
		...asRecord(payload.data),
		...asRecord(runEvent.data),
	};
}

function countUnexplainedCrossingPaths(input: {
	boundaryCrossings: Array<Record<string, unknown>>;
	needsConfirmation: Array<Record<string, unknown>>;
	forbiddenTouched: Array<Record<string, unknown>>;
}) {
	const paths = new Set<string>();
	for (const crossing of input.boundaryCrossings) {
		if (crossing.declaredSecondary) continue;
		for (const path of arrayOfStrings(crossing.paths)) paths.add(path);
	}
	for (const item of input.needsConfirmation) {
		const path = stringOrNull(item.path);
		if (path) paths.add(path);
	}
	for (const item of input.forbiddenTouched) {
		const path = stringOrNull(item.path);
		if (path) paths.add(path);
	}
	return paths.size;
}

function readFocusedVerificationState(input: {
	testResults: unknown;
	auditAvailable: boolean;
	focusedVerificationCount: number;
}): "passed" | "failed" | "selected" | "not_selected" | "unavailable" {
	const testResults = asRecord(input.testResults);
	if (testResults.passed === true) return "passed";
	if (testResults.passed === false) return "failed";
	if (input.focusedVerificationCount > 0) return "selected";
	return input.auditAvailable ? "not_selected" : "unavailable";
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
	const record = asRecord(value);
	return Object.keys(record).length > 0 ? record : null;
}

function arrayOfRecords(value: unknown): Array<Record<string, unknown>> {
	return Array.isArray(value) ? value.map(asRecord) : [];
}

function arrayOfStrings(value: unknown): string[] {
	return Array.isArray(value)
		? value
				.map((item) => stringOrNull(item))
				.filter((item): item is string => Boolean(item))
		: [];
}

function uniqueStrings(values: string[]) {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
