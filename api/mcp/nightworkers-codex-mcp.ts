import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { ensureNightWorkersSchema } from "../db/bootstrap";
import * as repo from "../modules/nightworkers/nightworkers.repository";
import {
	checkOntologyBoundary,
	classifyOntologyGoal,
	compileOntologyModuleContext,
	getModuleOntology,
	getOntologyVerificationPlan,
	listOntologyModules,
} from "../modules/ontology";
import {
	projectWorkerResultToMcpStructuredPayload,
	projectWorkerResultToNativeApiToolResult,
} from "../services/agent-runtime/native-api-runner/native-api-tool-result-projector";
import type { ToolOutcomeEnvelope } from "../services/run-control/contracts";
import { runControlService } from "../services/run-control/run-control-service";
import { deriveWorkerDomainOutcome } from "../services/run-control/tool-outcome-envelope";
import { importProjectTool } from "../services/worker-tools/import-project";
import {
	listRecentSpecificationsTool,
	readCurrentSpecificationTool,
} from "../services/worker-tools/read-current-specification";
import { reviewerEvaluationTool } from "../services/worker-tools/reviewer-evaluation";
import {
	completionCheckTool,
	runCheckTool,
} from "../services/worker-tools/run-check";
import { todoListTool } from "../services/worker-tools/todo-list";
import type { WorkerToolResult } from "../services/worker-tools/types";
import {
	isNightWorkersCodexToolAllowedForMode,
	type NightWorkersCodexToolName,
	nightWorkersCodexToolManifest,
} from "./nightworkers-tool-manifest";

type NightWorkersMcpRequestContext = {
	taskId?: string;
	runId?: string;
	executionMode?: string;
};

