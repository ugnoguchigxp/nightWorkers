import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ensureNightWorkersSchema } from "../../../db/bootstrap";
import type { WorkerToolResult } from "../../../services/worker-tools/types";
import {
	assertRequestedRunWorkspaceRoot,
	resolveRunWorkspaceAuthority,
} from "../../../services/workspace/run-workspace-authority.service";
import {
	buildCodingAgentRecoveryGuidance,
	contentDigest,
} from "../../agentsShare";
import * as repo from "../../nightworkers/nightworkers.repository";
import { actionExecutionJournal } from "../application/action-execution-journal";
import { loadCodingAgentContextPacket, requiresCurrentTodo } from "../context";
import {
	projectWorkerResultToMcpStructuredPayload,
	projectWorkerResultToNativeApiToolResult,
} from "../runtime/native-api-runner/native-api-tool-result-projector";
import {
	createNightWorkersCodexMcpServer,
	type NightWorkersMcpRequestContext,
} from "./nightworkers-codex-mcp";

export function firstNonEmpty(...values: Array<string | undefined | null>) {
	return (
		values.find((value) => typeof value === "string" && value.trim())?.trim() ??
		""
	);
}

export type RequestScopedIdentityResolution = {
	taskId: string;
	runId: string;
	discrepancies: Array<{
		field: "taskId" | "runId";
		supplied: string;
		authoritative: string;
	}>;
};

export function resolveRequestScopedIdentity(input: {
	context: NightWorkersMcpRequestContext;
	suppliedTaskId?: string | null;
	suppliedRunId?: string | null;
	fallbackTaskId?: string | null;
	fallbackRunId?: string | null;
}): RequestScopedIdentityResolution {
	const authoritativeTaskId = firstNonEmpty(
		input.context.taskId,
		input.fallbackTaskId,
	);
	const authoritativeRunId = firstNonEmpty(
		input.context.runId,
		input.fallbackRunId,
	);
	const suppliedTaskId = firstNonEmpty(input.suppliedTaskId);
	const suppliedRunId = firstNonEmpty(input.suppliedRunId);
	const discrepancies: RequestScopedIdentityResolution["discrepancies"] = [];
	if (
		suppliedTaskId &&
		authoritativeTaskId &&
		suppliedTaskId !== authoritativeTaskId
	) {
		discrepancies.push({
			field: "taskId",
			supplied: suppliedTaskId,
			authoritative: authoritativeTaskId,
		});
	}
	if (
		suppliedRunId &&
		authoritativeRunId &&
		suppliedRunId !== authoritativeRunId
	) {
		discrepancies.push({
			field: "runId",
			supplied: suppliedRunId,
			authoritative: authoritativeRunId,
		});
	}
	return {
		taskId: authoritativeTaskId || suppliedTaskId,
		runId: authoritativeRunId || suppliedRunId,
		discrepancies,
	};
}

