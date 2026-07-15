import crypto from "node:crypto";
import type { MissionPilotActionFailure } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { buildMissionPilotSystemContext } from "../../../services/structured-generation/prompts/mission-pilot-system-context";
import { normalizeStructuredProviderError } from "../../../services/structured-llm/public";
import {
	MISSION_PILOT_AGENT_LEASE_MS,
	MISSION_PILOT_CONTEXT_HARD_TOKENS,
	MISSION_PILOT_CONTEXT_SOFT_TOKENS,
	MISSION_PILOT_MAX_ELAPSED_MS_PER_WAKE,
	MISSION_PILOT_MAX_PROVIDER_CALLS_PER_WAKE,
	MISSION_PILOT_MAX_TOOL_CALLS_PER_WAKE,
} from "./mission-pilot-agent.constants";
import type {
	MissionPilotProviderPort,
	MissionPilotTaskActionPort,
	MissionPilotTaskReadPort,
} from "./mission-pilot-agent.ports";
import { cancelPendingMissionPilotToolCalls } from "./mission-pilot-agent-lifecycle.repository";
import { missionPilotDigest } from "./mission-pilot-content-page";
import {
	buildMissionPilotCompactionRequest,
	MISSION_PILOT_COMPACTION_SYSTEM_CONTEXT,
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
import { missionPilotProviderPort } from "./mission-pilot-provider.port";
import { missionPilotTaskActionPort } from "./mission-pilot-task-action.adapter";
import { missionPilotTaskReadPort } from "./mission-pilot-task-read.adapter";
import {
	executeMissionPilotToolCall,
	missionPilotToolDefinitions,
} from "./mission-pilot-tools";

const activeControllers = new Map<string, AbortController>();
export type MissionPilotAgentRuntimeDependencies = {
	provider?: MissionPilotProviderPort;
	readPort?: MissionPilotTaskReadPort;
	actionPort?: MissionPilotTaskActionPort;
	maxProviderCallsPerWake?: number;
	maxToolCallsPerWake?: number;
	maxElapsedMsPerWake?: number;
	contextHardTokenBudget?: number;
	compactionTokenBudget?: number;
};

export async function runMissionPilotAgentWake(
	input: {
		sessionId: string;
		providerEndpointId?: string | null;
		model?: string | null;
		thinkingDepth?: string | null;
	},
	dependencies: MissionPilotAgentRuntimeDependencies = {},
) {
	if (activeControllers.has(input.sessionId))
		return { kind: "already_running" } as const;
	const controller = new AbortController();
	activeControllers.set(input.sessionId, controller);
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
				const failure = resourceFailure(
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
			const systemContext = readSystemContext(providerMessages);
			const messages = projectMissionPilotProviderMessages(providerMessages);
			const tools = missionPilotToolDefinitions();
			if (
				shouldCompactMissionPilotContext({
					systemContext,
					messages,
					tools,
					softTokenBudget:
						dependencies.compactionTokenBudget ??
						MISSION_PILOT_CONTEXT_SOFT_TOKENS,
				})
			) {
				if (providerCalls >= providerLimit) {
					const failure = resourceFailure("maxProviderCallsPerWake");
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
				const compacted = await provider.nextTurn({
					systemContext: MISSION_PILOT_COMPACTION_SYSTEM_CONTEXT,
					messages: buildMissionPilotCompactionRequest(messages),
					tools: [],
					providerEndpointId: input.providerEndpointId ?? null,
					model: input.model ?? null,
					thinkingDepth: input.thinkingDepth ?? null,
					taskId: claimed.session.taskId,
					signal: controller.signal,
				});
				if (controller.signal.aborted) return finishAfterAbort();
				if (compacted.type !== "supported" || !compacted.content.trim()) {
					const failure = providerFailure(
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
			const tokenBudget =
				dependencies.contextHardTokenBudget ??
				MISSION_PILOT_CONTEXT_HARD_TOKENS;
			if (
				estimateMissionPilotProviderRequestTokens({
					systemContext,
					messages,
					tools,
				}) > tokenBudget
			) {
				const failure = resourceFailure("providerContextHardTokenBudget");
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
			const response = await provider.nextTurn({
				systemContext,
				messages,
				tools,
				providerEndpointId: input.providerEndpointId ?? null,
				model: input.model ?? null,
				thinkingDepth: input.thinkingDepth ?? null,
				taskId: claimed.session.taskId,
				signal: controller.signal,
			});
			if (controller.signal.aborted) return finishAfterAbort();
			if (response.type === "unsupported") {
				const failure = providerFailure(response.reason);
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
					idempotencyKey: running.idempotencyKey,
					readPort,
					actionPort,
				});
				await completeMissionPilotToolCall(
					result.ok
						? { id: running.id, result: result.data }
						: { id: running.id, failure: result.failure },
				);
				if (controller.signal.aborted) return finishAfterAbort();
				if (
					!result.ok &&
					["permission", "revision_conflict", "outcome_unknown"].includes(
						result.failure.kind,
					)
				)
					continue;
				if (
					result.ok &&
					["task.complete", "task.archive"].includes(callRow.actionId)
				) {
					await finishMissionPilotAgentTurn({
						sessionId: input.sessionId,
						turnId: claimed.turnId,
						leaseOwner,
						state: "completed",
					});
					return { kind: "completed", data: result.data } as const;
				}
				if (
					result.ok &&
					[
						"run.implementation.start",
						"run.test.start",
						"review.run.start",
						"task.queue.enqueue",
					].includes(callRow.actionId)
				)
					shouldWaitForEvent = true;
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
		const failure = elapsedLimitReached
			? resourceFailure("maxElapsedMsPerWake")
			: providerFailure(error);
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
		const failure = resourceFailure("maxElapsedMsPerWake");
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

export function stopMissionPilotAgentRuntime(sessionId: string) {
	const controller = activeControllers.get(sessionId);
	controller?.abort();
	return Boolean(controller);
}
export { reconcileInterruptedMissionPilotAgentSessions };

function readSystemContext(
	messages: Awaited<ReturnType<typeof loadMissionPilotProviderMessages>>,
) {
	const system = messages.find((message) => message.role === "system");
	return system?.content ?? buildMissionPilotSystemContext();
}
function providerFailure(error: unknown): MissionPilotActionFailure {
	const normalized = error instanceof Error ? error.message : String(error);
	const typed = normalizeStructuredProviderError(error);
	return {
		kind: typed.kind,
		retryable: typed.retryable,
		providerCode: typed.code ?? null,
		httpStatus: typed.httpStatus ?? null,
		message: normalized,
		retryAfterMs: typed.retryAfterMs ?? null,
		attempt: typed.attempt ?? 1,
		actionId: "provider.next_turn",
		idempotencyKey: null,
	};
}
function resourceFailure(limit: string): MissionPilotActionFailure {
	return {
		kind: "resource_limit",
		retryable: false,
		providerCode: null,
		httpStatus: null,
		message: `Mission Pilot wake resource limit reached: ${limit}`,
		retryAfterMs: null,
		attempt: 1,
		actionId: "runtime.continue",
		idempotencyKey: null,
	};
}
