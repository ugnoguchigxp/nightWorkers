import { AppError, NotFoundError } from "../../../lib/errors";
import type {
	CodingAgentRequestProvenance,
	ResumeCodingAgentRunTodoCommand,
	ResumeInterruptedCodingAgentRunCommand,
	StartCodingAgentRunCommand,
} from "../../agentsShare";
import {
	registerCodingAgentRunHandlers,
	registerTaskRunAssociationHandler,
} from "../../agentsShare";
import * as repo from "../../nightworkers/nightworkers.repository";
import { resumeTaskRunTodo } from "../../nightworkers/run-orchestration/resume-task-run";
import { startTaskRun } from "../../nightworkers/run-orchestration/start-task-run-entry";
import { readArtifactOperatorContent } from "../../specification";
import { readCodingAgentPlanModeRequested } from "../context";
import { findInterruptedCodingAgentRunCandidate } from "./runtime-execution-ownership.service";

export const CODING_AGENT_REQUEST_ASSOCIATION_KIND = "coding_agent_request";

let unregister: (() => void) | null = null;

export function initializeCodingAgentRunHandlers() {
	if (unregister) return unregister;
	const unregisterRunHandlers = registerCodingAgentRunHandlers({
		start: handleStartCodingAgentRun,
		resume: handleResumeCodingAgentRunTodo,
		resumeInterrupted: handleResumeInterruptedCodingAgentRun,
	});
	const unregisterAssociation = registerTaskRunAssociationHandler(
		CODING_AGENT_REQUEST_ASSOCIATION_KIND,
		handleCodingAgentRequestAssociation,
	);
	unregister = () => {
		unregisterRunHandlers();
		unregisterAssociation();
		unregister = null;
	};
	return unregister;
}

export async function handleStartCodingAgentRun(
	command: StartCodingAgentRunCommand,
) {
	const [task, repository, artifacts] = await Promise.all([
		repo.getTask(command.taskId),
		repo.getRepository(command.repositoryRef.id),
		Promise.all(
			command.artifactRefs.map((ref) =>
				readArtifactOperatorContent({
					taskId: command.taskId,
					artifactId: ref.id,
				}),
			),
		),
	]);
	if (!task) throw new NotFoundError("Task not found");
	if (
		command.taskRef.id !== task.id ||
		command.taskRef.revision !== task.revision
	) {
		throw new AppError(
			409,
			"TASK_REVISION_CONFLICT",
			"Task revision changed; re-read the Task Operator view.",
		);
	}
	if (!repository || task.repositoryId !== repository.id)
		throw new NotFoundError("Repository not found for Task");
	const repositoryRevision = repository.updatedAt.getTime();
	if (repositoryRevision !== command.repositoryRef.revision) {
		throw new AppError(
			409,
			"REPOSITORY_REVISION_CONFLICT",
			"Repository revision changed; re-read the Task Operator view.",
		);
	}
	for (const [index, ref] of command.artifactRefs.entries()) {
		const artifact = artifacts[index];
		if (
			!artifact ||
			artifact.kind !== ref.kind ||
			artifact.revision !== ref.revision ||
			artifact.digest !== ref.digest
		) {
			throw new AppError(
				409,
				"ARTIFACT_REVISION_CONFLICT",
				"Artifact reference changed; re-read the Task Operator view.",
			);
		}
	}
	const run = await startTaskRun(command.taskId, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		planModeRequested: command.planModeRequested === true,
		latestUserMessageOverride: command.instruction,
		runAssociation: command.requestProvenance.orchestrationRef
			? {
					kind: CODING_AGENT_REQUEST_ASSOCIATION_KIND,
					payload: {
						requestProvenance: command.requestProvenance,
						taskRef: command.taskRef,
						artifactRefs: command.artifactRefs,
					},
				}
			: undefined,
	});
	return { runId: run.id, taskId: run.taskId, status: run.status };
}

export async function handleResumeCodingAgentRunTodo(
	command: ResumeCodingAgentRunTodoCommand,
) {
	const run = await resumeTaskRunTodo(command);
	await recordRequestProvenance(run.id, command.requestProvenance);
	return { runId: run.id, taskId: run.taskId, status: run.status };
}

