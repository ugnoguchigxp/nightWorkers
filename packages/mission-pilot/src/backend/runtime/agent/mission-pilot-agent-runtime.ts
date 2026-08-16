import crypto from "node:crypto";
import {
	createSystemContextBindingSnapshot,
	p,
	runWithSystemContextBinding,
	type SystemContextBindingSnapshot,
} from "../../../systemContexts/catalog";
import { applyCurrentMissionPilotSystemContext } from "../prompts/mission-pilot-system-context";
import {
	MISSION_PILOT_AGENT_LEASE_MS,
	MISSION_PILOT_MAX_ELAPSED_MS_PER_WAKE,
	MISSION_PILOT_MAX_PROVIDER_CALLS_PER_WAKE,
	MISSION_PILOT_MAX_TOOL_CALLS_PER_WAKE,
} from "./mission-pilot-agent.constants";
import { cancelPendingMissionPilotToolCalls } from "./mission-pilot-agent-lifecycle.repository";
import type {
	MissionPilotAgentRuntimeDependencies,
	MissionPilotAgentWakeInput,
} from "./mission-pilot-agent-runtime.types";
import {
	missionPilotProviderFailure,
	missionPilotResourceFailure,
	readMissionPilotRuntimeSystemContext,
} from "./mission-pilot-agent-runtime-failures";
import { missionPilotDigest } from "./mission-pilot-content-page";
import { resolveMissionPilotContextBudgets } from "./mission-pilot-context-budget";
import {
	buildMissionPilotCompactionRequest,
	getMissionPilotCompactionSystemContext,
	shouldCompactMissionPilotContext,
} from "./mission-pilot-context-compaction";
import {
	estimateMissionPilotProviderRequestTokens,
	projectMissionPilotProviderMessages,
} from "./mission-pilot-context-envelope";
import {
	appendMissionPilotRuntimeFailure,
	claimMissionPilotAgentTurn,
	claimMissionPilotToolCall,
	compactMissionPilotConversation,
	completeMissionPilotToolCall,
	finishMissionPilotAgentTurn,
	getMissionPilotConversationCheckpoint,
	loadMissionPilotProviderMessages,
	persistMissionPilotProviderTurn,
	reconcileInterruptedMissionPilotAgentSessions,
	renewMissionPilotAgentTurnLease,
	reprojectMissionPilotTerminalToolCall,
} from "./mission-pilot-conversation.repository";
import { buildMissionPilotCurrentStepContext } from "./mission-pilot-current-step-context";
import {
	MissionPilotProviderRetryScheduledError,
	missionPilotProviderPort,
} from "./mission-pilot-provider.port";
import { recordMissionPilotProviderTurnUsage } from "./mission-pilot-provider-usage";
import { missionPilotTaskActionPort } from "./mission-pilot-task-action.adapter";
import { getMissionPilotActionDefinition } from "./mission-pilot-task-action.registry";
import { missionPilotTaskReadPort } from "./mission-pilot-task-read.adapter";
import {
	executeMissionPilotToolCall,
	missionPilotToolDefinitions,
} from "./mission-pilot-tools";

const activeControllers = new Map<string, AbortController>();
const activeRuntimeCompletions = new Map<string, Promise<void>>();
export function runMissionPilotAgentWake(
	input: MissionPilotAgentWakeInput,
	dependencies: MissionPilotAgentRuntimeDependencies = {},
) {
	const systemContextBinding = createSystemContextBindingSnapshot();
	return runWithSystemContextBinding(
		() =>
			runMissionPilotAgentWakeInScope(
				input,
				dependencies,
				systemContextBinding,
			),
		systemContextBinding,
	);
}

