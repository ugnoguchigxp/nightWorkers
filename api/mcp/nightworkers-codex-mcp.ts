import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	collectTestInventoryTool,
	recordTestConditionMappingTool,
	todoListTool,
} from "../modules/codingAgent";
import {
	checkOntologyBoundary,
	classifyOntologyGoal,
	compileOntologyModuleContext,
	getModuleOntology,
	getOntologyVerificationPlan,
	listOntologyModules,
} from "../modules/ontology";
import { importProjectTool } from "../services/worker-tools/import-project";
import {
	listRecentSpecificationsTool,
	readCurrentSpecificationTool,
} from "../services/worker-tools/read-current-specification";
import {
	completionCheckTool,
	runCheckTool,
} from "../services/worker-tools/run-check";
import { nightWorkersCodexToolManifest } from "./nightworkers-tool-manifest";

export type NightWorkersMcpRequestContext = {
	taskId?: string;
	runId?: string;
};

export * from "./nightworkers-codex-mcp-support";

import {
	controlledToolResult,
	firstNonEmpty,
	readOnlyOntologyTool,
	resolveOntologyRepoPath,
	resolveOntologyTaskId,
	resolveTaskRepository,
	toolResultToMcp,
} from "./nightworkers-codex-mcp-support";

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
		async ({ runId, command }) => {
			const resolvedRunId = firstNonEmpty(
				runId,
				context.runId,
				process.env.NIGHTWORKERS_RUN_ID,
			);
			const args = {
				runId: resolvedRunId,
				command,
			};
			return controlledToolResult({
				context,
				runId: resolvedRunId,
				toolName: "todo_list",
				arguments: args,
				idempotentSideEffect: command.op !== "list",
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
			const resolvedRunId = firstNonEmpty(
				runId,
				context.runId,
				process.env.NIGHTWORKERS_RUN_ID,
			);
			const resolved = await resolveTaskRepository({
				taskId: firstNonEmpty(context.taskId, process.env.NIGHTWORKERS_TASK_ID),
				runId: resolvedRunId,
			});
			const { task, repository, executionRoot } = resolved;
			if (!task || !repository || !executionRoot) {
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
				repoRoot: executionRoot,
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
				workspaceIdentity: executionRoot,
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
			const resolvedTaskId = firstNonEmpty(
				taskId,
				context.taskId,
				process.env.NIGHTWORKERS_TASK_ID,
			);
			const resolved = await resolveTaskRepository({
				taskId: resolvedTaskId,
				runId: firstNonEmpty(context.runId, process.env.NIGHTWORKERS_RUN_ID),
			});
			const args = {
				taskId: resolvedTaskId,
				verificationDocumentId,
				repoRoot: resolved.executionRoot ?? undefined,
			};
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
		"collect_test_inventory",
		{ ...nightWorkersCodexToolManifest.collect_test_inventory },
		async ({ runId, cwd }) => {
			const resolvedRunId = firstNonEmpty(
				runId,
				context.runId,
				process.env.NIGHTWORKERS_RUN_ID,
			);
			const resolved = await resolveTaskRepository({
				taskId: firstNonEmpty(context.taskId, process.env.NIGHTWORKERS_TASK_ID),
				runId: resolvedRunId,
			});
			if (!resolved.task || !resolved.repository || !resolved.executionRoot) {
				return toolResultToMcp({
					ok: false,
					toolName: "collect_test_inventory",
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
				taskId: resolved.task.id,
				runId: resolvedRunId,
				repoRoot: resolved.executionRoot,
				cwd,
				allowedPaths: resolved.repository.safetyPolicy?.allowedPaths,
				deniedPaths: resolved.repository.safetyPolicy?.deniedPaths,
				blockedCommands: resolved.repository.safetyPolicy?.blockedCommands,
				maxCommandSeconds: resolved.repository.safetyPolicy?.maxCommandSeconds,
			};
			return controlledToolResult({
				context,
				runId: resolvedRunId,
				toolName: "collect_test_inventory",
				arguments: args,
				workspaceIdentity: resolved.executionRoot,
				evidenceKind: "test-inventory",
				execute: () => collectTestInventoryTool(args),
			});
		},
	);

	server.registerTool(
		"record_test_condition_mapping",
		{ ...nightWorkersCodexToolManifest.record_test_condition_mapping },
		async (input) => {
			const taskId = firstNonEmpty(
				context.taskId,
				process.env.NIGHTWORKERS_TASK_ID,
			);
			const args = { taskId, ...input };
			return controlledToolResult({
				context,
				runId: firstNonEmpty(context.runId, process.env.NIGHTWORKERS_RUN_ID),
				toolName: "record_test_condition_mapping",
				arguments: args,
				evidenceKind: "test-condition-mapping",
				idempotentSideEffect: true,
				execute: () => recordTestConditionMappingTool(args),
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
				idempotentSideEffect: true,
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