export async function handleResumeInterruptedCodingAgentRun(
	command: ResumeInterruptedCodingAgentRunCommand,
) {
	const candidate =
		await findInterruptedCodingAgentRunCandidateForCommand(command);
	const existingRun = await repo.getTaskRun(candidate.runId);
	if (!existingRun) throw new NotFoundError("Run not found");
	await repo.createRunEvent({
		version: 1,
		runId: existingRun.id,
		taskId: existingRun.taskId,
		timestamp: new Date().toISOString(),
		type: "run.resume_requested",
		severity: "info",
		actor: "human",
		message: "User requested continuation of an interrupted Coding Agent Run.",
		data: {
			interruptionRevision: command.expectedInterruptionRevision,
			routingSnapshotDigest: command.routingSnapshotDigest,
			requestProvenance: command.requestProvenance,
		},
	});
	const run = await startTaskRun(existingRun.taskId, {
		executionMode: "implementation",
		executionModeSource: "explicit",
		planModeRequested: readCodingAgentPlanModeRequested(
			existingRun.contextSnapshot,
		),
		resumeRunId: existingRun.id,
		latestUserMessageOverride: command.userContext,
		resumeCommand: {
			kind: "process_interruption",
			expectedInterruptionRevision: command.expectedInterruptionRevision,
			todoId: command.todoId,
			expectedTodoRevision: command.expectedTodoRevision,
			userContext: command.userContext,
		},
	});
	await recordRequestProvenance(run.id, command.requestProvenance);
	return { runId: run.id, taskId: run.taskId, status: run.status };
}

async function findInterruptedCodingAgentRunCandidateForCommand(
	command: ResumeInterruptedCodingAgentRunCommand,
) {
	const run = await repo.getTaskRun(command.runId);
	if (!run) throw new NotFoundError("Run not found");
	const candidate = await findInterruptedCodingAgentRunCandidate(run.taskId);
	if (
		!candidate ||
		candidate.runId !== command.runId ||
		candidate.interruptionRevision !== command.expectedInterruptionRevision ||
		candidate.todoId !== command.todoId ||
		candidate.todoRevision !== command.expectedTodoRevision ||
		candidate.routingSnapshotDigest !== command.routingSnapshotDigest
	) {
		throw new AppError(
			409,
			"RUN_RESUME_SNAPSHOT_CONFLICT",
			"Interrupted Run state changed; reload the latest Task state.",
		);
	}
	return candidate;
}

async function recordRequestProvenance(
	runId: string,
	requestProvenance:
		| StartCodingAgentRunCommand["requestProvenance"]
		| ResumeCodingAgentRunTodoCommand["requestProvenance"]
		| ResumeInterruptedCodingAgentRunCommand["requestProvenance"],
) {
	const run = await repo.getTaskRun(runId);
	if (!run) return;
	await repo.createRunEvent({
		version: 1,
		runId,
		taskId: run.taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: "info",
		actor: "system",
		message: "Coding Agent request provenance recorded for audit.",
		data: { action: "coding_agent.requested", requestProvenance },
	});
}

async function handleCodingAgentRequestAssociation(input: {
	taskId: string;
	runId: string;
	payload: unknown;
}) {
	const payload = record(input.payload);
	const requestProvenance = readRequestProvenance(payload.requestProvenance);
	if (!requestProvenance)
		throw new AppError(
			422,
			"CODING_AGENT_REQUEST_PROVENANCE_INVALID",
			"Coding Agent request provenance is invalid.",
		);
	const run = await repo.getTaskRun(input.runId);
	if (!run || run.taskId !== input.taskId)
		throw new NotFoundError("Run not found for Task");
	await recordRequestProvenance(input.runId, requestProvenance);
}

function readRequestProvenance(
	value: unknown,
): CodingAgentRequestProvenance | null {
	const candidate = record(value);
	const requestedBy = record(candidate.requestedBy);
	if (
		(requestedBy.kind !== "human" && requestedBy.kind !== "automation") ||
		typeof requestedBy.actorId !== "string" ||
		requestedBy.actorId.length === 0
	)
		return null;
	let parsedOrchestrationRef: CodingAgentRequestProvenance["orchestrationRef"];
	if (candidate.orchestrationRef === null) {
		parsedOrchestrationRef = null;
	} else {
		const orchestrationRef = record(candidate.orchestrationRef);
		const kind = orchestrationRef.kind;
		const id = orchestrationRef.id;
		if (typeof kind !== "string" || typeof id !== "string") return null;
		parsedOrchestrationRef = { kind, id };
	}
	return {
		requestedBy: {
			kind: requestedBy.kind,
			actorId: requestedBy.actorId,
		},
		orchestrationRef: parsedOrchestrationRef,
	};
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