async function runMissionPilotAgentWakeInScope(
	input: MissionPilotAgentWakeInput,
	dependencies: MissionPilotAgentRuntimeDependencies,
	systemContextBinding: SystemContextBindingSnapshot,
) {
	const contextBudgets = resolveMissionPilotContextBudgets({
		softTokenBudget: dependencies.compactionTokenBudget,
		hardTokenBudget: dependencies.contextHardTokenBudget,
	});
	if (activeControllers.has(input.sessionId))
		return { kind: "already_running" } as const;
	const controller = new AbortController();
	activeControllers.set(input.sessionId, controller);
	let resolveRuntimeCompletion!: () => void;
	const runtimeCompletion = new Promise<void>((resolve) => {
		resolveRuntimeCompletion = resolve;
	});
	activeRuntimeCompletions.set(input.sessionId, runtimeCompletion);
	let elapsedLimitReached = false;
	const elapsedTimer = setTimeout(
		() => {
			elapsedLimitReached = true;
			controller.abort(
				new Error("Mission Pilot wake elapsed-time limit reached"),
			);
		},
		Math.max(
			1,
			dependencies.maxElapsedMsPerWake ?? MISSION_PILOT_MAX_ELAPSED_MS_PER_WAKE,
		),
	);
	const leaseOwner = `mission-pilot-agent:${crypto.randomUUID()}`;
	let claimed: Awaited<ReturnType<typeof claimMissionPilotAgentTurn>> = null;
	let lastTurnId: string | null = null;
	let leaseHeartbeat: ReturnType<typeof setInterval> | null = null;
	let leaseHeartbeatRunning = false;
	try {
		claimed = await claimMissionPilotAgentTurn({
			sessionId: input.sessionId,
			leaseOwner,
		});
		if (!claimed) return { kind: "not_claimed" } as const;
		lastTurnId = claimed.turnId;
		leaseHeartbeat = setInterval(
			() => {
				if (leaseHeartbeatRunning || controller.signal.aborted) return;
				leaseHeartbeatRunning = true;
				void renewMissionPilotAgentTurnLease({
					sessionId: input.sessionId,
					turnId: claimed?.turnId ?? "",
					leaseOwner,
				})
					.then((renewed) => {
						if (!renewed)
							controller.abort(new Error("Mission Pilot turn lease was lost"));
					})
					.catch((error) => controller.abort(error))
					.finally(() => {
						leaseHeartbeatRunning = false;
					});
			},
			Math.max(1_000, Math.floor(MISSION_PILOT_AGENT_LEASE_MS / 3)),
		);
		const provider = dependencies.provider ?? missionPilotProviderPort;
		const readPort = dependencies.readPort ?? missionPilotTaskReadPort;
		const actionPort = dependencies.actionPort ?? missionPilotTaskActionPort;
		const recordProviderUsage =
			dependencies.recordProviderUsage ?? recordMissionPilotProviderTurnUsage;
		const providerLimit =
			dependencies.maxProviderCallsPerWake ??
			MISSION_PILOT_MAX_PROVIDER_CALLS_PER_WAKE;
		const toolLimit =
			dependencies.maxToolCallsPerWake ?? MISSION_PILOT_MAX_TOOL_CALLS_PER_WAKE;
		let providerCalls = 0;
		let toolCalls = 0;
		let shouldWaitForEvent = false;
		while (!controller.signal.aborted) {
			if (
				!(await renewMissionPilotAgentTurnLease({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
				}))
			)
				return finishAndReturn("stopped");
			if (providerCalls >= providerLimit || toolCalls >= toolLimit) {
				const failure = missionPilotResourceFailure(
					providerCalls >= providerLimit
						? "maxProviderCallsPerWake"
						: "maxToolCallsPerWake",
				);
				await appendMissionPilotRuntimeFailure({
					sessionId: input.sessionId,
					failure,
					leaseOwner,
				}).catch(() => null);
				await cancelPendingMissionPilotToolCalls(
					input.sessionId,
					"resource_limit",
				).catch(() => null);
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "attention",
					error: failure,
				});
				return { kind: "attention", failure } as const;
			}
			const checkpoint = await getMissionPilotConversationCheckpoint(
				input.sessionId,
			);
			if (!checkpoint) return finishAndReturn("stopped");
			const providerMessages = await loadMissionPilotProviderMessages(
				input.sessionId,
			);
			const currentStepContext = await buildMissionPilotCurrentStepContext({
				sessionId: input.sessionId,
				taskId: claimed.session.taskId,
				readPort,
				triggerEvents: claimed.triggerEvents,
			});
			const baseSystemContext = applyCurrentMissionPilotSystemContext(
				readMissionPilotRuntimeSystemContext(providerMessages),
				p,
			);
			const systemContext = p("missionPilot.current-step", {
				baseSystemContext: baseSystemContext.trimEnd(),
				currentStepContext,
			});
			const messages = projectMissionPilotProviderMessages(providerMessages);
			const tools = missionPilotToolDefinitions();
			if (
				shouldCompactMissionPilotContext({
					systemContext,
					messages,
					tools,
					softTokenBudget: contextBudgets.softTokenBudget,
				})
			) {
				if (providerCalls >= providerLimit) {
					const failure = missionPilotResourceFailure(
						"maxProviderCallsPerWake",
					);
					await appendMissionPilotRuntimeFailure({
						sessionId: input.sessionId,
						failure,
						leaseOwner,
					}).catch(() => null);
					await finishMissionPilotAgentTurn({
						sessionId: input.sessionId,
						turnId: claimed.turnId,
						leaseOwner,
						state: "attention",
						error: failure,
					});
					return { kind: "attention", failure } as const;
				}
				providerCalls += 1;
				const compactionSystemContext =
					getMissionPilotCompactionSystemContext(p);
				const providerCallIndex = providerCalls;
				const providerStartedAt = Date.now();
				const compacted = await provider.nextTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					providerCallIndex,
					retryAttempt:
						providerCallIndex === 1 ? claimed.providerRetryAttempt : 1,
					systemContext: compactionSystemContext,
					systemContextBinding,
					messages: buildMissionPilotCompactionRequest(messages),
					tools: [],
					providerEndpointId: input.providerEndpointId ?? null,
					model: input.model ?? null,
					thinkingDepth: input.thinkingDepth ?? null,
					taskId: claimed.session.taskId,
					signal: controller.signal,
					currentStepContext,
				});
				if (controller.signal.aborted) return finishAfterAbort();
				if (compacted.type === "supported")
					await recordProviderUsage({
						sessionId: input.sessionId,
						taskId: claimed.session.taskId,
						turnId: claimed.turnId,
						providerCallIndex,
						label: "mission_pilot_compaction",
						systemContext: compactionSystemContext,
						messages: buildMissionPilotCompactionRequest(messages),
						response: compacted,
						durationMs: Date.now() - providerStartedAt,
					}).catch(() => false);
				if (compacted.type !== "supported" || !compacted.content.trim()) {
					const failure = missionPilotProviderFailure(
						compacted.type === "unsupported"
							? compacted.reason
							: "Provider returned an empty context compaction summary",
					);
					await appendMissionPilotRuntimeFailure({
						sessionId: input.sessionId,
						failure,
						leaseOwner,
					}).catch(() => null);
					await finishMissionPilotAgentTurn({
						sessionId: input.sessionId,
						turnId: claimed.turnId,
						leaseOwner,
						state: "attention",
						error: failure,
					});
					return { kind: "attention", failure } as const;
				}
				await compactMissionPilotConversation({
					sessionId: input.sessionId,
					summary: compacted.content,
					leaseOwner,
					sourceRevision: checkpoint.revision,
					sourceDigest: missionPilotDigest(JSON.stringify(messages)),
					sourceThroughSequence: checkpoint.sourceThroughSequence,
				});
				continue;
			}
			const tokenBudget = contextBudgets.hardTokenBudget;
			if (
				estimateMissionPilotProviderRequestTokens({
					systemContext,
					messages,
					tools,
				}) > tokenBudget
			) {
				const failure = missionPilotResourceFailure(
					"providerContextHardTokenBudget",
				);
				await appendMissionPilotRuntimeFailure({
					sessionId: input.sessionId,
					failure,
					leaseOwner,
				}).catch(() => null);
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "attention",
					error: failure,
				});
				return { kind: "attention", failure } as const;
			}
			providerCalls += 1;
			const providerCallIndex = providerCalls;
			const providerStartedAt = Date.now();
			const response = await provider.nextTurn({
				sessionId: input.sessionId,
				turnId: claimed.turnId,
				providerCallIndex,
				retryAttempt:
					providerCallIndex === 1 ? claimed.providerRetryAttempt : 1,
				systemContext,
				systemContextBinding,
				messages,
				tools,
				providerEndpointId: input.providerEndpointId ?? null,
				model: input.model ?? null,
				thinkingDepth: input.thinkingDepth ?? null,
				taskId: claimed.session.taskId,
				signal: controller.signal,
				currentStepContext,
			});
			if (controller.signal.aborted) return finishAfterAbort();
			if (response.type === "supported")
				await recordProviderUsage({
					sessionId: input.sessionId,
					taskId: claimed.session.taskId,
					turnId: claimed.turnId,
					providerCallIndex,
					label: "mission_pilot_agent",
					systemContext,
					messages,
					response,
					durationMs: Date.now() - providerStartedAt,
				}).catch(() => false);
			if (response.type === "unsupported") {
				const failure = missionPilotProviderFailure(response.reason);
				await appendMissionPilotRuntimeFailure({
					sessionId: input.sessionId,
					failure,
					leaseOwner,
				}).catch(() => null);
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "attention",
					error: failure,
				});
				return { kind: "attention", failure } as const;
			}
			const persisted = await persistMissionPilotProviderTurn({
				sessionId: input.sessionId,
				turnId: claimed.turnId,
				leaseOwner,
				content: response.content,
				toolCalls: response.toolCalls,
				provider: response.providerDebug?.provider as string | undefined,
				model: response.model ?? input.model ?? null,
			});
			if (!persisted) return finishAndReturn("stopped");
			if (response.toolCalls.length === 0) {
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "waiting",
				});
				return { kind: "waiting", content: response.content } as const;
			}
			for (const callRow of persisted) {
				if (controller.signal.aborted) return finishAfterAbort();
				toolCalls += 1;
				if (toolCalls > toolLimit) break;
				const call = response.toolCalls.find(
					(candidate) => candidate.id === callRow.providerCallId,
				);
				if (!call) continue;
				const running = await claimMissionPilotToolCall({
					id: callRow.id,
					leaseOwner,
				});
				if (!running) {
					if (["succeeded", "failed", "cancelled"].includes(callRow.status))
						await reprojectMissionPilotTerminalToolCall({
							id: callRow.id,
							leaseOwner,
						});
					continue;
				}
				const result = await executeMissionPilotToolCall({
					call,
					toolCallId: running.id,
					leaseOwner,
					taskId: claimed.session.taskId,
					sessionId: input.sessionId,
					turnId: running.turnId,
					idempotencyKey: running.idempotencyKey,
					readPort,
					actionPort,
					signal: controller.signal,
				});
				await completeMissionPilotToolCall(
					result.ok
						? { id: running.id, result: result.data }
						: { id: running.id, failure: result.failure },
				);
				if (controller.signal.aborted) return finishAfterAbort();
				if (result.ok && result.directive === "finish") {
					await finishMissionPilotAgentTurn({
						sessionId: input.sessionId,
						turnId: claimed.turnId,
						leaseOwner,
						state: "completed",
					});
					return { kind: "completed", data: result.data } as const;
				}
				if (
					!result.ok &&
					["permission", "revision_conflict", "outcome_unknown"].includes(
						result.failure.kind,
					)
				)
					continue;
				if (result.ok && !result.replayed) {
					const metadata = getMissionPilotActionDefinition(
						callRow.actionId,
					)?.execution;
					const requestedWaitAlreadySatisfied =
						result.directive === "wait" &&
						claimed.triggerEvents.some((event) =>
							result.waitFor.includes(
								event.eventType as (typeof result.waitFor)[number],
							),
						);
					if (
						!requestedWaitAlreadySatisfied &&
						(result.directive === "wait" ||
							metadata?.completion === "wait_for_event")
					)
						shouldWaitForEvent = true;
				}
			}
			if (shouldWaitForEvent) {
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "waiting",
				});
				return { kind: "waiting" } as const;
			}
		}
		return finishAfterAbort();
	} catch (error) {
		if (
			error instanceof MissionPilotProviderRetryScheduledError &&
			claimed &&
			lastTurnId
		) {
			await finishMissionPilotAgentTurn({
				sessionId: input.sessionId,
				turnId: lastTurnId,
				leaseOwner,
				state: "waiting",
			});
			return {
				kind: "waiting",
				retryScheduledAt: error.availableAt,
			} as const;
		}
		const failure = elapsedLimitReached
			? missionPilotResourceFailure("maxElapsedMsPerWake")
			: missionPilotProviderFailure(error);
		if (claimed && (!controller.signal.aborted || elapsedLimitReached))
			await appendMissionPilotRuntimeFailure({
				sessionId: input.sessionId,
				failure,
				leaseOwner,
			}).catch(() => null);
		const stopped = controller.signal.aborted && !elapsedLimitReached;
		if (claimed && lastTurnId)
			await finishMissionPilotAgentTurn({
				sessionId: input.sessionId,
				turnId: lastTurnId,
				leaseOwner,
				state: stopped ? "stopped" : "attention",
				error: failure,
			});
		return {
			kind: stopped ? "stopped" : "attention",
			failure,
		} as const;
	} finally {
		clearTimeout(elapsedTimer);
		if (leaseHeartbeat) clearInterval(leaseHeartbeat);
		activeControllers.delete(input.sessionId);
		activeRuntimeCompletions.delete(input.sessionId);
		resolveRuntimeCompletion();
	}

	async function finishAndReturn(state: "stopped") {
		if (claimed && lastTurnId)
			await finishMissionPilotAgentTurn({
				sessionId: input.sessionId,
				turnId: lastTurnId,
				leaseOwner,
				state,
			});
		return { kind: state } as const;
	}

	async function finishAfterAbort() {
		if (!elapsedLimitReached) return finishAndReturn("stopped");
		const failure = missionPilotResourceFailure("maxElapsedMsPerWake");
		await appendMissionPilotRuntimeFailure({
			sessionId: input.sessionId,
			failure,
			leaseOwner,
		}).catch(() => null);
		await cancelPendingMissionPilotToolCalls(
			input.sessionId,
			"resource_limit",
		).catch(() => null);
		if (claimed && lastTurnId)
			await finishMissionPilotAgentTurn({
				sessionId: input.sessionId,
				turnId: lastTurnId,
				leaseOwner,
				state: "attention",
				error: failure,
			});
		return { kind: "attention", failure } as const;
	}
}

export async function stopMissionPilotAgentRuntime(
	sessionId: string,
	timeoutMs = 2_000,
) {
	const controller = activeControllers.get(sessionId);
	if (!controller) return { requested: false, quiesced: true } as const;
	controller.abort(new Error("Mission Pilot stop requested by user."));
	const completion = activeRuntimeCompletions.get(sessionId);
	if (!completion) return { requested: true, quiesced: true } as const;
	let timeout: ReturnType<typeof setTimeout> | null = null;
	const quiesced = await Promise.race([
		completion.then(() => true),
		new Promise<false>((resolve) => {
			timeout = setTimeout(() => resolve(false), Math.max(1, timeoutMs));
			timeout.unref?.();
		}),
	]);
	if (timeout) clearTimeout(timeout);
	return { requested: true, quiesced } as const;
}

export function isMissionPilotAgentRuntimeActive(sessionId: string) {
	return activeControllers.has(sessionId);
}
export { reconcileInterruptedMissionPilotAgentSessions };
