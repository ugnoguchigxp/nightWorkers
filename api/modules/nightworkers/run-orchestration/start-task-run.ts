import { AppError, NotFoundError } from "../../../lib/errors";
import { getCurrentSettings } from "../../../routes/settings";
import {
	nativeApiRoleForExecutionMode,
	stateCardRoleForExecutionMode,
} from "../../../services/agent-runtime/native-api-runner/native-api-mode";
import { buildNativeApiRoleContextSnapshot } from "../../../services/agent-runtime/native-api-runner/native-api-role-context-events";
import { resolveRuntimeLaneDefinition } from "../../../services/agent-runtime/registry";
import {
	readRuntimeLaneConfigFromEnv,
	resolveRuntimeLane,
} from "../../../services/agent-runtime/runtime-lane";
import { buildPromptWithStateCardParts } from "../../../services/conversation-context";
import { projectConversationStateCardForRuntime } from "../../../services/conversation-context/state-card-projection";
import { shouldUseIsolatedTaskExecutor } from "../../../services/execution/executor-mode";
import { startTaskRunInWorker } from "../../../services/execution/worker-process-manager";
import {
	buildPlanModeSettingsSnapshot,
	readGeneralSettings,
} from "../../../services/settings/general-settings";
import { resolveStructuredLlmRoleRoute } from "../../../services/structured-llm/role-routing";
import { readStructuredLlmProviderSettings } from "../../../services/structured-llm/settings";
import { digestText } from "../../../services/text-digest";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import { buildStandardImplementationTodoList } from "../../../services/todo-runtime";
import { associateMissionPilotChildRun } from "../../missionPilot/mission-pilot-run-association.service";
import {
	buildOntologyRuntimeContextDisabledSnapshot,
	buildOntologyRuntimeContextSnapshot,
	ontologySnapshotEventSeverity,
} from "../../ontology";
import { resolveBlueprintPlanningReadiness } from "../nightworkers.basic.service";
import * as repo from "../nightworkers.repository";
import { readGitBaseline } from "./git-ownership";
import { launchRuntimeExecution } from "./runtime-execution";
import {
	buildEffectiveLlmRoutingSnapshot,
	buildLatestRuntimeUserMessage,
	IMPLEMENTATION_PHASE_PREAMBLE,
	loadCodexRuntimeResumeState,
	maybeLoadConversationStateCard,
	resolveRuntimeLaneForRoleRoute,
} from "./runtime-routing";
import { prepareTaskRunStart } from "./start-task-run-preparation";
import type { StartTaskRunOptions } from "./start-task-run-types";
import { toAgentRuntimeTodoContext } from "./todo-closeout";
import { toErrorMessage } from "./utils";

export type { StartTaskRunOptions } from "./start-task-run-types";

export async function startTaskRun(
	taskId: string,
	options: StartTaskRunOptions = {},
) {
	if (shouldUseIsolatedTaskExecutor()) {
		return startTaskRunInWorker<
			Awaited<ReturnType<typeof startTaskRunInProcess>>
		>(taskId, options);
	}
	return startTaskRunInProcess(taskId, options);
}

