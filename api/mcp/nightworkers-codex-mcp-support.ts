import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ensureNightWorkersSchema } from "../db/bootstrap";
import * as repo from "../modules/nightworkers/nightworkers.repository";
import {
	projectWorkerResultToMcpStructuredPayload,
	projectWorkerResultToNativeApiToolResult,
} from "../services/agent-runtime/native-api-runner/native-api-tool-result-projector";
import type { ToolOutcomeEnvelope } from "../services/run-control/contracts";
import { runControlService } from "../services/run-control/run-control-service";
import { deriveWorkerDomainOutcome } from "../services/run-control/tool-outcome-envelope";
import type { WorkerToolResult } from "../services/worker-tools/types";
import {
	createNightWorkersCodexMcpServer,
	type NightWorkersMcpRequestContext,
} from "./nightworkers-codex-mcp";
import {
	isNightWorkersCodexToolAllowedForMode,
	type NightWorkersCodexToolName,
} from "./nightworkers-tool-manifest";

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
	const task = input.taskId ? await repo.getTask(input.taskId) : null;
	if (task) {
		return {
			task,
			repository: await repo.getRepository(task.repositoryId),
		};
	}

	const run = input.runId ? await repo.getTaskRun(input.runId) : null;
	if (!run) {
		return { task: null, repository: null };
	}
	const runTask = await repo.getTask(run.taskId);
	const repositoryId = run.repositoryId || runTask?.repositoryId || "";
	return {
		task: runTask ?? null,
		repository: repositoryId ? await repo.getRepository(repositoryId) : null,
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
	return resolved.repository?.localPath;
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

export function isToolDisabledForExecutionMode(
	toolName: NightWorkersCodexToolName,
	context: NightWorkersMcpRequestContext,
) {
	const executionMode = firstNonEmpty(
		context.executionMode,
		process.env.NIGHTWORKERS_EXECUTION_MODE,
	);
	return !isNightWorkersCodexToolAllowedForMode(toolName, executionMode);
}

export function disabledToolResult(
	toolName: NightWorkersCodexToolName,
): WorkerToolResult<unknown> {
	const now = new Date().toISOString();
	return {
		ok: false,
		toolName,
		startedAt: now,
		finishedAt: now,
		payload: null,
		error: {
			code: "PLAN_MODE_TOOL_DISABLED",
			message: `${toolName} is disabled in NightWorkers planning mode.`,
		},
	};
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
			executionMode: readSearchParam(url, "executionMode"),
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

export function toolResultToMcp(
	result: WorkerToolResult<unknown>,
	outcome?: ToolOutcomeEnvelope,
) {
	const text = projectWorkerResultToNativeApiToolResult(result).content;
	const domainOutcome =
		outcome?.domainOutcome ?? deriveWorkerDomainOutcome(result);
	const transportStatus = outcome?.transportStatus ?? "completed";
	return {
		isError: transportStatus !== "completed",
		structuredContent: {
			outcome: {
				transportStatus,
				domainOutcome,
				effect: outcome?.effect ?? "unknown",
				retryPolicy: outcome?.retryPolicy ?? "after_progress",
				progressRevisionBefore: outcome?.progressRevisionBefore ?? null,
				progressRevisionAfter: outcome?.progressRevisionAfter ?? null,
				actionKey: outcome?.actionKey ?? null,
				evidenceRefs: outcome?.evidenceRefs ?? [],
				artifactRefs: outcome?.artifactRefs ?? [],
			},
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
	execute: () => Promise<WorkerToolResult<unknown>>;
}) {
	const prepared = await runControlService.prepare({
		runId: input.runId,
		toolName: input.toolName,
		arguments: input.arguments,
		workspaceIdentity: input.workspaceIdentity,
	});
	if (prepared.kind === "terminal") {
		return {
			isError: false,
			structuredContent: {
				outcome: {
					transportStatus: "completed",
					domainOutcome: "blocked",
					effect: "none",
					retryPolicy: "never",
				},
				control: {
					terminal: true,
					terminalReason: prepared.state.terminalReason,
				},
			},
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({
						ok: false,
						code: "RUN_ALREADY_TERMINAL",
						terminalReason: prepared.state.terminalReason,
					}),
				},
			],
		};
	}
	if (prepared.kind === "reuse") {
		return {
			isError: prepared.action.transportStatus !== "completed",
			structuredContent: {
				outcome: {
					transportStatus: prepared.action.transportStatus,
					domainOutcome: prepared.action.domainOutcome,
					effect: prepared.action.effect,
					retryPolicy:
						prepared.action.domainOutcome === "failed"
							? "after_progress"
							: "immediate",
					progressRevisionBefore: prepared.action.progressRevision,
					progressRevisionAfter: prepared.state.progressRevision,
				},
				control: {
					reused: true,
					actionKey: prepared.action.actionKey,
					repeatCount: prepared.action.repeatCount,
					phase: prepared.state.phase,
					recoveryRequired: prepared.state.phase === "recovery",
					recoveryCard:
						prepared.state.phase === "recovery"
							? {
									progressRevision: prepared.state.progressRevision,
									workspaceRevision: prepared.state.workspaceRevision,
									lastResultDigest: prepared.action.resultDigest,
									required:
										"新しい観測、workspace/workflow変更、新しい証跡、またはblocker提示のいずれかを一つ行う",
								}
							: null,
				},
				payload: prepared.action.modelView,
			},
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({
						control: "reused_result",
						domainOutcome: prepared.action.domainOutcome,
						progressRevision: prepared.state.progressRevision,
						payload: prepared.action.modelView,
					}),
				},
			],
		};
	}

	const result = await input.execute();
	const modelView = projectWorkerResultToMcpStructuredPayload(result);
	const evidenceRefs = input.evidenceKind
		? [`${input.evidenceKind}:${input.runId}:${prepared.action.id}`]
		: [];
	const outcome = await runControlService.completeWorkerAction({
		prepared: {
			state: prepared.state,
			action: prepared.action,
			persisted: prepared.persisted,
		},
		result,
		modelView,
		evidenceRefs,
	});
	return toolResultToMcp(result, outcome);
}
