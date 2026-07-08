import fs from "node:fs/promises";
import { AppError, NotFoundError } from "../../../lib/errors";
import { getCurrentSettings } from "../../../routes/settings";
import {
	type NativeApiExecutionMode,
	nativeApiRoleForExecutionMode,
	stateCardRoleForExecutionMode,
} from "../../../services/agent-runtime/native-api-runner/native-api-mode";
import { buildNativeApiRoleContextSnapshot } from "../../../services/agent-runtime/native-api-runner/native-api-role-context-events";
import {
	buildOntologyRuntimeContextDisabledSnapshot,
	buildOntologyRuntimeContextSnapshot,
	ontologySnapshotEventSeverity,
} from "../../../services/agent-runtime/ontology-runtime-context";
import { resolveRuntimeLaneDefinition } from "../../../services/agent-runtime/registry";
import {
	readRuntimeLaneConfigFromEnv,
	resolveRuntimeLane,
} from "../../../services/agent-runtime/runtime-lane";
import { buildPromptWithStateCardParts } from "../../../services/conversation-context";
import { projectConversationStateCardForRuntime } from "../../../services/conversation-context/state-card-projection";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../../services/settings/general-settings";
import { resolveStructuredLlmRoleRoute } from "../../../services/structured-llm/role-routing";
import { readStructuredLlmProviderSettings } from "../../../services/structured-llm/settings";
import { digestText } from "../../../services/text-digest";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import {
	buildStandardImplementationTodoList,
	deriveTodoVerificationPolicyFromPromptText,
	type ImplementationTodoInput,
} from "../../../services/todo-runtime";
import { getFreshProjectMeta } from "../../project-detail/project-meta.service";
import { resolveBlueprintPlanningReadiness } from "../nightworkers.basic.service";
import * as repo from "../nightworkers.repository";
import { readGitBaseline } from "./git-ownership";
import { launchRuntimeExecution } from "./runtime-execution";
import {
	buildCompiledPromptText,
	buildEffectiveLlmRoutingSnapshot,
	buildLatestRuntimeUserMessage,
	findLatestImplementationHandoffMessage,
	IMPLEMENTATION_PHASE_PREAMBLE,
	loadCodexRuntimeResumeState,
	maybeLoadConversationStateCard,
	readMessageLlmRouteOverride,
	resolveExecutionModeFromMessages,
	resolveLatestJobTypeFromMessages,
	resolveRuntimeLaneForRoleRoute,
} from "./runtime-routing";
import { toAgentRuntimeTodoContext } from "./todo-closeout";
import { toErrorMessage } from "./utils";

export type StartTaskRunOptions = {
	executionMode?: NativeApiExecutionMode;
	executionModeSource?:
		| "message_history"
		| "workbench_intake"
		| "workbench_run"
		| "workbench_run_task"
		| "implementation_queue"
		| "session_queue"
		| "review_run"
		| "test_mode"
		| "explicit";
	initialTodos?: ImplementationTodoInput[];
	runtimeOptionsPatch?: Record<string, unknown>;
};

