import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { missionPilotPhaseRuns } from "../../db/mission-pilot-schema";
import * as repo from "../../modules/nightworkers/nightworkers.repository";
import {
	normalizeEvidenceRequirements,
	readEvidenceTodoMode,
} from "../run-control/evidence";
import { RunControlRepository } from "../run-control/run-control-repository";
import {
	buildStandardImplementationTodoList,
	type ImplementationTodoInput,
} from "../todo-runtime";
import type { WorkerToolResult } from "./types";

export * from "./todo-list-response";

import {
	currentSeqOrNull,
	failedTodoAction,
	failedTodoActionResult,
	isFinalCloseoutTodo,
	okTodoAction,
	resolveTargetTodo,
	toRecord,
	validateTodoListReplaceReason,
} from "./todo-list-response";

export * from "./todo-list-context";

import {
	requireDataMigrationGatesForContext,
	withTodoMutationContext,
} from "./todo-list-context";

export type TodoToolName = "todo_list";

export type TodoListOperation =
	| "list"
	| "replace"
	| "start"
	| "done"
	| "block"
	| "fail";
export type TodoListReplaceReason =
	| "initial_plan"
	| "scope_changed"
	| "estimate_changed"
	| "newly_required_work"
	| "blocked_replan";

export type TodoListPayloadTodo = {
	id: string;
	seq: number;
	title: string;
	description?: string | null;
	taskType: string;
	status: string;
	procedureId?: string | null;
	dependsOn?: Array<string | number> | null;
	startedAt?: Date | string | null;
	completedAt?: Date | string | null;
	evidenceRequirementsJson?: unknown;
	evidenceRefsJson?: string[] | null;
};

export type TodoActionDiagnostics = {
	errorCode?: string;
	attemptedAction?: {
		action: TodoToolName;
		operation?: TodoListOperation;
		seq?: number;
		todoListReplaceReason?: TodoListReplaceReason;
	};
	currentSnapshot?: {
		runningCount: number;
		runningSeqs: number[];
		pendingSeqs: number[];
	};
};

export type TodoActionTransition = {
	previousCurrentSeq?: number | null;
	nextCurrentSeq?: number | null;
	completedSeq?: number | null;
};

export type TodoActionPayload = {
	runId: string;
	taskId: string;
	action: TodoToolName;
	operation?: TodoListOperation;
	todos: TodoListPayloadTodo[];
	currentTodo?: TodoListPayloadTodo | null;
	nextTodo?: TodoListPayloadTodo | null;
	transition?: TodoActionTransition;
	diagnostics?: TodoActionDiagnostics;
};

export type TodoMutationContext = {
	runId: string;
	taskId: string;
	requireDataMigrationGates: boolean;
	verificationPolicy: import("../todo-runtime").TodoVerificationPolicy | null;
	todos: Awaited<ReturnType<typeof repo.listTaskRunTodosForRun>>;
};