export async function requestContextMismatchToMcp(input: {
	toolName: string;
	resolution: RequestScopedIdentityResolution;
	retryArguments: Record<string, unknown>;
}) {
	const resolved = await resolveTaskRepository({
		taskId: input.resolution.taskId,
		runId: input.resolution.runId,
	});
	const todoContext = input.resolution.runId
		? await loadCodingAgentContextPacket(input.resolution.runId)
		: null;
	const guidance = buildCodingAgentRecoveryGuidance({
		authoritativeContext: {
			taskId: (resolved.task?.id ?? input.resolution.taskId) || undefined,
			runId: (resolved.run?.id ?? input.resolution.runId) || undefined,
			repositoryRoot: resolved.executionRoot ?? undefined,
			planRevision: todoContext?.planSummary.planRevision,
			currentTodoId: todoContext?.currentTodo?.id,
		},
		observations: [
			{
				kind: "tool",
				summary: "tool入力とrequest-scoped identityの差分を確認しました。",
				digest: contentDigest(JSON.stringify(input.resolution.discrepancies)),
			},
		],
		discrepancies: input.resolution.discrepancies,
		unresolvedItems: [
			"訂正されたscoped identityで元のtool intentを再実行する。",
		],
		recoveryRefs: [],
		satisfactionConditions: [
			"tool引数のtaskIdとrunIdがrequest-scoped identityに一致する。",
			"訂正callが同じTask、Run、repositoryを解決する。",
		],
		intentKey: `scoped-retry:${contentDigest(
			JSON.stringify({
				toolName: input.toolName,
				retryArguments: input.retryArguments,
			}),
		)}`,
		retryArguments: input.retryArguments,
	});
	const now = new Date().toISOString();
	return toolResultToMcp({
		ok: false,
		toolName: input.toolName,
		startedAt: now,
		finishedAt: now,
		payload: {
			intentStatus: "not_executed",
			guidance,
		},
		error: {
			code: "REQUEST_CONTEXT_MISMATCH",
			message:
				"request-scoped identityとtool引数に差があります。guidanceの正本値とretryArgumentsを使って同じintentを再実行できます。",
		},
	});
}

export async function resolveTaskRepository(input: {
	taskId: string;
	runId: string;
}) {
	const run = input.runId ? await repo.getTaskRun(input.runId) : null;
	const requestedTask = input.taskId ? await repo.getTask(input.taskId) : null;
	if (requestedTask && run && run.taskId !== requestedTask.id) {
		return {
			task: null,
			run: null,
			repository: null,
			registeredRepoRoot: null,
			executionRoot: null,
		};
	}
	const task =
		requestedTask ?? (run ? await repo.getTask(run.taskId) : null) ?? null;
	if (!task) {
		return {
			task: null,
			run: run ?? null,
			repository: null,
			registeredRepoRoot: null,
			executionRoot: null,
		};
	}
	const repositoryId = run?.repositoryId || task.repositoryId;
	const repository = repositoryId
		? await repo.getRepository(repositoryId)
		: null;
	const registeredRepoRoot = repository?.localPath ?? null;
	const authority = run ? await resolveRunWorkspaceAuthority(run.id) : null;
	const executionRoot = authority?.ok
		? authority.executionRoot
		: run
			? null
			: firstNonEmpty(task.worktreePath, registeredRepoRoot);
	return {
		task,
		run: run ?? null,
		repository,
		registeredRepoRoot,
		executionRoot: executionRoot || null,
	};
}

export async function resolveOntologyRepoPath(
	explicitRepoPath: string | undefined,
	context: NightWorkersMcpRequestContext,
) {
	if (explicitRepoPath?.trim()) return explicitRepoPath.trim();
	const resolved = await resolveTaskRepository({
		taskId: firstNonEmpty(context.taskId, process.env.NIGHTWORKERS_TASK_ID),
		runId: firstNonEmpty(context.runId, process.env.NIGHTWORKERS_RUN_ID),
	});
	return resolved.executionRoot ?? resolved.repository?.localPath;
}

export async function resolveOntologyTaskId(
	context: NightWorkersMcpRequestContext,
) {
	const explicitTaskId = firstNonEmpty(
		context.taskId,
		process.env.NIGHTWORKERS_TASK_ID,
	);
	if (explicitTaskId) return explicitTaskId;
	const resolved = await resolveTaskRepository({
		taskId: "",
		runId: firstNonEmpty(context.runId, process.env.NIGHTWORKERS_RUN_ID),
	});
	return resolved.task?.id;
}