export async function startTaskRunInProcess(
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

	// 2. Fetch repo information and compile the deterministic run inputs.
	const {
		repoInfo,
		executionRoot,
		projectMeta,
		securityIntelligence,
		lastUserMessage,
		llmRouteOverride,
		jobType,
		executionMode,
		executionModeSource,
		implementationHandoffMessage,
		compiledPromptText,
		verificationPolicy,
	} = await prepareTaskRunStart({ task, options });
	const ontologyMcpEnabled = securityIntelligence.ontology.effectiveEnabled;
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
	const gitBaseline = await readGitBaseline(executionRoot);
	const run = await repo.createTaskRun({
		taskId,
		repositoryId: task.repositoryId,
		status: "running",
		workerKind: runtimeLaneResolution.workerKind,
		baseRef: gitBaseline.baselineHead,
		worktreePath: task.worktreePath ? executionRoot : null,
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
	const runtimeOptions: Record<string, unknown> & {
		securityOracle: {
			enabled: boolean;
			configured: boolean;
			reason: string;
			maxIterations: number;
			ontologyToolProfile: "standard" | "ontology_extended";
		};
		testMode?: unknown;
		reviewRun?: unknown;
		runtimeResume?: unknown;
	} = {
		...runtimeLaneDefinition.buildRuntimeOptions(runtimeLaneSetupInput),
		...(options.runtimeOptionsPatch ?? {}),
		securityOracle: {
			enabled: securityIntelligence.securityOracle.effectiveEnabled,
			configured: securityIntelligence.securityOracle.configured,
			reason: securityIntelligence.securityOracle.reason,
			maxIterations: securityIntelligence.settings.securityMaxIterations,
			ontologyToolProfile: securityIntelligence.ontology.toolProfile,
		},
	};
	const initialTodos =
		executionMode === "test"
			? []
			: (options.initialTodos ??
				runtimeLaneDefinition.buildInitialTodos(runtimeLaneSetupInput));
	await repo.replaceTaskRunTodosForRun(
		run.id,
		executionMode === "planning" ||
			executionMode === "general_answer" ||
			executionMode === "test"
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
		...(runtimeOptions.testMode ? { testMode: runtimeOptions.testMode } : {}),
		...(runtimeOptions.reviewRun
			? { reviewRun: runtimeOptions.reviewRun }
			: {}),
		...(runtimeOptions.missionPilot
			? { missionPilot: runtimeOptions.missionPilot }
			: {}),
		projectMeta,
		securityOracle: {
			enabled: securityIntelligence.securityOracle.effectiveEnabled,
			configured: securityIntelligence.securityOracle.configured,
			reason: securityIntelligence.securityOracle.reason,
			measuredSourceLoc: securityIntelligence.eligibility.measuredSourceLoc,
			thresholdSourceLoc: securityIntelligence.eligibility.thresholdSourceLoc,
		},
		ontologyMcp: {
			enabled: ontologyMcpEnabled,
			source: "project_code_size_tool_profile",
			fileScale: projectMeta?.fileScale.value ?? null,
			toolProfile: securityIntelligence.ontology.toolProfile,
			measuredSourceLoc: securityIntelligence.eligibility.measuredSourceLoc,
			thresholdSourceLoc: securityIntelligence.eligibility.thresholdSourceLoc,
			reason: securityIntelligence.ontology.reason,
		},
		request: {
			repositoryPath: executionRoot,
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
				repoRoot: executionRoot,
				goal: runtimeLatestUserMessage || compiledPromptText,
				taskId,
				runId: run.id,
				runtimeLane: runtimeLaneResolution.lane,
			})
		: buildOntologyRuntimeContextDisabledSnapshot({
				taskId,
				runId: run.id,
				runtimeLane: runtimeLaneResolution.lane,
				toolProfile: securityIntelligence.ontology.toolProfile,
				reason: securityIntelligence.ontology.reason,
				measuredSourceLoc: securityIntelligence.eligibility.measuredSourceLoc,
				thresholdSourceLoc: securityIntelligence.eligibility.thresholdSourceLoc,
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
					repoRoot: executionRoot,
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
	const missionPilot = readMissionPilotEnvelope(runtimeOptions.missionPilot);
	if (
		missionPilot &&
		(executionMode === "implementation" ||
			executionMode === "test" ||
			executionMode === "review")
	) {
		await associateMissionPilotChildRun({
			taskId,
			runId: run.id,
			phase: executionMode,
			missionPilot,
		});
	}

	launchRuntimeExecution({
		taskId,
		task,
		run,
		repoInfo: { ...repoInfo, localPath: executionRoot },
		compiledPromptText,
		runtimeLatestUserMessage,
		runtimeContextSnapshot,
		runtimeOptions,
		runtimeLaneDefinition,
		runtimeLaneResolution,
	});

	return compiledRun ?? run;
}

function readMissionPilotEnvelope(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (
		typeof candidate.sessionId !== "string" ||
		typeof candidate.cycle !== "number" ||
		typeof candidate.contextRevision !== "number" ||
		typeof candidate.contextDigest !== "string"
	)
		return null;
	return {
		sessionId: candidate.sessionId,
		cycle: candidate.cycle,
		contextRevision: candidate.contextRevision,
		contextDigest: candidate.contextDigest,
	};
}