export async function todoListTool(input: {
	runId: string;
	operation: TodoListOperation;
	seq?: number;
	todos?: ImplementationTodoInput[];
	startFirst?: boolean;
	todoListReplaceReason?: TodoListReplaceReason;
	evidenceRefs?: string[];
}): Promise<WorkerToolResult<TodoActionPayload>> {
	if (input.operation === "list") {
		return withTodoMutationContext(
			"todo_list",
			input.runId,
			input.operation,
			{},
			async (context) =>
				okTodoAction(
					"todo_list",
					input.operation,
					context.runId,
					context.taskId,
					context.todos,
				),
		);
	}

	if (input.operation === "replace") {
		return withTodoMutationContext(
			"todo_list",
			input.runId,
			input.operation,
			{ todoListReplaceReason: input.todoListReplaceReason },
			async ({
				runId,
				taskId,
				requireDataMigrationGates,
				verificationPolicy,
				todos: currentTodos,
			}) => {
				const [phaseRun] = await db
					.select({ phase: missionPilotPhaseRuns.phase })
					.from(missionPilotPhaseRuns)
					.where(eq(missionPilotPhaseRuns.runId, runId))
					.limit(1);
				if (phaseRun?.phase === "repository_bootstrap") {
					return failedTodoAction(
						{
							runId,
							taskId,
							requireDataMigrationGates,
							verificationPolicy,
							todos: currentTodos,
						},
						"todo_list",
						input.operation,
						"REPOSITORY_BOOTSTRAP_REPLAN_FORBIDDEN",
						{ todoListReplaceReason: input.todoListReplaceReason },
					);
				}
				const reasonValidation = validateTodoListReplaceReason({
					currentTodos,
					todoListReplaceReason: input.todoListReplaceReason,
				});
				if (!reasonValidation.ok) {
					return failedTodoAction(
						{
							runId,
							taskId,
							requireDataMigrationGates,
							verificationPolicy,
							todos: currentTodos,
						},
						"todo_list",
						input.operation,
						reasonValidation.errorCode,
						{ todoListReplaceReason: input.todoListReplaceReason },
					);
				}
				const todos = buildStandardImplementationTodoList({
					todos: input.todos ?? [],
					startFirst: input.startFirst,
					requireDataMigrationGates: requireDataMigrationGatesForContext({
						contextRequiresDataMigration: requireDataMigrationGates,
						todos: input.todos ?? [],
					}),
					verificationPolicy,
				});
				const created = await repo.replaceTaskRunTodosForRun(runId, todos);
				return okTodoAction(
					"todo_list",
					input.operation,
					runId,
					taskId,
					created,
					{
						transition: {
							previousCurrentSeq: null,
							nextCurrentSeq:
								created.find((todo) => todo.status === "running")?.seq ?? null,
						},
					},
				);
			},
		);
	}

	if (input.operation === "start") {
		return startTodo({
			runId: input.runId,
			action: "todo_list",
			operation: input.operation,
			seq: input.seq,
		});
	}

	if (input.operation === "done") {
		return completeTodo({
			runId: input.runId,
			action: "todo_list",
			operation: input.operation,
			seq: input.seq,
			status: "passed",
			startNext: true,
			evidenceRefs: input.evidenceRefs,
		});
	}

	if (input.operation === "block") {
		return completeTodo({
			runId: input.runId,
			action: "todo_list",
			operation: input.operation,
			seq: input.seq,
			status: "needs_human",
			startNext: false,
		});
	}

	if (input.operation === "fail") {
		return completeTodo({
			runId: input.runId,
			action: "todo_list",
			operation: input.operation,
			seq: input.seq,
			status: "failed",
			startNext: false,
		});
	}

	return failedTodoActionResult(
		new Date().toISOString(),
		"todo_list",
		input.operation,
		input.runId,
		"",
		"INVALID_TOOL_ARGS",
	);
}

async function startTodo(input: {
	runId: string;
	action: TodoToolName;
	operation: TodoListOperation;
	seq?: number;
}): Promise<WorkerToolResult<TodoActionPayload>> {
	return withTodoMutationContext(
		input.action,
		input.runId,
		input.operation,
		{ seq: input.seq },
		async (context) => {
			if (
				typeof input.seq !== "number" ||
				!Number.isInteger(input.seq) ||
				input.seq < 1
			) {
				return failedTodoAction(
					context,
					input.action,
					input.operation,
					"INVALID_TOOL_ARGS",
					{
						seq: input.seq,
					},
				);
			}

			const target = context.todos.find((todo) => todo.seq === input.seq);
			if (!target) {
				return failedTodoAction(
					context,
					input.action,
					input.operation,
					"TODO_SEQ_NOT_FOUND",
					{
						seq: input.seq,
					},
				);
			}
			if (!["pending", "running"].includes(target.status)) {
				return failedTodoAction(
					context,
					input.action,
					input.operation,
					"TODO_NOT_STARTABLE",
					{
						seq: input.seq,
					},
				);
			}
			const earlierOpenTodo = context.todos.find(
				(todo) =>
					todo.seq < target.seq && ["pending", "running"].includes(todo.status),
			);
			if (earlierOpenTodo) {
				return failedTodoAction(
					context,
					input.action,
					input.operation,
					"PREVIOUS_TODO_OPEN",
					{
						seq: input.seq,
					},
				);
			}

			const now = new Date();
			for (const candidate of context.todos) {
				if (candidate.id === target.id) {
					await repo.updateTaskRunTodo(
						candidate.id,
						{ status: "running", startedAt: now, completedAt: null },
						{ notifyTaskId: context.taskId, notifyRunId: context.runId },
					);
				} else if (candidate.status === "running") {
					await repo.updateTaskRunTodo(
						candidate.id,
						{ status: "pending", completedAt: null },
						{ notifyTaskId: context.taskId, notifyRunId: context.runId },
					);
				}
			}

			const updated = await repo.listTaskRunTodosForRun(context.runId);
			return okTodoAction(
				input.action,
				input.operation,
				context.runId,
				context.taskId,
				updated,
				{
					transition: {
						previousCurrentSeq: currentSeqOrNull(context.todos),
						nextCurrentSeq: input.seq,
					},
				},
			);
		},
	);
}

