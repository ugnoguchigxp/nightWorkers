import { stateCardRoleForExecutionMode } from "../../../services/agent-runtime/native-api-runner/native-api-mode";
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
import { activateTaskRunResume } from "./resume-task-run-activation";
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
import { toErrorMessage } from "./utils";

export { startTaskRun } from "./start-task-run-entry";

import {
	prepareResumableTaskRun,
	prepareStartableTask,
} from "./start-task-run-entry";

export type { StartTaskRunOptions } from "./start-task-run-types";
export async function startTaskRunInProcess(
	taskId: string,
	options: StartTaskRunOptions = {},
) {
	if (Boolean(options.resumeRunId) !== Boolean(options.resumeCommand)) {
		throw new Error("resumeRunId and resumeCommand must be provided together.");
	}
	const prepared = await prepareTaskRunInProcess(taskId, options);
	let resultRun = prepared.run;
	try {
		await prepared.associate?.();
		if (options.resumeRunId && options.resumeCommand) {
			resultRun = await activateTaskRunResume({
				runId: options.resumeRunId,
				...options.resumeCommand,
			});
		}
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
	return resultRun;
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
		summary: "Runtime preparation failed before launch.",
		finalReport: `Runtime preparation failed before launch: ${message}`,
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
		message: "Task run preparation failed before runtime launch.",
		data: {
			action: "mission_pilot.run_preparation_failed",
			executionMode: input.executionMode,
			error: message,
		},
	});
	await repo.updateTaskStatus(input.taskId, "failed");
}

export async function prepareTaskRunInProcess(
	taskId: string,
	options: StartTaskRunOptions = {},
) {
	const resumable = options.resumeRunId
		? await prepareResumableTaskRun(taskId, options.resumeRunId)
		: null;
	const task = resumable?.task ?? (await prepareStartableTask(taskId));
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
		compiledPromptText,
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
	const created = resumable
		? null
		: await createTaskRunInAgentModeSession({
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
	const run = resumable?.run ?? created?.run;
	if (!run) throw new Error("Failed to resolve task run.");
	if (created) {
		await recordAgentModeSessionTransition({
			runId: run.id,
			taskId,
			executionMode,
			llmRole: runtimeRole,
			routeFingerprint: routeIdentity.fingerprint,
			sessionTransition: created.sessionTransition,
		});
	}
	await activateWorkspace(taskId, executionMode, gitBaseline.baselineHead);
	if (!resumable) {
		await repo.createTaskRunCommitRecord({
			runId: run.id,
			repositoryId: task.repositoryId,
			status: gitBaseline.status,
			baselineHead: gitBaseline.baselineHead,
			baselineStatusJson: gitBaseline.baselineStatusJson,
			preExistingDirtyPaths: gitBaseline.preExistingDirtyPaths,
			statusReason: gitBaseline.statusReason,
		});
	}
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
	await repo.createRunEvent({
		version: 1,
		runId: run.id,
		taskId,
		timestamp: new Date().toISOString(),
		type: resumable ? "system.info" : "run.created",
		severity: "info",
		actor: "system",
		message: resumable
			? "Task run resume was prepared with the existing Todo and provider session."
			: "Task run created. Runtime prompt is being prepared.",
		data: {
			action: resumable ? "run.resume_prepared" : "run.created",
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
		projectExplorationCatalog: projectExplorationCatalogPin,
		planModeClosed: true,
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
		runtimeLaneResolution.lane === "codex-sdk"
			? null
			: await maybeLoadConversationStateCard(taskId, lastUserMessage?.id);
	const projectedStateCard = projectConversationStateCardForRuntime({
		snapshot: conversationContext,
		role: stateCardRoleForExecutionMode(executionMode),
		workKind: runtimeRole,
	});
	const runtimePromptParts = buildPromptWithStateCardParts({
		latestUserMessage: rawLatestUserMessage,
		stateCardText: projectedStateCard.stateCardText,
	});
	const runtimeLatestUserMessage = runtimePromptParts.promptText;
	let runtimeContextSnapshot: RuntimePromptSnapshot = {
		...contextSnapshot,
		executionPhase: executionMode,
		planModeClosed: true,
		implementationPhasePreamble: IMPLEMENTATION_PHASE_PREAMBLE,
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
		status: resumable ? run.status : "running",
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
		associate: resumable
			? undefined
			: createPreparedMissionPilotAssociation({
					executionMode,
					missionPilotPhase: options.missionPilotPhase,
					runtimeOptions,
					taskId,
					runId: run.id,
				}),
		launch: createPreparedRuntimeLaunch({
			taskId,
			task,
			run: compiledRun ?? run,
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
