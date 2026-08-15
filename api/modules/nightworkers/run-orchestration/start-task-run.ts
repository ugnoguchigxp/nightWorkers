import { buildPromptWithStateCardParts } from "../../../services/conversation-context";
import { projectConversationStateCardForRuntime } from "../../../services/conversation-context/state-card-projection";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";
import {
	buildCodexRuntimePromptSnapshot,
	loadCodingAgentContextPacket,
	renderCodingAgentTodoRecoveryGuidance,
	resolveCodexIntakeRuntimeHandoff,
} from "../../codingAgent";
import {
	buildOntologyRuntimeContextDisabledSnapshot,
	buildOntologyRuntimeContextSnapshot,
	ontologySnapshotEventSeverity,
} from "../../ontology";
import { buildInteractiveReviewPromptSnapshot } from "../../review/review-runtime-profile";
import { buildSecurityRuntimeContextSnapshot } from "../../securityIntelligence/security-runtime-context.service";
import * as repo from "../nightworkers.repository";
import { activateWorkspace, readGitBaseline } from "./git-ownership";
import {
	assertResumableLlmRoutingUnchanged,
	carryResumableRuntimeContext,
	composeResumableRuntimeStateCards,
} from "./resumable-runtime-context";
import { resolveRunSystemContextBinding } from "./run-system-context";
import {
	buildLatestRuntimeUserMessage,
	IMPLEMENTATION_PHASE_PREAMBLE,
	loadCodexRuntimeResumeState,
	maybeLoadConversationStateCard,
} from "./runtime-routing";
import {
	prepareResumableTaskRun,
	prepareStartableTask,
	startTaskRun,
} from "./start-task-run-entry";
import {
	assertResumedRunBindings,
	materializeAdoptedImplementationPlan,
	resolveTaskRunRevisionBinding,
} from "./start-task-run-evidence";
import {
	activatePreparedTaskRun,
	buildContinuationRouteIdentity,
	createPreparedRunAssociation,
	createPreparedRuntimeLaunch,
	launchPreparedTaskRun,
} from "./start-task-run-launch";
import {
	persistPreparedRuntimePrompt,
	recordRuntimePromptPrepared,
} from "./start-task-run-persistence";
import { prepareTaskRunStart } from "./start-task-run-preparation";
import { buildStandardTaskRunPromptSnapshot } from "./start-task-run-prompt-snapshot";
import {
	buildRuntimeConversationContextSnapshot,
	prepareTaskRunRuntimeContext,
	resolveRunProjectExplorationCatalogPin,
} from "./start-task-run-runtime-context";
import { buildTaskRunRuntimeOptions } from "./start-task-run-runtime-options";
import {
	createTaskRunInAgentModeSession,
	recordCreatedAgentModeSessionTransition,
} from "./start-task-run-session";
import {
	isInteractiveReviewStart,
	type StartTaskRunOptions,
} from "./start-task-run-types";