async function completeTodo(input: {
	runId: string;
	action: TodoToolName;
	operation: TodoListOperation;
	seq?: number;
	status: "passed" | "failed" | "needs_human";
	startNext: boolean;
	evidenceRefs?: string[];
}): Promise<WorkerToolResult<TodoActionPayload>> {
	return withTodoMutationContext(
		input.action,
		input.runId,
		input.operation,
		{ seq: input.seq },
		async (context) => {
			const currentValidation = resolveTargetTodo(context.todos, input.seq);
			if (!currentValidation.ok) {
				const idempotentPassedTodo =
					input.status === "passed" && input.seq !== undefined
						? context.todos.find(
								(todo) => todo.seq === input.seq && todo.status === "passed",
							)
						: null;
				if (idempotentPassedTodo) {
					return okTodoAction(
						input.action,
						input.operation,
						context.runId,
						context.taskId,
						context.todos,
						{
							transition: {
								previousCurrentSeq: currentSeqOrNull(context.todos),
								completedSeq: idempotentPassedTodo.seq,
								nextCurrentSeq: currentSeqOrNull(context.todos),
							},
						},
					);
				}
				return failedTodoAction(
					context,
					input.action,
					input.operation,
					currentValidation.errorCode,
					{
						seq: input.seq,
					},
				);
			}

			const current = currentValidation.todo;
			const evidenceRequirements = normalizeEvidenceRequirements(
				current.evidenceRequirementsJson,
			);
			const evidenceRefs = [...new Set(input.evidenceRefs ?? [])];
			const evidenceMode = readEvidenceTodoMode();
			const evidenceValidation =
				input.status === "passed" &&
				(evidenceRequirements.length > 0 || evidenceRefs.length > 0) &&
				evidenceMode !== "off"
					? await new RunControlRepository()
							.validateEvidenceRefs({
								runId: context.runId,
								evidenceRefs,
								requirements: evidenceRequirements,
								todoStartedAt: current.startedAt
									? new Date(String(current.startedAt))
									: null,
							})
							.catch(() => ({
								valid: false,
								acceptedRefs: [] as string[],
								unknownRefs: evidenceRefs,
								missingRequirements: evidenceRequirements.map(
									(requirement) => ({
										...requirement,
										minimumCount: requirement.minimumCount ?? 1,
										foundCount: 0,
									}),
								),
								workspaceRevision: null,
							}))
					: null;
			const enforceEvidence =
				evidenceMode === "enforce" ||
				(evidenceMode === "managed" && Boolean(current.procedureId));
			if (enforceEvidence && evidenceValidation && !evidenceValidation.valid) {
				return failedTodoAction(
					context,
					input.action,
					input.operation,
					"TODO_EVIDENCE_NOT_MET",
					{ seq: current.seq },
				);
			}
			const now = new Date();
			await repo.updateTaskRunTodo(
				current.id,
				{
					status: input.status,
					completedAt: now,
					startedAt: current.startedAt
						? new Date(String(current.startedAt))
						: now,
					evidenceRefsJson: evidenceRefs,
					completionGateResult: {
						...toRecord(current.completionGateResult),
						runControlEvidence: {
							mode: evidenceMode,
							requirements: evidenceRequirements,
							refs: evidenceRefs,
							validation: evidenceValidation,
						},
					},
				},
				{ notifyTaskId: context.taskId, notifyRunId: context.runId },
			);

			let nextSeq: number | null = null;
			let updated = await repo.listTaskRunTodosForRun(context.runId);
			if (input.startNext) {
				const nextTodo = updated.find(
					(todo) => todo.status === "pending" && todo.seq > current.seq,
				);
				if (nextTodo && !isFinalCloseoutTodo(nextTodo)) {
					const started =
						await repo.startTaskRunTodoIfStillPendingAndNoEarlierOpen(
							{
								id: nextTodo.id,
								runId: context.runId,
								afterSeq: current.seq,
								startedAt: new Date(),
							},
							{ notifyTaskId: context.taskId, notifyRunId: context.runId },
						);
					nextSeq = started?.seq ?? null;
					updated = await repo.listTaskRunTodosForRun(context.runId);
				}
			}

			return okTodoAction(
				input.action,
				input.operation,
				context.runId,
				context.taskId,
				updated,
				{
					transition: {
						previousCurrentSeq: current.seq,
						completedSeq: current.seq,
						nextCurrentSeq: nextSeq,
					},
				},
			);
		},
	);
}
