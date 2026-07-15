import { stateCardRoleForExecutionMode } from "../../../services/agent-runtime/native-api-runner/native-api-mode";
import { buildNativeApiRoleContextSnapshot } from "../../../services/agent-runtime/native-api-runner/native-api-role-context-events";
import { buildPromptWithStateCardParts } from "../../../services/conversation-context";
import { projectConversationStateCardForRuntime } from "../../../services/conversation-context/state-card-projection";
import { digestText } from "../../../services/text-digest";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import {
	buildOntologyRuntimeContextDisabledSnapshot,
	buildOntologyRuntimeContextSnapshot,
	ontologySnapshotEventSeverity,
} from "../../ontology";
import * as repo from "../nightworkers.repository";
import { activateWorkspace, readGitBaseline } from "./git-ownership";
import {
	buildLatestRuntimeUserMessage,
	IMPLEMENTATION_PHASE_PREAMBLE,
	loadCodexRuntimeResumeState,
	maybeLoadConversationStateCard,
} from "./runtime-routing";
import {
	buildContinuationRouteIdentity,
	createPreparedMissionPilotAssociation,
	createPreparedRuntimeLaunch,
} from "./start-task-run-launch";
import { prepareTaskRunStart } from "./start-task-run-preparation";
import {
	prepareTaskRunRuntimeContext,
	resolveRunProjectExplorationCatalogPin,
} from "./start-task-run-runtime-context";
import {
	createTaskRunInAgentModeSession,
	recordAgentModeSessionTransition,
} from "./start-task-run-session";
import type { StartTaskRunOptions } from "./start-task-run-types";
import {
	closeOpenTodosForFailedRun,
	toAgentRuntimeTodoContext,
} from "./todo-closeout";
import { resolveInitialTaskRunTodos } from "./todo-resume";
import { toErrorMessage } from "./utils";

export { startTaskRun } from "./start-task-run-entry";

import { prepareStartableTask } from "./start-task-run-entry";

export type { StartTaskRunOptions } from "./start-task-run-types";
export async function startTaskRunInProcess(
	taskId: string,
	options: StartTaskRunOptions = {},
) {
	const prepared = await prepareTaskRunInProcess(taskId, options);
	try {
		await prepared.associate?.();
	} catch (error) {
		await failPreparedRunBeforeLaunch({
			runId: prepared.run.id,
			taskId,
			executionMode: options.executionMode ?? "implementation",
			error,
		});
		throw error;
	}
	await prepared.launch?.();
	return prepared.run;
}

async function failPreparedRunBeforeLaunch(input: {
	runId: string;
	taskId: string;
	executionMode: string;
	error: unknown;
}) {
	const message = toErrorMessage(input.error);
	const failedRun = await repo.updateTaskRunIfStatus(input.runId, "running", {
		status: "failed",
		endedAt: new Date(),
		finishedAt: new Date(),
		summary:
			"Mission Pilot child run preparation failed before runtime launch.",
		finalReport: `Mission Pilot child run preparation failed before runtime launch: ${message}`,
		finalJudgment: null,
	});
	if (!failedRun) return;
	await repo.createRunEvent({
		version: 1,
		runId: input.runId,
		taskId: input.taskId,
		timestamp: new Date().toISOString(),
		type: "system.error",
		severity: "error",
		actor: "system",
		message: "Mission Pilot child run could not be associated before launch.",
		data: {
			action: "mission_pilot.run_preparation_failed",
			executionMode: input.executionMode,
			error: message,
		},
	});
	const todos = await repo.listTaskRunTodosForRun(input.runId);
	await closeOpenTodosForFailedRun({
		runId: input.runId,
		taskId: input.taskId,
		todos,
		evidence: `mission_pilot_run_association_failed: ${message}`,
	});
	await repo.updateTaskStatus(
		input.taskId,
		["test", "review"].includes(input.executionMode)
			? "needs_review"
			: "failed",
	);
}