export { startTaskRun };
export async function startTaskRunInProcess(
	taskId: string,
	options: StartTaskRunOptions = {},
) {
	if (Boolean(options.resumeRunId) !== Boolean(options.resumeCommand)) {
		throw new Error("resumeRunId and resumeCommand must be provided together.");
	}
	const prepared = await prepareTaskRunInProcess(taskId, options);
	const resultRun = await activatePreparedTaskRun({
		run: prepared.run,
		associate: prepared.associate,
		resumeRunId: options.resumeRunId,
		resumeCommand: options.resumeCommand,
		taskId,
		executionMode: options.executionMode ?? "implementation",
	});
	await launchPreparedTaskRun({
		launch: prepared.launch,
		runId: prepared.run.id,
		taskId,
		executionMode: options.executionMode ?? "implementation",
		resumeCommand: options.resumeCommand,
	});
	return resultRun;
}
export async function prepareTaskRunInProcess(
	taskId: string,
	options: StartTaskRunOptions = {},
) {
	const interactiveReview = isInteractiveReviewStart(options);
	const resumable = options.resumeRunId
		? await prepareResumableTaskRun(taskId, options.resumeRunId)
		: null;
	const task = resumable?.task ?? (await prepareStartableTask(taskId));
	const systemContextBinding = interactiveReview
		? undefined
		: resolveRunSystemContextBinding(resumable?.run.contextSnapshot);
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
		implementationHandoffSnapshot,
		implementationPlan,
		implementationPlanProvenance,
		repositoryMaterializationSnapshot,
		workspaceAdmission,
		workspaceRuntimeEnvironment,
		compiledPromptText,
	} = await prepareTaskRunStart({ task, options });
	const ontologyMcpEnabled =
		!interactiveReview && securityIntelligence.ontology.effectiveEnabled;
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
		planModeRequested: Boolean(options.planModeRequested),
	});
	if (resumable) {
		assertResumableLlmRoutingUnchanged({
			previousContext: resumable.run.contextSnapshot,
			currentEffectiveLlmRouting: effectiveLlmRouting,
			currentRuntimeLane: runtimeLaneResolution.lane,
		});
	}
	const intakeRuntimeResume = resolveCodexIntakeRuntimeHandoff({
		handoff: interactiveReview ? undefined : options.intakeRuntimeThreadHandoff,
		executionMode,
		runtimeRoute: runtimeLlmRoute,
	});
	const gitBaseline = await readGitBaseline(executionRoot);
	const projectExplorationCatalogPin =
		await resolveRunProjectExplorationCatalogPin({
			registeredRepoRoot: repoInfo.localPath,
			executionRoot,
			expectedHead: gitBaseline.baselineHead,
			preExistingDirtyPaths: gitBaseline.preExistingDirtyPaths,
			settings: projectExplorationCatalogSettings,
			runtimeLane: runtimeLaneResolution.lane,
		});
	const continuationRouteIdentity = buildContinuationRouteIdentity({
		executionMode,
		llmRole: runtimeRole,
		runtimeLane: runtimeLaneResolution.lane,
		runtimeLlmRoute,
	});
	const routeIdentity = continuationRouteIdentity;
	const taskRevisionSnapshot = await resolveTaskRunRevisionBinding({
		task,
		resuming: Boolean(resumable),
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
					taskRevisionSnapshotId: task.currentRevisionSnapshotId,
					taskRevision: task.revision,
					taskDigest: taskRevisionSnapshot?.digest ?? null,
					status: "running",
					workerKind: runtimeLaneResolution.workerKind,
					baseRef: gitBaseline.baselineHead,
					worktreePath: task.worktreePath ? executionRoot : null,
					workspaceAuthorityKind: "task_workspace",
					workspaceId: workspaceAdmission?.workspace.id ?? null,
					workspaceAllocationVersion:
						workspaceAdmission?.workspace.allocationVersion ?? null,
					repositoryIdentityRevision:
						workspaceAdmission?.workspace.repositoryIdentityRevision ?? null,
					admissionAttestationId: workspaceAdmission?.attestation.id ?? null,
					admissionAttestationDigest:
						workspaceAdmission?.attestation.digest ?? null,
					admittedHeadSha: workspaceAdmission?.attestation.headSha ?? null,
					timeoutSeconds: task.timeoutSeconds,
					contextSnapshot: {
						compiledPrompt: compiledPromptText,
						executionMode,
						executionModeSource,
						planModeRequested: Boolean(options.planModeRequested),
						systemContextBinding,
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
	if (created) await repo.updateTaskStatus(taskId, "running");
	assertResumedRunBindings({
		resuming: Boolean(resumable),
		task,
		run,
		admission: workspaceAdmission,
	});
	await recordCreatedAgentModeSessionTransition({
		created,
		runId: run.id,
		taskId,
		executionMode,
		llmRole: runtimeRole,
		routeFingerprint: routeIdentity.fingerprint,
	});
	if (!interactiveReview) {
		await materializeAdoptedImplementationPlan({
			runId: run.id,
			plan: implementationPlan,
			created: Boolean(created),
		});
	}
	await activateWorkspace(taskId, gitBaseline.baselineHead);
	if (!resumable) {
		await repo.createTaskRunCommitRecord({
			runId: run.id,
			repositoryId: task.repositoryId,
			status: gitBaseline.status,
			baselineHead: gitBaseline.baselineHead,
			baselineStatusJson: gitBaseline.baselineStatusJson,
			preExistingDirtyPaths: interactiveReview
				? []
				: gitBaseline.preExistingDirtyPaths,
			statusReason: gitBaseline.statusReason,
		});
	}
	const runtimeOptions = buildTaskRunRuntimeOptions({
		runtimeLaneOptions: runtimeLaneDefinition.buildRuntimeOptions({
			compiledPromptText,
			jobType,
			runtimeLaneResolution,
			activeRole: runtimeRole,
			activeLlmRoute: runtimeLlmRoute,
			llmRouteOverride,
			planModeSettingsSnapshot,
			llmUsageSettingsSnapshot,
		}),
		runtimeOptionsPatch: options.runtimeOptionsPatch,
		interactiveReview: interactiveReview
			? {
					reviewedRunId: options.interactiveReview?.reviewedRunId ?? null,
					gitCommonDir: workspaceAdmission.attestation.gitCommonDirCanonical,
				}
			: null,
		workspaceRuntimeEnvironment,
		securityIntelligence,
	});
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
			systemContextBinding,
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
	const contextSnapshot: RuntimePromptSnapshot = interactiveReview
		? buildInteractiveReviewPromptSnapshot({
				compiledPrompt: compiledPromptText,
				repositoryPath: executionRoot,
				taskTitle: task.title,
				reviewedRunId: options.interactiveReview?.reviewedRunId ?? null,
				runtimeLane: runtimeLaneResolution.lane,
				runtimeLaneResolution: {
					workerKind: runtimeLaneResolution.workerKind,
					source: runtimeLaneResolution.source,
					diagnostics: runtimeLaneResolution.diagnostics,
				},
				effectiveLlmRouting,
			})
		: buildStandardTaskRunPromptSnapshot({
				compiledPrompt: compiledPromptText,
				executionMode,
				executionModeSource,
				projectExplorationCatalog: projectExplorationCatalogPin,
				planModeRequested: Boolean(options.planModeRequested),
				planModeSettingsSnapshot,
				systemContextBinding,
				blueprintPlanningSnapshot,
				runtimeLane: runtimeLaneResolution.lane,
				runtimeLaneResolution: {
					workerKind: runtimeLaneResolution.workerKind,
					source: runtimeLaneResolution.source,
					diagnostics: runtimeLaneResolution.diagnostics,
				},
				effectiveLlmRouting,
				reviewRun: runtimeOptions.reviewRun,
				reviewCorrection: runtimeOptions.reviewCorrection,
				projectMeta,
				securityIntelligence,
				ontologyMcpEnabled,
				registeredRepositoryPath: repoInfo.localPath,
				repositoryPath: executionRoot,
				taskTitle: task.title,
				taskDescription:
					lastUserMessage?.content || task.description || task.objective || "",
				implementationHandoffSnapshot:
					implementationHandoffSnapshot ?? undefined,
				implementationPlanProvenance: implementationPlanProvenance ?? undefined,
				repositoryMaterialization: repositoryMaterializationSnapshot,
				workspaceRuntimeEnvironmentKeys: Object.keys(
					workspaceRuntimeEnvironment,
				),
			});
	if (!interactiveReview) {
		contextSnapshot.securityContractContext =
			await buildSecurityRuntimeContextSnapshot({
				taskRevisionSnapshotId: run.taskRevisionSnapshotId,
				runId: run.id,
			});
	}
	const rawLatestUserMessage = interactiveReview
		? compiledPromptText
		: options.latestUserMessageOverride?.trim() ||
			buildLatestRuntimeUserMessage({
				planModeRequested: Boolean(options.planModeRequested),
				fallback:
					lastUserMessage?.content ||
					task.description ||
					task.objective ||
					compiledPromptText,
				lastUserMessage,
				implementationHandoffMessage,
			});
	const conversationContext = interactiveReview
		? null
		: await maybeLoadConversationStateCard(taskId, lastUserMessage?.id);
	const projectedStateCard = projectConversationStateCardForRuntime({
		snapshot: conversationContext,
		role: runtimeRole,
		workKind: runtimeRole,
	});
	const todoRecoveryStateCard =
		runtimeLaneResolution.lane === "codex-sdk" || interactiveReview
			? ""
			: renderCodingAgentTodoRecoveryGuidance({
					taskId,
					runId: run.id,
					repositoryRoot: executionRoot,
					packet: await loadCodingAgentContextPacket(run.id),
				});
	const runtimeStateCardText = composeResumableRuntimeStateCards({
		conversationStateCard: projectedStateCard.stateCardText,
		todoRecoveryStateCard,
		previousContext: resumable ? run.contextSnapshot : null,
	});
	const runtimePromptParts = buildPromptWithStateCardParts({
		latestUserMessage: rawLatestUserMessage,
		stateCardText: runtimeStateCardText,
	});
	const runtimeLatestUserMessage = interactiveReview
		? rawLatestUserMessage
		: runtimePromptParts.promptText;
	const conversationContextSnapshot = buildRuntimeConversationContextSnapshot({
		snapshot: conversationContext,
		stateCardText: runtimeStateCardText,
		projection: projectedStateCard.projection,
		usage: {
			latestUserMessageTokens:
				runtimePromptParts.estimates.latestUserMessageTokens,
			stateCardTokens: runtimePromptParts.estimates.stateCardTokens,
			runtimeUserPromptTokens: runtimePromptParts.estimates.promptTokens,
		},
	});
	let runtimeContextSnapshot: RuntimePromptSnapshot = interactiveReview
		? {
				...contextSnapshot,
				codexPrompt: {
					request: rawLatestUserMessage,
					stateCardText: null,
				},
			}
		: {
				...contextSnapshot,
				executionPhase: executionMode,
				planModeRequested: Boolean(options.planModeRequested),
				planModeClosed: !options.planModeRequested,
				...(options.planModeRequested
					? {}
					: { implementationPhasePreamble: IMPLEMENTATION_PHASE_PREAMBLE }),
				codexPrompt: buildCodexRuntimePromptSnapshot({
					runtimeLane: runtimeLaneResolution.lane,
					request: rawLatestUserMessage,
					stateCardText: runtimeStateCardText,
				}),
				conversationContext: conversationContextSnapshot,
			};
	if (!interactiveReview) {
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
					thresholdSourceLoc:
						securityIntelligence.eligibility.thresholdSourceLoc,
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
	}
	if (runtimeLaneResolution.lane === "codex-sdk") {
		const runtimeResume =
			intakeRuntimeResume ??
			(await loadCodexRuntimeResumeState({
				taskId,
				repositoryId: task.repositoryId,
				executionMode,
				agentModeSessionId: run.agentModeSessionId,
			}));
		const handedOffFromIntakeGate =
			"source" in runtimeResume &&
			runtimeResume.source === "intake_gate_handoff";
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
			message: handedOffFromIntakeGate
				? "Codex runtime thread handed off from the intake gate."
				: runtimeResume.status === "available"
					? "Codex runtime resume state loaded for the active agent mode session."
					: "Codex runtime resume state unavailable; runtime will start fresh.",
			data: {
				action: handedOffFromIntakeGate
					? "runtime.resume_state_handoff"
					: "runtime.resume_state_loaded",
				runtimeResume,
			},
		});
	}
	if (resumable) {
		runtimeContextSnapshot = carryResumableRuntimeContext({
			context: runtimeContextSnapshot,
			previousContext: run.contextSnapshot,
			resumeKind: options.resumeCommand?.kind,
		});
	}
	const compiledRun = await persistPreparedRuntimePrompt({
		taskId,
		run,
		resuming: Boolean(resumable),
		compiledPromptText,
		runtimeContextSnapshot,
	});
	await recordRuntimePromptPrepared({
		taskId,
		runId: run.id,
		source: contextSnapshot.source,
		digest: contextSnapshot.result.digest,
		charCount: contextSnapshot.result.charCount,
		runtimeLaneResolution,
		effectiveLlmRouting,
		executionMode,
		executionModeSource,
		runtimeRole,
		systemContextBinding,
	});
	return {
		run: compiledRun ?? run,
		associate: resumable
			? undefined
			: createPreparedRunAssociation({
					taskId,
					runId: run.id,
					request: options.runAssociation,
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
