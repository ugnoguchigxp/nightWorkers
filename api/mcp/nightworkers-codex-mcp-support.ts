import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ensureNightWorkersSchema } from "../db/bootstrap";
import {
	loadCodingAgentContextPacket,
	projectWorkerResultToMcpStructuredPayload,
	projectWorkerResultToNativeApiToolResult,
} from "../modules/codingAgent";
import * as repo from "../modules/nightworkers/nightworkers.repository";
import { actionExecutionJournal } from "../services/run-control/action-execution-journal";
import type { WorkerToolResult } from "../services/worker-tools/types";
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
	const executionRoot = firstNonEmpty(
		run?.worktreePath,
		task.worktreePath,
		registeredRepoRoot,
	);
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
		if (!todoContext?.currentTodo) {
			return toolResultToMcp({
				ok: false,
				toolName: input.toolName,
				startedAt: new Date().toISOString(),
				finishedAt: new Date().toISOString(),
				payload: { planSummary: todoContext?.planSummary ?? null },
				error: {
					code: "CURRENT_TODO_REQUIRED",
					message:
						"workspace toolの実行前にTodo planを作成し、current Todoを開始してください。",
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
