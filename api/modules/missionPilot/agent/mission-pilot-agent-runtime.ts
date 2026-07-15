import crypto from "node:crypto";
import type { MissionPilotActionFailure } from "../../../../shared/schemas/mission-pilot-agent.schema";
import { buildMissionPilotSystemContext } from "../../../services/structured-generation/prompts/mission-pilot-system-context";
import type {
	ProviderToolCall,
	ProviderToolDefinition,
} from "../../../services/structured-llm/public";
import type {
	MissionPilotProviderPort,
	MissionPilotTaskActionPort,
	MissionPilotTaskReadPort,
} from "./mission-pilot-agent.ports";
import {
	cancelPendingMissionPilotToolCalls,
	finishMissionPilotAgentTurn,
	renewMissionPilotAgentTurnLease,
	resumeMissionPilotAgentTurnAfterTools,
} from "./mission-pilot-agent-lifecycle.repository";
import {
	appendMissionPilotRuntimeFailure,
	claimMissionPilotAgentTurn,
	claimMissionPilotToolCall,
	compactMissionPilotConversation,
	completeMissionPilotToolCall,
	loadMissionPilotProviderMessages,
	persistMissionPilotProviderTurn,
} from "./mission-pilot-conversation.repository";
import { missionPilotProviderPort } from "./mission-pilot-provider.port";
import { missionPilotTaskActionPort } from "./mission-pilot-task-action.adapter";
import {
	getMissionPilotActionByToolName,
	missionPilotActionToolDefinitions,
} from "./mission-pilot-task-action.registry";
import { missionPilotTaskReadPort } from "./mission-pilot-task-read.adapter";

const MAX_PROVIDER_CALLS_PER_WAKE = 16;
const MAX_TOOL_CALLS_PER_WAKE = 32;
const COMPACTION_TOKEN_BUDGET = 80_000;

const MISSION_PILOT_COMPACTION_CONTEXT = `
Mission Pilot自身の永続conversationを、次のturnで判断を継続できる日本語の要約へ圧縮してください。
ユーザーの依頼と確定判断、実行済みactionと結果、未解決事項、正本Artifact/Runへの参照を保持してください。
推測、固定workflow、worker transcriptを追加せず、正しい本文を診断文へ置き換えないでください。
`.trim();