export async function prepareTaskRunInProcess(
	taskId: string,
	options: StartTaskRunOptions = {},
) {
	const task = await prepareStartableTask(taskId);
	const {
		repoInfo,
		executionRoot,
		projectMeta,
		securityIntelligence,
		projectExplorationCatalogSettings,
		lastUserMessage,
		runtimeImageAttachments,
		llmRouteOverride,
		jobType,
		executionMode,
		executionModeSource,
		implementationHandoffMessage,
		implementationPlanTodoProjection,
		compiledPromptText,
		verificationPolicy,
	} = await prepareTaskRunStart({ task, options });
	const ontologyMcpEnabled = securityIntelligence.ontology.effectiveEnabled;
	const {
		runtimeRole,
		blueprintPlanningSnapshot,
		runtimeRoleLabel,
		planModeSettingsSnapshot,
		llmUsageSettingsSnapshot,
		runtimeLlmRoute,
		runtimeLaneResolution,
		runtimeLaneDefinition,
		effectiveLlmRouting,
	} = await prepareTaskRunRuntimeContext({
		taskId,
		executionMode,
		llmRouteOverride,
	});
	const gitBaseline = await readGitBaseline(executionRoot);
	const projectExplorationCatalogPin =
		await resolveRunProjectExplorationCatalogPin({
			executionMode,
			registeredRepoRoot: repoInfo.localPath,
			executionRoot,
			expectedHead: gitBaseline.baselineHead,
			preExistingDirtyPaths: gitBaseline.preExistingDirtyPaths,
			settings: projectExplorationCatalogSettings,
			runtimeLane: runtimeLaneResolution.lane,
		});
	const routeIdentity = buildContinuationRouteIdentity({
		executionMode,
		llmRole: runtimeRole,
		runtimeLane: runtimeLaneResolution.lane,
		runtimeLlmRoute,
	});
	const { run, sessionTransition } = await createTaskRunInAgentModeSession({
		taskId,
		repositoryId: task.repositoryId,
		executionMode,
		llmRole: runtimeRole,
		routeIdentity,
		taskRun: {
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
				...(implementationPlanTodoProjection
					? {
							implementationPlanProvenance:
								implementationPlanTodoProjection.implementationPlanProvenance,
						}
					: {}),
				projectExplorationCatalog: projectExplorationCatalogPin,
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
		},
	});
	await recordAgentModeSessionTransition({
		runId: run.id,
		taskId,
		executionMode,
		llmRole: runtimeRole,
		routeFingerprint: routeIdentity.fingerprint,
		sessionTransition,
	});
	await activateWorkspace(taskId, executionMode, gitBaseline.baselineHead);
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
	await repo.replaceTaskRunTodosForRun(
		run.id,
		await resolveInitialTaskRunTodos({
			executionMode,
			resumeTodosFromRunId: options.resumeTodosFromRunId,
			loadTodosForRun: repo.listTaskRunTodosForRun,
			initialTodos:
				executionMode === "test"
					? []
					: (options.initialTodos ??
						implementationPlanTodoProjection?.initialTodos ??
						runtimeLaneDefinition.buildInitialTodos(runtimeLaneSetupInput)),
			requireDataMigrationGates:
				jobType === "data_migration" ||
				Boolean(implementationPlanTodoProjection?.requireDataMigrationGates),
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
		...(implementationPlanTodoProjection
			? {
					implementationPlanProvenance:
						implementationPlanTodoProjection.implementationPlanProvenance,
				}
			: {}),
		projectExplorationCatalog: projectExplorationCatalogPin,
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
		reviewCorrection: runtimeOptions.reviewCorrection,
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
			registeredRepositoryPath: repoInfo.localPath,
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
	const rawLatestUserMessage =
		options.latestUserMessageOverride?.trim() ||
		buildLatestRuntimeUserMessage({
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
	if (sessionTransition.transition === "opened") {
		try {
			const roleContextTodos = await repo.listTaskRunTodosForRun(run.id);
			const roleContextBase = buildNativeApiRoleContextSnapshot({
				context: {
					runId: run.id,
					taskId,
					agentModeSessionId: run.agentModeSessionId,
					repositoryId: task.repositoryId,
					repoRoot: executionRoot,
					compiledPrompt: compiledPromptText,
					latestUserMessage: runtimeLatestUserMessage,
					imageAttachments: runtimeImageAttachments,
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
			return { run: failedRun ?? run, associate: null, launch: null };
		}
	}
	if (runtimeLaneResolution.lane === "codex-sdk") {
		const runtimeResume = await loadCodexRuntimeResumeState({
			taskId,
			repositoryId: task.repositoryId,
			executionMode,
			agentModeSessionId: run.agentModeSessionId,
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
					? "Codex runtime resume state loaded for the active agent mode session."
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
	return {
		run: compiledRun ?? run,
		associate: createPreparedMissionPilotAssociation({
			executionMode,
			missionPilotPhase: options.missionPilotPhase,
			runtimeOptions,
			taskId,
			runId: run.id,
		}),
		launch: createPreparedRuntimeLaunch({
			taskId,
			task,
			run,
			repoInfo: { ...repoInfo, localPath: executionRoot },
			compiledPromptText,
			runtimeLatestUserMessage,
			runtimeImageAttachments,
			runtimeContextSnapshot,
			runtimeOptions,
			runtimeLaneDefinition,
			runtimeLaneResolution,
			agentModeSessionId: run.agentModeSessionId,
		}),
	};
}