export async function startTaskRun(
	taskId: string,
	options: StartTaskRunOptions = {},
) {
	const task = await repo.getTask(taskId);
	if (!task) {
		throw new NotFoundError("Task not found");
	}
	const activeRuns = await repo.listActiveTaskRunsForTask(taskId);
	if (activeRuns.length > 0) {
		throw new AppError(
			409,
			"RUN_ALREADY_ACTIVE",
			"Another run is already active for this task",
		);
	}

	// 1. Mark the task as running while the runtime prompt is prepared.
	await repo.updateTaskStatus(taskId, "running");

	// 2. Fetch repo information and create the run before compiling context.
	const repoInfo = await repo.getRepository(task.repositoryId);
	if (!repoInfo?.localPath) {
		throw new AppError(
			422,
			"REPO_PATH_INVALID",
			"Repository path is not configured",
		);
	}
	let stat: Awaited<ReturnType<typeof fs.stat>>;
	try {
		stat = await fs.stat(repoInfo.localPath);
	} catch {
		throw new AppError(
			422,
			"REPO_PATH_INVALID",
			"Repository path does not exist",
		);
	}
	if (!stat.isDirectory()) {
		throw new AppError(
			422,
			"REPO_PATH_INVALID",
			"Repository path is not a directory",
		);
	}
	const projectMeta = await getFreshProjectMeta(repoInfo);
	const ontologyMcpEnabled = isOntologyMcpEnabledForProjectMeta(projectMeta);
	const messages = await repo.listTaskMessages(taskId);
	const lastUserMessage = [...messages]
		.reverse()
		.find((message) => message.role === "user");
	const llmRouteOverride = readMessageLlmRouteOverride(lastUserMessage);
	const jobType = resolveLatestJobTypeFromMessages(messages);
	const executionMode =
		options.executionMode ?? resolveExecutionModeFromMessages(messages);
	const executionModeSource = options.executionMode
		? (options.executionModeSource ?? "explicit")
		: "message_history";
	const implementationHandoffMessage =
		executionMode === "implementation"
			? findLatestImplementationHandoffMessage(messages)
			: undefined;
	const compiledPromptText = buildCompiledPromptText({
		task,
		lastUserMessage,
		implementationHandoffMessage,
	});
	if (!compiledPromptText.trim()) {
		throw new AppError(
			400,
			"EMPTY_PROMPT",
			"No user message found to start a run",
		);
	}
	const verificationPolicy =
		deriveTodoVerificationPolicyFromPromptText(compiledPromptText);
	const runtimeRole = nativeApiRoleForExecutionMode(executionMode);
	const blueprintReadiness =
		executionMode === "general_answer"
			? null
			: await resolveBlueprintPlanningReadiness(taskId);
	const blueprintPlanningSnapshot =
		executionMode === "general_answer"
			? {}
			: { blueprintPlanning: blueprintReadiness };
	const runtimeRoleLabel =
		executionMode === "general_answer"
			? "general_answer"
			: runtimeRole === "implementation"
				? "Implementation"
				: runtimeRole;
	const settings = getCurrentSettings();
	const generalSettings = readGeneralSettings();
	const planModeSettingsSnapshot =
		buildPlanModeSettingsSnapshot(generalSettings);
	const llmUsageSettingsSnapshot = generalSettings.llmUsage ?? {
		promptPartObservabilityEnabled: true,
	};
	const baseRuntimeLaneResolution = resolveRuntimeLane({
		settingsRuntimeLane: settings.IMPLEMENTATION_RUNTIME_LANE,
		activeLlmProvider: settings.ACTIVE_LLM_PROVIDER,
		codexEnabled: settings.CODEX_ENABLED,
		...readRuntimeLaneConfigFromEnv(),
	});
	const structuredLlmSettings = readStructuredLlmProviderSettings();
	const runtimeLlmRoute = resolveStructuredLlmRoleRoute({
		role: runtimeRole,
		settings: structuredLlmSettings,
		override: llmRouteOverride,
	});
	const runtimeLaneResolution = resolveRuntimeLaneForRoleRoute(
		baseRuntimeLaneResolution,
		runtimeLlmRoute,
		executionMode,
	);
	const runtimeLaneDefinition = resolveRuntimeLaneDefinition(
		runtimeLaneResolution.lane,
	);
	const effectiveLlmRouting = buildEffectiveLlmRoutingSnapshot({
		activeRole: runtimeRole,
		executionMode,
		settings: structuredLlmSettings,
		activeRoute: runtimeLlmRoute,
		override: llmRouteOverride,
	});
	const gitBaseline = await readGitBaseline(repoInfo.localPath);
	const run = await repo.createTaskRun({
		taskId,
		repositoryId: task.repositoryId,
		status: "running",
		workerKind: runtimeLaneResolution.workerKind,
		baseRef: gitBaseline.baselineHead,
		timeoutSeconds: task.timeoutSeconds,
		contextSnapshot: {
			compiledPrompt: compiledPromptText,
			executionMode,
			executionModeSource,
			jobType,
			verificationPolicy,
			planModeSettingsSnapshot,
			...blueprintPlanningSnapshot,
			runtimeLane: runtimeLaneResolution.lane,
			runtimeLaneResolution: {
				workerKind: runtimeLaneResolution.workerKind,
				source: runtimeLaneResolution.source,
				diagnostics: runtimeLaneResolution.diagnostics,
			},
			effectiveLlmRouting,
		},
		startedAt: new Date(),
	});
	await repo.createTaskRunCommitRecord({
		runId: run.id,
		repositoryId: task.repositoryId,
		status: gitBaseline.status,
		baselineHead: gitBaseline.baselineHead,
		baselineStatusJson: gitBaseline.baselineStatusJson,
		preExistingDirtyPaths: gitBaseline.preExistingDirtyPaths,
		statusReason: gitBaseline.statusReason,
	});
	const runtimeLaneSetupInput = {
		compiledPromptText,
		executionMode,
		jobType,
		runtimeLaneResolution,
		implementationLlmRoute: runtimeLlmRoute,
		llmRouteOverride,
		planModeSettingsSnapshot,
		llmUsageSettingsSnapshot,
	};
	const runtimeOptions = {
		...runtimeLaneDefinition.buildRuntimeOptions(runtimeLaneSetupInput),
		...(options.runtimeOptionsPatch ?? {}),
	};
	const initialTodos =
		options.initialTodos ??
		runtimeLaneDefinition.buildInitialTodos(runtimeLaneSetupInput);
	await repo.replaceTaskRunTodosForRun(
		run.id,
		executionMode === "planning" || executionMode === "general_answer"
			? []
			: buildStandardImplementationTodoList({
					todos: initialTodos,
					startFirst: true,
					requireDataMigrationGates: jobType === "data_migration",
					verificationPolicy,
				}),
	);

	await repo.createRunEvent({
		version: 1,
		runId: run.id,
		taskId,
		timestamp: new Date().toISOString(),
		type: "run.created",
		severity: "info",
		actor: "system",
		message: "Task run created. Runtime prompt is being prepared.",
		data: {
			contextSource: "task_prompt",
			executionMode,
			executionModeSource,
			runtimeRole,
			planModeSettingsSnapshot,
			...blueprintPlanningSnapshot,
			runtimeLane: runtimeLaneResolution.lane,
			workerKind: runtimeLaneResolution.workerKind,
			runtimeLaneResolution,
			effectiveLlmRouting,
		},
	});
	await repo.createRunEvent({
		version: 1,
		runId: run.id,
		taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: "info",
		actor: "system",
		message: runtimeLlmRoute
			? `${runtimeRoleLabel} LLM route resolved: ${runtimeLlmRoute.model} (${runtimeLlmRoute.providerEndpointId}); runtime lane=${runtimeLaneResolution.lane} worker=${runtimeLaneResolution.workerKind}.`
			: `${runtimeRoleLabel} LLM route was not configured; runtime lane=${runtimeLaneResolution.lane} worker=${runtimeLaneResolution.workerKind}.`,
		data: {
			effectiveLlmRouting,
			executionMode,
			runtimeRole,
			runtimeLane: runtimeLaneResolution.lane,
			workerKind: runtimeLaneResolution.workerKind,
			runtimeLaneResolution,
		},
	});
	const contextSnapshot: RuntimePromptSnapshot = {
		compiledPrompt: compiledPromptText,
		source: "task_prompt",
		degraded: false,
		executionMode,
		executionPhase: executionMode,
		executionModeSource,
		verificationPolicy,
		planModeClosed: executionMode !== "planning",
		planModeSettingsSnapshot,
		...blueprintPlanningSnapshot,
		runtimeLane: runtimeLaneResolution.lane,
		runtimeLaneResolution: {
			workerKind: runtimeLaneResolution.workerKind,
			source: runtimeLaneResolution.source,
			diagnostics: runtimeLaneResolution.diagnostics,
		},
		effectiveLlmRouting,
		...(runtimeOptions.reviewRun
			? { reviewRun: runtimeOptions.reviewRun }
			: {}),
		projectMeta,
		ontologyMcp: {
			enabled: ontologyMcpEnabled,
			source: "project_meta_file_scale",
			fileScale: projectMeta?.fileScale.value ?? null,
			reason: ontologyMcpEnabled
				? "Project file scale is large or huge."
				: "Project file scale is below large; ontology MCP is disabled.",
		},
		request: {
			repositoryPath: repoInfo.localPath,
			taskTitle: task.title,
			taskDescriptionDigest: digestText(
				lastUserMessage?.content || task.description || task.objective || "",
			),
		},
		result: {
			digest: digestText(compiledPromptText),
			charCount: compiledPromptText.length,
		},
	};

	const rawLatestUserMessage = buildLatestRuntimeUserMessage({
		fallback:
			lastUserMessage?.content ||
			task.description ||
			task.objective ||
			compiledPromptText,
		lastUserMessage,
		implementationHandoffMessage,
		executionMode,
	});
	const conversationContext =
		executionMode === "review" || runtimeLaneResolution.lane === "codex-sdk"
			? null
			: await maybeLoadConversationStateCard(taskId, lastUserMessage?.id);
	const projectedStateCard = projectConversationStateCardForRuntime({
		snapshot: conversationContext,
		role: stateCardRoleForExecutionMode(executionMode),
		workKind: executionMode === "general_answer" ? null : runtimeRole,
	});
	const runtimePromptParts = buildPromptWithStateCardParts({
		latestUserMessage: rawLatestUserMessage,
		stateCardText: projectedStateCard.stateCardText,
	});
	const runtimeLatestUserMessage = runtimePromptParts.promptText;
	let runtimeContextSnapshot: RuntimePromptSnapshot = {
		...contextSnapshot,
		executionPhase: executionMode,
		planModeClosed: executionMode !== "planning",
		...(executionMode === "implementation"
			? { implementationPhasePreamble: IMPLEMENTATION_PHASE_PREAMBLE }
			: {}),
		conversationContext: conversationContext
			? {
					snapshotId: conversationContext.id,
					version: conversationContext.version,
					tokenEstimate: conversationContext.tokenEstimate,
					stateCardIncluded: Boolean(projectedStateCard.stateCardText),
					...(projectedStateCard.stateCardText
						? { stateCardText: projectedStateCard.stateCardText }
						: {}),
					snapshotJson: conversationContext.snapshotJson,
					projection: projectedStateCard.projection,
					usage: {
						latestUserMessageTokens:
							runtimePromptParts.estimates.latestUserMessageTokens,
						stateCardTokens: runtimePromptParts.estimates.stateCardTokens,
						runtimeUserPromptTokens: runtimePromptParts.estimates.promptTokens,
					},
				}
			: {
					stateCardIncluded: false,
					projection: projectedStateCard.projection,
					usage: {
						latestUserMessageTokens:
							runtimePromptParts.estimates.latestUserMessageTokens,
						stateCardTokens: 0,
						runtimeUserPromptTokens: runtimePromptParts.estimates.promptTokens,
					},
				},
	};
	const ontologyContext = ontologyMcpEnabled
		? await buildOntologyRuntimeContextSnapshot({
				repoRoot: repoInfo.localPath,
				goal: runtimeLatestUserMessage || compiledPromptText,
				taskId,
				runId: run.id,
				runtimeLane: runtimeLaneResolution.lane,
			})
		: buildOntologyRuntimeContextDisabledSnapshot({
				taskId,
				runId: run.id,
				runtimeLane: runtimeLaneResolution.lane,
				fileScale: projectMeta?.fileScale.value ?? null,
			});
	runtimeContextSnapshot = {
		...runtimeContextSnapshot,
		ontologyContext,
	};
	await repo.createRunEvent({
		version: 1,
		runId: run.id,
		taskId,
		timestamp: new Date().toISOString(),
		type: "system.info",
		severity: ontologySnapshotEventSeverity(ontologyContext),
		actor: "runtime",
		message: ontologyContext.available
			? "Ontology runtime context snapshot prepared."
			: "Ontology runtime context snapshot unavailable; runtime will use MCP fallback guidance.",
		data: {
			action: "ontology.runtime_context_snapshot",
			ontologyContext,
		},
	});
	if (runtimeLaneResolution.lane === "native-api-runner") {
		try {
			const roleContextTodos = await repo.listTaskRunTodosForRun(run.id);
			const roleContextBase = buildNativeApiRoleContextSnapshot({
				context: {
					runId: run.id,
					taskId,
					repositoryId: task.repositoryId,
					repoRoot: repoInfo.localPath,
					compiledPrompt: compiledPromptText,
					latestUserMessage: runtimeLatestUserMessage,
					timeoutSeconds: task.timeoutSeconds ?? 3600,
					safetyPolicy: repoInfo.safetyPolicy || undefined,
					contextSnapshot: runtimeContextSnapshot,
					runtimeOptions,
					todoPlan: roleContextTodos.map(toAgentRuntimeTodoContext),
					currentTodo: roleContextTodos
						.filter((todo) => todo.status === "running")
						.sort((a, b) => a.seq - b.seq)
						.map(toAgentRuntimeTodoContext)[0],
				},
			});
			const handoffEvent = await repo.createRunEvent({
				version: 1,
				runId: run.id,
				taskId,
				timestamp: roleContextBase.handoff.createdAt,
				type: "context.handoff_created",
				severity: "info",
				actor: "runtime",
				message: "Role handoff artifact created for run-start boundary.",
				data: {
					artifact: roleContextBase.handoff,
					source: "deterministic",
				},
			});
			const workingContextEvent = await repo.createRunEvent({
				version: 1,
				runId: run.id,
				taskId,
				timestamp: roleContextBase.workingContext.createdAt,
				type: "context.working_context_created",
				severity: "info",
				actor: "runtime",
				message: "Role working context created for provider history.",
				data: {
					artifact: roleContextBase.workingContext,
					source: "deterministic",
				},
			});
			runtimeContextSnapshot = {
				...runtimeContextSnapshot,
				roleContext: {
					...roleContextBase.snapshot,
					handoff: {
						...roleContextBase.snapshot.handoff,
						eventSeq: handoffEvent?.seq ?? null,
						eventId: handoffEvent?.id ?? null,
					},
					workingContext: {
						...roleContextBase.snapshot.workingContext,
						eventSeq: workingContextEvent?.seq ?? null,
						eventId: workingContextEvent?.id ?? null,
					},
				},
			};
		} catch (error) {
			const errorMessage = toErrorMessage(error);
			const failureType = /handoff/i.test(errorMessage)
				? "context.handoff_failed"
				: "context.working_context_failed";
			await repo.createRunEvent({
				version: 1,
				runId: run.id,
				taskId,
				timestamp: new Date().toISOString(),
				type: failureType,
				severity: "error",
				actor: "runtime",
				message: `Role context generation failed before provider call: ${errorMessage}`,
				data: {
					source: "deterministic",
					error: errorMessage,
				},
			});
			await repo.updateTaskCompiledPrompt(taskId, compiledPromptText);
			const failedRun = await repo.updateTaskRun(run.id, {
				status: "needs_human",
				endedAt: new Date(),
				finishedAt: new Date(),
				contextSnapshot: runtimeContextSnapshot,
				finalReport: `Role context generation failed before provider call: ${errorMessage}`,
				finalJudgment: null,
				summary: "Role context generation failed before provider call.",
			});
			await repo.updateTaskStatus(taskId, "needs_human");
			return failedRun ?? run;
		}
	}

	if (runtimeLaneResolution.lane === "codex-sdk") {
		const runtimeResume =
			executionMode === "review" || executionMode === "test"
				? {
						kind: "codex_thread",
						status: "disabled",
						executionMode,
						reason:
							executionMode === "test"
								? "test_mode_fresh_context"
								: "review_fresh_context",
					}
				: await loadCodexRuntimeResumeState({
						taskId,
						repositoryId: task.repositoryId,
						executionMode,
					});
		runtimeContextSnapshot = {
			...runtimeContextSnapshot,
			runtimeResume,
		};
		runtimeOptions.runtimeResume = runtimeResume;
		await repo.createRunEvent({
			version: 1,
			runId: run.id,
			taskId,
			timestamp: new Date().toISOString(),
			type: "system.info",
			severity: runtimeResume.status === "available" ? "info" : "warning",
			actor: "system",
			message:
				runtimeResume.status === "available"
					? "Codex runtime resume state loaded."
					: runtimeResume.status === "disabled"
						? `Codex runtime resume state disabled for ${executionMode}; runtime will start fresh.`
						: "Codex runtime resume state unavailable; runtime will start fresh.",
			data: {
				action: "runtime.resume_state_loaded",
				runtimeResume,
			},
		});
	}

	await repo.updateTaskCompiledPrompt(taskId, compiledPromptText);
	const compiledRun = await repo.updateTaskRun(run.id, {
		status: "running",
		contextSnapshot: runtimeContextSnapshot,
	});
	await repo.createRunEvent({
		version: 1,
		runId: run.id,
		taskId,
		timestamp: new Date().toISOString(),
		type: "run.prompt_prepared",
		severity: "info",
		actor: "system",
		message: "Runtime prompt prepared.",
		data: {
			source: contextSnapshot.source,
			degraded: false,
			digest: contextSnapshot.result.digest,
			charCount: contextSnapshot.result.charCount,
			runtimeLane: runtimeLaneResolution.lane,
			workerKind: runtimeLaneResolution.workerKind,
			runtimeLaneResolution,
			effectiveLlmRouting,
			executionMode,
			executionModeSource,
			runtimeRole,
		},
	});

	launchRuntimeExecution({
		taskId,
		task,
		run,
		repoInfo,
		compiledPromptText,
		runtimeLatestUserMessage,
		runtimeContextSnapshot,
		runtimeOptions,
		runtimeLaneDefinition,
		runtimeLaneResolution,
	});

	return compiledRun ?? run;
}

function isOntologyMcpEnabledForProjectMeta(projectMeta: unknown) {
	if (
		!projectMeta ||
		typeof projectMeta !== "object" ||
		Array.isArray(projectMeta)
	) {
		return false;
	}
	const fileScale = (projectMeta as { fileScale?: { value?: unknown } })
		.fileScale?.value;
	return fileScale === "large" || fileScale === "huge";
}