const readTools: ProviderToolDefinition[] = [
	{
		name: "read_task_workspace",
		description:
			"Task goal、Project、current UI view、Questionnaire、Plan Artifact、Queue、Run outcome、利用可能actionを読む。worker transcriptは返さない。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_current_specification",
		description:
			"current Specificationの本文、revision、digest、source refsを読む。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_questionnaire_decisions",
		description:
			"確定済みQuestionnaire Decisionsを採用answerとsource revision付きで読む。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
	{
		name: "read_plan_artifact",
		description: "指定したcurrent Plan ArtifactをIDで読む。",
		inputSchema: {
			type: "object",
			properties: { artifactId: { type: "string" } },
			required: ["artifactId"],
			additionalProperties: false,
		},
	},
	{
		name: "read_run_outcome",
		description:
			"指定Runのterminal final report、blocker、verification summaryだけを読む。",
		inputSchema: {
			type: "object",
			properties: { runId: { type: "string", format: "uuid" } },
			required: ["runId"],
			additionalProperties: false,
		},
	},
	{
		name: "list_available_task_actions",
		description:
			"現在のauthorizationとpreconditionで選択可能なTask actionを列挙する。",
		inputSchema: {
			type: "object",
			properties: {},
			additionalProperties: false,
		},
	},
];

const activeControllers = new Map<string, AbortController>();

export type MissionPilotAgentRuntimeDependencies = {
	provider?: MissionPilotProviderPort;
	readPort?: MissionPilotTaskReadPort;
	actionPort?: MissionPilotTaskActionPort;
	maxProviderCallsPerWake?: number;
	maxToolCallsPerWake?: number;
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
	if (activeControllers.has(input.sessionId)) {
		return { kind: "already_running" } as const;
	}
	const controller = new AbortController();
	activeControllers.set(input.sessionId, controller);
	const leaseOwner = `mission-pilot-agent:${crypto.randomUUID()}`;
	let claimed: Awaited<ReturnType<typeof claimMissionPilotAgentTurn>> = null;
	try {
		claimed = await claimMissionPilotAgentTurn({
			sessionId: input.sessionId,
			leaseOwner,
		});
		if (!claimed) return { kind: "not_claimed" } as const;
		const provider = dependencies.provider ?? missionPilotProviderPort;
		const readPort = dependencies.readPort ?? missionPilotTaskReadPort;
		const actionPort = dependencies.actionPort ?? missionPilotTaskActionPort;
		const maxProviderCalls =
			dependencies.maxProviderCallsPerWake ?? MAX_PROVIDER_CALLS_PER_WAKE;
		const maxToolCalls =
			dependencies.maxToolCallsPerWake ?? MAX_TOOL_CALLS_PER_WAKE;
		let providerCalls = 0;
		let toolCalls = 0;
		const systemContext = buildMissionPilotSystemContext({
			authorization: claimed.session.authorizationJson,
			pushPolicy: claimed.session.authorizationJson?.pushPolicy ?? null,
		});
		const messagesBeforeCompaction = await loadMissionPilotProviderMessages(
			input.sessionId,
		);
		if (
			estimateProviderTokens(messagesBeforeCompaction) >
			(dependencies.compactionTokenBudget ?? COMPACTION_TOKEN_BUDGET)
		) {
			providerCalls++;
			const compacted = await provider.nextTurn({
				systemContext: MISSION_PILOT_COMPACTION_CONTEXT,
				messages: messagesBeforeCompaction,
				tools: [],
				providerEndpointId: input.providerEndpointId ?? null,
				model: input.model ?? null,
				thinkingDepth: input.thinkingDepth ?? null,
				taskId: claimed.session.taskId,
				signal: controller.signal,
			});
			if (
				controller.signal.aborted ||
				!(await renewMissionPilotAgentTurnLease({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
				}))
			) {
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "stopped",
				});
				return { kind: "stopped" } as const;
			}
			if (compacted.type === "supported" && compacted.content.trim()) {
				await compactMissionPilotConversation({
					sessionId: input.sessionId,
					summary: compacted.content,
					sourceRevision: claimed.session.conversationRevision,
					leaseOwner,
				});
			}
		}
		while (!controller.signal.aborted) {
			const active = await renewMissionPilotAgentTurnLease({
				sessionId: input.sessionId,
				turnId: claimed.turnId,
				leaseOwner,
			});
			if (!active) {
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "stopped",
				});
				return { kind: "stopped" } as const;
			}
			if (providerCalls >= maxProviderCalls || toolCalls >= maxToolCalls) {
				const failure = resourceLimitFailure(
					providerCalls >= maxProviderCalls
						? "maxProviderCallsPerWake"
						: "maxToolCallsPerWake",
				);
				await appendMissionPilotRuntimeFailure({
					sessionId: input.sessionId,
					failure,
				}).catch(() => null);
				await cancelPendingMissionPilotToolCalls(
					input.sessionId,
					"resource_limit",
				);
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "attention",
					error: failure,
				});
				return { kind: "attention", failure } as const;
			}
			const messages = await loadMissionPilotProviderMessages(input.sessionId);
			providerCalls++;
			const response = await provider.nextTurn({
				systemContext,
				messages,
				tools: [...readTools, ...missionPilotActionToolDefinitions()],
				providerEndpointId: input.providerEndpointId ?? null,
				model: input.model ?? null,
				thinkingDepth: input.thinkingDepth ?? null,
				taskId: claimed.session.taskId,
				signal: controller.signal,
			});
			if (controller.signal.aborted) break;
			if (response.type === "unsupported") {
				const failure: MissionPilotActionFailure = {
					kind: "provider_capability",
					retryable: false,
					providerCode: null,
					httpStatus: null,
					message: response.reason,
					retryAfterMs: null,
					attempt: providerCalls,
					actionId: "provider.next_turn",
					idempotencyKey: null,
				};
				await appendMissionPilotRuntimeFailure({
					sessionId: input.sessionId,
					failure,
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
			const persistedCalls = await persistMissionPilotProviderTurn({
				sessionId: input.sessionId,
				turnId: claimed.turnId,
				leaseOwner,
				content: response.content,
				toolCalls: response.toolCalls,
				provider: null,
				model: response.model ?? input.model ?? null,
			});
			if (!persistedCalls) {
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "stopped",
				});
				return { kind: "stopped" } as const;
			}
			if (response.toolCalls.length === 0) {
				return { kind: "waiting", content: response.content } as const;
			}
			for (const callRow of persistedCalls) {
				if (controller.signal.aborted) break;
				toolCalls++;
				if (toolCalls > maxToolCalls) break;
				if (
					!(await renewMissionPilotAgentTurnLease({
						sessionId: input.sessionId,
						turnId: claimed.turnId,
						leaseOwner,
					}))
				)
					break;
				const claimedCall = await claimMissionPilotToolCall({
					id: callRow.id,
					leaseOwner,
				});
				if (claimedCall?.status !== "running") continue;
				const providerCall = response.toolCalls.find(
					(call) => call.id === claimedCall.providerCallId,
				);
				if (!providerCall) continue;
				const result = await executeToolCall({
					call: providerCall,
					taskId: claimed.session.taskId,
					sessionId: input.sessionId,
					idempotencyKey: claimedCall.idempotencyKey,
					readPort,
					actionPort,
				});
				await completeMissionPilotToolCall(
					result.ok
						? { id: claimedCall.id, result: result.data }
						: { id: claimedCall.id, failure: result.failure },
				);
				if (
					result.ok &&
					getMissionPilotActionByToolName(providerCall.name)?.actionId ===
						"task.delete"
				) {
					return { kind: "completed" } as const;
				}
			}
			if (
				!controller.signal.aborted &&
				!(await resumeMissionPilotAgentTurnAfterTools({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
				}))
			) {
				await finishMissionPilotAgentTurn({
					sessionId: input.sessionId,
					turnId: claimed.turnId,
					leaseOwner,
					state: "stopped",
				});
				return { kind: "stopped" } as const;
			}
		}
		await finishMissionPilotAgentTurn({
			sessionId: input.sessionId,
			turnId: claimed.turnId,
			leaseOwner,
			state: "stopped",
		});
		return { kind: "stopped" } as const;
	} catch (error) {
		if (claimed) {
			const failure = providerFailure(error);
			if (!controller.signal.aborted) {
				await appendMissionPilotRuntimeFailure({
					sessionId: input.sessionId,
					failure,
				}).catch(() => null);
			}
			await finishMissionPilotAgentTurn({
				sessionId: input.sessionId,
				turnId: claimed.turnId,
				leaseOwner,
				state: controller.signal.aborted ? "stopped" : "attention",
				error: failure,
			});
			return {
				kind: controller.signal.aborted ? "stopped" : "attention",
				failure,
			} as const;
		}
		return {
			kind: controller.signal.aborted ? "stopped" : "attention",
			failure: providerFailure(error),
		} as const;
	} finally {
		activeControllers.delete(input.sessionId);
	}
}