export function createNightWorkersCodexMcpServer(
	context: NightWorkersMcpRequestContext = {},
) {
	const server = new McpServer({
		name: "nightworkers",
		version: "0.1.0",
	});

	server.registerTool(
		"read_current_specification",
		{
			...nightWorkersCodexToolManifest.read_current_specification,
		},
		async ({ taskId, view, includeDesignContext }) => {
			const resolvedTaskId = firstNonEmpty(
				taskId,
				context.taskId,
				process.env.NIGHTWORKERS_TASK_ID,
			);
			const args = {
				taskId: resolvedTaskId,
				view,
				includeDesignContext,
			};
			return controlledToolResult({
				context,
				runId: firstNonEmpty(context.runId, process.env.NIGHTWORKERS_RUN_ID),
				toolName: "read_current_specification",
				arguments: args,
				execute: () =>
					readCurrentSpecificationTool({
						taskId: firstNonEmpty(
							taskId,
							context.taskId,
							process.env.NIGHTWORKERS_TASK_ID,
						),
						view,
						includeDesignContext,
					}),
			});
		},
	);

	server.registerTool(
		"list_recent_specifications",
		{
			...nightWorkersCodexToolManifest.list_recent_specifications,
		},
		async ({ limit }) =>
			controlledToolResult({
				context,
				runId: firstNonEmpty(context.runId, process.env.NIGHTWORKERS_RUN_ID),
				toolName: "list_recent_specifications",
				arguments: { limit },
				execute: () => listRecentSpecificationsTool({ limit }),
			}),
	);

	server.registerTool(
		"todo_list",
		{
			...nightWorkersCodexToolManifest.todo_list,
		},
		async ({
			runId,
			operation,
			seq,
			todos,
			startFirst,
			todoListReplaceReason,
			evidenceRefs,
		}) => {
			if (isToolDisabledForExecutionMode("todo_list", context)) {
				return toolResultToMcp(disabledToolResult("todo_list"));
			}
			const resolvedRunId = firstNonEmpty(
				runId,
				context.runId,
				process.env.NIGHTWORKERS_RUN_ID,
			);
			const args = {
				runId: resolvedRunId,
				operation,
				seq,
				todos,
				startFirst,
				todoListReplaceReason,
				evidenceRefs,
			};
			return controlledToolResult({
				context,
				runId: resolvedRunId,
				toolName: "todo_list",
				arguments: args,
				execute: () => todoListTool(args),
			});
		},
	);

	server.registerTool(
		"run_check",
		{
			...nightWorkersCodexToolManifest.run_check,
		},
		async ({
			runId,
			verificationDocumentId,
			command,
			cwd,
			checkKind,
			conditionIds,
			timeoutSeconds,
			displayMode,
		}) => {
			if (isToolDisabledForExecutionMode("run_check", context)) {
				return toolResultToMcp(disabledToolResult("run_check"));
			}
			const resolvedRunId = firstNonEmpty(
				runId,
				context.runId,
				process.env.NIGHTWORKERS_RUN_ID,
			);
			const resolved = await resolveTaskRepository({
				taskId: firstNonEmpty(context.taskId, process.env.NIGHTWORKERS_TASK_ID),
				runId: resolvedRunId,
			});
			const { task, repository } = resolved;
			if (!task || !repository) {
				return toolResultToMcp({
					ok: false,
					toolName: "run_check",
					startedAt: new Date().toISOString(),
					finishedAt: new Date().toISOString(),
					payload: null,
					error: {
						code: "TASK_REPOSITORY_NOT_FOUND",
						message: "Cannot resolve the current NightWorkers task repository.",
					},
				});
			}
			const args = {
				taskId: task.id,
				runId: resolvedRunId,
				verificationDocumentId,
				command,
				cwd,
				checkKind,
				conditionIds,
				timeoutSeconds,
				displayMode,
				repoRoot: repository.localPath,
				allowedPaths: repository.safetyPolicy?.allowedPaths,
				deniedPaths: repository.safetyPolicy?.deniedPaths,
				blockedCommands: repository.safetyPolicy?.blockedCommands,
				maxCommandSeconds: repository.safetyPolicy?.maxCommandSeconds,
			};
			return controlledToolResult({
				context,
				runId: resolvedRunId,
				toolName: "run_check",
				arguments: args,
				workspaceIdentity: repository.localPath,
				evidenceKind: "verification",
				execute: () => runCheckTool(args),
			});
		},
	);

	server.registerTool(
		"completion_check",
		{
			...nightWorkersCodexToolManifest.completion_check,
		},
		async ({ taskId, verificationDocumentId }) => {
			if (isToolDisabledForExecutionMode("completion_check", context)) {
				return toolResultToMcp(disabledToolResult("completion_check"));
			}
			const resolvedTaskId = firstNonEmpty(
				taskId,
				context.taskId,
				process.env.NIGHTWORKERS_TASK_ID,
			);
			const args = { taskId: resolvedTaskId, verificationDocumentId };
			return controlledToolResult({
				context,
				runId: firstNonEmpty(context.runId, process.env.NIGHTWORKERS_RUN_ID),
				toolName: "completion_check",
				arguments: args,
				evidenceKind: "completion-check",
				execute: () => completionCheckTool(args),
			});
		},
	);

	server.registerTool(
		"reviewer_evaluation",
		{
			...nightWorkersCodexToolManifest.reviewer_evaluation,
		},
		async ({ runId, rubricId, mode, persist }) => {
			if (isToolDisabledForExecutionMode("reviewer_evaluation", context)) {
				return toolResultToMcp(disabledToolResult("reviewer_evaluation"));
			}
			const resolvedRunId = firstNonEmpty(
				runId,
				context.runId,
				process.env.NIGHTWORKERS_RUN_ID,
			);
			const args = {
				runId: resolvedRunId,
				rubricId,
				mode,
				persist,
			};
			return controlledToolResult({
				context,
				runId: resolvedRunId,
				toolName: "reviewer_evaluation",
				arguments: args,
				evidenceKind: "reviewer-evaluation",
				execute: () => reviewerEvaluationTool(args),
			});
		},
	);

	server.registerTool(
		"import_project",
		{
			...nightWorkersCodexToolManifest.import_project,
		},
		async ({
			taskId,
			runId,
			source,
			stack,
			repoUrl,
			variant,
			overlays,
			targetPath,
			overwrite,
			exclude,
			ref,
			depth,
			stripGitDir,
			initialize,
		}) => {
			if (isToolDisabledForExecutionMode("import_project", context)) {
				return toolResultToMcp(disabledToolResult("import_project"));
			}
			const resolved = await resolveTaskRepository({
				taskId: firstNonEmpty(
					taskId,
					context.taskId,
					process.env.NIGHTWORKERS_TASK_ID,
				),
				runId: firstNonEmpty(
					runId,
					context.runId,
					process.env.NIGHTWORKERS_RUN_ID,
				),
			});
			const { task, repository } = resolved;
			if (!task || !repository) {
				return toolResultToMcp({
					ok: false,
					toolName: "import_project",
					startedAt: new Date().toISOString(),
					finishedAt: new Date().toISOString(),
					payload: { mode: "", template: null, git: null, postImport: null },
					error: {
						code: "TASK_REPOSITORY_NOT_FOUND",
						message: "Cannot resolve the current NightWorkers task repository.",
					},
				});
			}
			const resolvedRunId = firstNonEmpty(
				runId,
				context.runId,
				process.env.NIGHTWORKERS_RUN_ID,
			);
			const args = {
				source,
				stack,
				repoUrl,
				variant,
				overlays,
				targetPath,
				overwrite,
				exclude,
				ref,
				depth,
				stripGitDir,
				initialize,
				repoRoot: repository.localPath,
				allowedPaths: repository.safetyPolicy?.allowedPaths,
				deniedPaths: repository.safetyPolicy?.deniedPaths,
			};
			return controlledToolResult({
				context,
				runId: resolvedRunId,
				toolName: "import_project",
				arguments: args,
				workspaceIdentity: repository.localPath,
				execute: () => importProjectTool(args),
			});
		},
	);

	server.registerTool(
		"list_modules",
		{
			...nightWorkersCodexToolManifest.list_modules,
		},
		async ({ repoPath }) =>
			toolResultToMcp(
				await readOnlyOntologyTool("list_modules", async () =>
					listOntologyModules({
						repoPath: await resolveOntologyRepoPath(repoPath, context),
					}),
				),
			),
	);

	server.registerTool(
		"get_module_ontology",
		{
			...nightWorkersCodexToolManifest.get_module_ontology,
		},
		async ({ repoPath, module }) =>
			toolResultToMcp(
				await readOnlyOntologyTool("get_module_ontology", async () =>
					getModuleOntology({
						repoPath: await resolveOntologyRepoPath(repoPath, context),
						module,
					}),
				),
			),
	);

	server.registerTool(
		"classify_goal",
		{
			...nightWorkersCodexToolManifest.classify_goal,
		},
		async ({ repoPath, goal }) =>
			toolResultToMcp(
				await readOnlyOntologyTool("classify_goal", async () =>
					classifyOntologyGoal({
						repoPath: await resolveOntologyRepoPath(repoPath, context),
						goal,
					}),
				),
			),
	);

	server.registerTool(
		"compile_module_context",
		{
			...nightWorkersCodexToolManifest.compile_module_context,
		},
		async ({
			repoPath,
			goal,
			primaryModule,
			secondaryModules,
			repositoryId,
			missionId,
			taskCandidateId,
			taskGenerationEvidence,
			memoryEvidence,
			summaryType,
		}) => {
			return toolResultToMcp(
				await readOnlyOntologyTool("compile_module_context", async () =>
					compileOntologyModuleContext({
						repoPath: await resolveOntologyRepoPath(repoPath, context),
						goal,
						primaryModule,
						secondaryModules,
						repositoryId,
						missionId,
						taskCandidateId,
						taskId: await resolveOntologyTaskId(context),
						taskGenerationEvidence,
						memoryEvidence,
						summaryType,
					}),
				),
			);
		},
	);

	server.registerTool(
		"check_boundary",
		{
			...nightWorkersCodexToolManifest.check_boundary,
		},
		async ({ repoPath, primaryModule, secondaryModules, plannedFiles }) =>
			toolResultToMcp(
				await readOnlyOntologyTool("check_boundary", async () =>
					checkOntologyBoundary({
						repoPath: await resolveOntologyRepoPath(repoPath, context),
						primaryModule,
						secondaryModules,
						plannedFiles,
					}),
				),
			),
	);

	server.registerTool(
		"get_verification_plan",
		{
			...nightWorkersCodexToolManifest.get_verification_plan,
		},
		async ({ repoPath, primaryModule, secondaryModules }) =>
			toolResultToMcp(
				await readOnlyOntologyTool("get_verification_plan", async () =>
					getOntologyVerificationPlan({
						repoPath: await resolveOntologyRepoPath(repoPath, context),
						primaryModule,
						secondaryModules,
					}),
				),
			),
	);

	return server;
}

function firstNonEmpty(...values: Array<string | undefined | null>) {
	return (
		values.find((value) => typeof value === "string" && value.trim())?.trim() ??
		""
	);
}

async function resolveTaskRepository(input: { taskId: string; runId: string }) {
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

async function resolveOntologyRepoPath(
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

async function resolveOntologyTaskId(context: NightWorkersMcpRequestContext) {
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

async function readOnlyOntologyTool<TPayload>(
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

function isToolDisabledForExecutionMode(
	toolName: NightWorkersCodexToolName,
	context: NightWorkersMcpRequestContext,
) {
	const executionMode = firstNonEmpty(
		context.executionMode,
		process.env.NIGHTWORKERS_EXECUTION_MODE,
	);
	return !isNightWorkersCodexToolAllowedForMode(toolName, executionMode);
}

function disabledToolResult(
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

function isLoopbackHostname(hostname: string) {
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

function readNightWorkersMcpRequestContext(
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

function readSearchParam(url: URL, key: keyof NightWorkersMcpRequestContext) {
	const value = url.searchParams.get(key);
	return value?.trim() || undefined;
}

function toolResultToMcp(
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

async function controlledToolResult(input: {
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