export async function readOnlyOntologyTool<TPayload>(
	toolName: string,
	callback: () => Promise<TPayload>,
): Promise<WorkerToolResult<TPayload | null>> {
	const startedAt = new Date().toISOString();
	try {
		const payload = await callback();
		return {
			ok: true,
			toolName,
			startedAt,
			finishedAt: new Date().toISOString(),
			payload,
		};
	} catch (error) {
		return {
			ok: false,
			toolName,
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: null,
			error: {
				code: "ONTOLOGY_TOOL_FAILED",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

export async function handleNightWorkersCodexMcpRequest(
	request: Request,
): Promise<Response> {
	if (!isLoopbackNightWorkersMcpRequest(request)) {
		return Response.json(
			{
				jsonrpc: "2.0",
				id: null,
				error: {
					code: -32000,
					message: "NightWorkers MCP is only available from loopback hosts.",
				},
			},
			{ status: 403 },
		);
	}
	await ensureNightWorkersSchema();
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
	});
	const server = createNightWorkersCodexMcpServer(
		readNightWorkersMcpRequestContext(request),
	);
	await server.connect(transport);
	return transport.handleRequest(request);
}

export function isLoopbackNightWorkersMcpRequest(request: Request) {
	try {
		return isLoopbackHostname(new URL(request.url).hostname);
	} catch {
		return false;
	}
}

export function isLoopbackHostname(hostname: string) {
	const normalized = hostname
		.toLowerCase()
		.replace(/^\[/, "")
		.replace(/\]$/, "");
	return (
		normalized === "localhost" ||
		normalized === "127.0.0.1" ||
		normalized === "::1"
	);
}

export function readNightWorkersMcpRequestContext(
	request: Request,
): NightWorkersMcpRequestContext {
	try {
		const url = new URL(request.url);
		return {
			taskId: readSearchParam(url, "taskId"),
			runId: readSearchParam(url, "runId"),
		};
	} catch {
		return {};
	}
}

export function readSearchParam(
	url: URL,
	key: Extract<keyof NightWorkersMcpRequestContext, string>,
) {
	const value = url.searchParams.get(key);
	return value?.trim() || undefined;
}

export function toolResultToMcp(result: WorkerToolResult<unknown>) {
	const text = projectWorkerResultToNativeApiToolResult(result).content;
	return {
		isError: !result.ok,
		structuredContent: {
			payload: projectWorkerResultToMcpStructuredPayload(result),
			...(result.error ? { error: result.error } : {}),
		},
		content: [{ type: "text" as const, text }],
	};
}

export async function controlledToolResult(input: {
	context: NightWorkersMcpRequestContext;
	runId: string;
	toolName: string;
	arguments: unknown;
	workspaceIdentity?: string | null;
	evidenceKind?: string;
	idempotentSideEffect?: boolean;
	execute: () => Promise<WorkerToolResult<unknown>>;
}) {
	const todoContext = await loadCodingAgentContextPacket(input.runId);
	if (input.toolName !== "todo_list") {
		const resolved = await resolveTaskRepository({
			taskId: firstNonEmpty(input.context.taskId),
			runId: input.runId,
		});
		const authority = resolved.executionRoot
			? await assertRequestedRunWorkspaceRoot({
					runId: input.runId,
					taskId: resolved.task?.id,
					requestedRoot: resolved.executionRoot,
				})
			: await resolveRunWorkspaceAuthority(input.runId);
		if (!authority.ok) {
			return toolResultToMcp({
				ok: false,
				toolName: input.toolName,
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				payload: {},
				error: {
					code: authority.code,
					message: authority.message,
				},
			});
		}
		if (requiresCurrentTodo(todoContext)) {
			return toolResultToMcp({
				ok: false,
				toolName: input.toolName,
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				payload: { planSummary: todoContext?.planSummary ?? null },
				error: {
					code: "CURRENT_TODO_REQUIRED",
					message:
						"Todo planが存在するため、workspace toolの実行前にcurrent Todoを開始してください。",
				},
			});
		}
	}
	const result = input.idempotentSideEffect
		? (
				await actionExecutionJournal.execute({
					runId: input.runId,
					toolName: input.toolName,
					arguments: input.arguments,
					workspaceIdentity: input.workspaceIdentity,
					dedupeRevision: 0,
					execute: input.execute,
				})
			).result
		: await input.execute();
	return toolResultToMcp(result);
}