export function stopMissionPilotAgentRuntime(sessionId: string) {
	const controller = activeControllers.get(sessionId);
	controller?.abort();
	return Boolean(controller);
}

async function executeToolCall(input: {
	call: ProviderToolCall;
	taskId: string;
	sessionId: string;
	idempotencyKey: string;
	readPort: MissionPilotTaskReadPort;
	actionPort: MissionPilotTaskActionPort;
}): Promise<
	| { ok: true; data: unknown }
	| { ok: false; failure: MissionPilotActionFailure }
> {
	try {
		switch (input.call.name) {
			case "read_task_workspace":
				return {
					ok: true,
					data: await input.readPort.readTaskWorkspace({
						taskId: input.taskId,
						sessionId: input.sessionId,
					}),
				};
			case "read_current_specification":
				return {
					ok: true,
					data: await input.readPort.readCurrentSpecification(input.taskId),
				};
			case "read_questionnaire_decisions":
				return {
					ok: true,
					data: await input.readPort.readQuestionnaireDecisions(input.taskId),
				};
			case "read_plan_artifact":
				return {
					ok: true,
					data: await input.readPort.readPlanArtifact(
						input.taskId,
						textArg(input.call, "artifactId"),
					),
				};
			case "read_run_outcome":
				return {
					ok: true,
					data: await input.readPort.readRunOutcome(
						textArg(input.call, "runId"),
					),
				};
			case "list_available_task_actions":
				return {
					ok: true,
					data: await input.readPort.listAvailableTaskActions({
						taskId: input.taskId,
						sessionId: input.sessionId,
					}),
				};
		}
		const definition = getMissionPilotActionByToolName(input.call.name);
		if (!definition) {
			return {
				ok: false,
				failure: toolFailure(
					input.call.name,
					"invalid_request",
					"Unknown tool",
				),
			};
		}
		const result = await input.actionPort.execute({
			taskId: input.taskId,
			sessionId: input.sessionId,
			actionId: definition.actionId,
			arguments: input.call.arguments,
			idempotencyKey: input.idempotencyKey,
		});
		return result.ok
			? { ok: true, data: result.data }
			: { ok: false, failure: result.failure };
	} catch (error) {
		return {
			ok: false,
			failure: toolFailure(
				input.call.name,
				"domain_precondition",
				error instanceof Error ? error.message : String(error),
			),
		};
	}
}

function textArg(call: ProviderToolCall, key: string) {
	const value = call.arguments[key];
	if (typeof value !== "string" || !value)
		throw new Error(`${key} must be a non-empty string`);
	return value;
}

function providerFailure(error: unknown): MissionPilotActionFailure {
	const record =
		error && typeof error === "object"
			? (error as Record<string, unknown>)
			: {};
	return {
		kind:
			typeof record.kind === "string" &&
			["transport", "timeout", "rate_limit", "provider_capacity"].includes(
				record.kind,
			)
				? (record.kind as MissionPilotActionFailure["kind"])
				: "transport",
		retryable: typeof record.retryable === "boolean" ? record.retryable : null,
		providerCode: typeof record.code === "string" ? record.code : null,
		httpStatus:
			typeof record.httpStatus === "number" ? record.httpStatus : null,
		message: error instanceof Error ? error.message : String(error),
		retryAfterMs:
			typeof record.retryAfterMs === "number" ? record.retryAfterMs : null,
		attempt: 1,
		actionId: "provider.next_turn",
		idempotencyKey: null,
	};
}

function resourceLimitFailure(limit: string): MissionPilotActionFailure {
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

function estimateProviderTokens(messages: unknown) {
	return Math.ceil(JSON.stringify(messages).length / 4);
}

function toolFailure(
	actionId: string,
	kind: MissionPilotActionFailure["kind"],
	message: string,
): MissionPilotActionFailure {
	return {
		kind,
		retryable: false,
		providerCode: null,
		httpStatus: null,
		message,
		retryAfterMs: null,
		attempt: 1,
		actionId,
		idempotencyKey: null,
	};
}
