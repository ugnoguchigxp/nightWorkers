import { randomUUID } from "node:crypto";
import {
	buildNormalizedSupervisorLlmRequestCandidates,
	callProviderToolTurn,
	normalizeStructuredProviderError,
	providerAdapterKey,
	withStructuredProviderAttempt,
} from "../../../services/structured-llm/public";
import type { StructuredLlmThinkingDepth } from "../../../services/structured-llm/settings";
import { readStructuredLlmProviderSettings } from "../../../services/structured-llm/settings";
import {
	bindSystemContextCatalogSnapshot,
	p,
	systemContextPromptAudit,
} from "../../../systemContexts/catalog";
import { missionPilotToolTurnProviderExecutionPolicy } from "../adapters/mission-pilot-provider.adapter";
import type { MissionPilotProviderPort } from "./mission-pilot-agent.ports";
import { appendMissionPilotTaskEvent } from "./mission-pilot-task-event.repository";

export class MissionPilotProviderRetryScheduledError extends Error {
	constructor(
		readonly failure: ReturnType<typeof normalizeStructuredProviderError>,
		readonly availableAt: Date,
	) {
		super("Mission Pilot provider retry was scheduled.");
		this.name = "MissionPilotProviderRetryScheduledError";
	}
}

export function preflightMissionPilotProviderToolTurn() {
	const preflightInstruction =
		"Mission Pilotで使用するproviderがtool turnに対応しているか事前確認する。";
	const candidates = buildNormalizedSupervisorLlmRequestCandidates({
		systemPrompt: p("providerExecution.system-prompt", {
			systemPrompt: preflightInstruction,
		}),
		userPrompt: "Task Operator tool turnへの対応可否を確認してください。",
		label: "mission_pilot_provider_preflight",
		role: "mission_pilot",
	});
	const supportedAdapters = new Set([
		"azure",
		"openai",
		"bedrock",
		"codex",
		"fixture",
	]);
	const settings = readStructuredLlmProviderSettings();
	const supported = candidates.filter((candidate) =>
		isConfiguredToolTurnCandidate(candidate, supportedAdapters, settings),
	);
	return supported.length > 0
		? {
				ok: true as const,
				candidateCount: supported.length,
			}
		: {
				ok: false as const,
				code: "MISSION_PILOT_PROVIDER_TOOL_TURN_UNSUPPORTED",
				message:
					"Mission Pilotで使用できるprovider tool-turn routeが設定されていません。",
			};
}

function isConfiguredToolTurnCandidate(
	candidate: ReturnType<
		typeof buildNormalizedSupervisorLlmRequestCandidates
	>[number],
	supportedAdapters: ReadonlySet<string>,
	settings: ReturnType<typeof readStructuredLlmProviderSettings>,
) {
	const adapter = providerAdapterKey(candidate.providerId);
	if (!supportedAdapters.has(adapter)) return false;
	if (adapter === "fixture")
		return process.env.NIGHTWORKERS_E2E_ISOLATED === "1";
	const endpoint = settings.providerEndpoints?.find(
		(item) => item.id === candidate.providerEndpointId,
	);
	if (endpoint?.enabled) return true;
	if (adapter === "azure") return settings.AZURE_OPENAI_ENABLED === true;
	if (adapter === "openai") return settings.OPENAI_ENABLED === true;
	if (adapter === "bedrock") return settings.AWS_BEDROCK_ENABLED === true;
	if (adapter === "codex") return settings.CODEX_ENABLED === true;
	return false;
}

function latestUserPrompt(
	messages: Parameters<MissionPilotProviderPort["nextTurn"]>[0]["messages"],
) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (
			(message.role === "user" || message.role === "tool") &&
			typeof message.content === "string"
		)
			return message.content;
	}
	return "現在のTask Factを確認し、次の操作を判断してください。";
}

export const missionPilotProviderPort: MissionPilotProviderPort = {
	async nextTurn(input) {
		const systemContexts = bindSystemContextCatalogSnapshot(
			input.systemContextBinding,
		);
		const systemInvocation = systemContexts.invoke(
			"providerExecution.system-prompt",
			{ systemPrompt: input.systemContext },
		);
		const boundDeveloperInstructions =
			missionPilotToolTurnProviderExecutionPolicy.bindDeveloperInstructions?.(
				systemContexts.binding,
			);
		const systemContextAudit = [
			systemContextPromptAudit("system", systemContexts, systemInvocation),
		];
		const systemPrompt = systemInvocation.content.text;
		const messages = input.messages.map((message) =>
			message.role === "system"
				? { ...message, content: systemPrompt }
				: message,
		);
		const executionPolicy = boundDeveloperInstructions
			? {
					...missionPilotToolTurnProviderExecutionPolicy,
					developerInstructions: boundDeveloperInstructions.text,
				}
			: missionPilotToolTurnProviderExecutionPolicy;
		const routeOverride =
			input.providerEndpointId && input.model
				? {
						providerEndpointId: input.providerEndpointId,
						model: input.model,
						...(input.thinkingDepth
							? {
									thinkingDepth:
										input.thinkingDepth as StructuredLlmThinkingDepth,
								}
							: {}),
					}
				: null;
		const userPrompt = latestUserPrompt(input.messages);
		const normalizedRequests = buildNormalizedSupervisorLlmRequestCandidates({
			systemPrompt,
			userPrompt,
			label: "mission_pilot_agent",
			role: "mission_pilot",
			routeOverride,
		});
		return callMissionPilotProviderCandidates({
			candidates: normalizedRequests,
			signal: input.signal,
			retryContext: {
				sessionId: input.sessionId,
				taskId: input.taskId,
				turnId: input.turnId,
				providerCallIndex: input.providerCallIndex,
				taskRevision: input.currentStepContext?.taskRef.revision ?? 0,
				attempt: input.retryAttempt ?? 1,
			},
			callCandidate: (normalizedRequest) =>
				callAuditedMissionPilotProviderTurn({
					requestId: randomUUID(),
					systemContextAudit:
						providerAdapterKey(normalizedRequest.providerId) === "codex"
							? [
									...systemContextAudit,
									...(boundDeveloperInstructions?.systemContextAudit ?? []),
								]
							: systemContextAudit,
					provider: providerAdapterKey(normalizedRequest.providerId),
					messages,
					tools: input.tools,
					systemPrompt,
					userPrompt,
					options: {
						label: "mission_pilot_agent",
						role: "mission_pilot",
						routeOverride,
						taskId: input.taskId,
						normalizedRequest,
						toolChoice: "auto",
						systemContextBinding: systemContexts.binding,
						systemContextAudit,
						executionPolicy:
							providerAdapterKey(normalizedRequest.providerId) === "codex"
								? executionPolicy
								: missionPilotToolTurnProviderExecutionPolicy,
					},
					signal: input.signal,
					setProviderDebug: () => undefined,
				}),
		});
	},
};

async function callAuditedMissionPilotProviderTurn(
	input: Parameters<typeof callProviderToolTurn>[0] & {
		requestId: string;
		systemContextAudit: ReturnType<typeof systemContextPromptAudit>[];
	},
) {
	const { requestId, systemContextAudit, ...providerInput } = input;
	const result = await callProviderToolTurn(providerInput);
	return {
		...result,
		requestId,
		systemContextAudit,
	};
}

type MissionPilotProviderCandidate = ReturnType<
	typeof buildNormalizedSupervisorLlmRequestCandidates
>[number];

export async function callMissionPilotProviderCandidates(input: {
	candidates: MissionPilotProviderCandidate[];
	signal: AbortSignal;
	retryContext?: {
		sessionId: string;
		taskId: string;
		turnId: string;
		providerCallIndex: number;
		taskRevision: number;
		attempt?: number;
	};
	callCandidate: (
		candidate: MissionPilotProviderCandidate,
	) => ReturnType<typeof callProviderToolTurn>;
}) {
	if (input.candidates.length === 0) {
		return {
			type: "unsupported" as const,
			reason:
				"Mission Pilot has no configured provider route that supports tool turns.",
			providerDebug: {
				mode: "provider_native_tools",
				candidateCount: 0,
			},
		};
	}

	let lastUnsupported: Awaited<ReturnType<typeof callProviderToolTurn>> | null =
		null;
	let lastRetryableFailure: unknown = null;
	for (const candidate of input.candidates) {
		try {
			const result = await input.callCandidate(candidate);
			if (result.type === "supported") return result;
			lastUnsupported = result;
		} catch (error) {
			const failure = normalizeStructuredProviderError(error);
			if (!failure.retryable || input.signal.aborted) throw failure;
			lastRetryableFailure = failure;
		}
	}
	if (lastRetryableFailure)
		return retryMissionPilotProviderCall(
			() => Promise.reject(lastRetryableFailure),
			input.signal,
			input.retryContext,
		);

	return (
		lastUnsupported ?? {
			type: "unsupported" as const,
			reason:
				"Mission Pilot has no configured provider route that supports tool turns.",
		}
	);
}

export async function retryMissionPilotProviderCall<T>(
	operation: () => Promise<T>,
	signal: AbortSignal,
	retryContext?: {
		sessionId: string;
		taskId: string;
		turnId: string;
		providerCallIndex: number;
		taskRevision: number;
		attempt?: number;
	},
) {
	const attempt = Math.max(1, Math.min(3, retryContext?.attempt ?? 1));
	try {
		return await operation();
	} catch (error) {
		const failure = withStructuredProviderAttempt(
			normalizeStructuredProviderError(error),
			attempt,
		);
		if (!failure.retryable || attempt === 3 || signal.aborted || !retryContext)
			throw failure;
		const delay =
			process.env.NODE_ENV === "test"
				? 0
				: Math.min(10_000, failure.retryAfterMs ?? 250 * 2 ** (attempt - 1));
		const availableAt = new Date(Date.now() + delay);
		const sourceEventId = [
			"provider-retry",
			retryContext.sessionId,
			retryContext.turnId,
			retryContext.providerCallIndex,
			attempt + 1,
		].join(":");
		await appendMissionPilotTaskEvent({
			taskId: retryContext.taskId,
			eventType: "mission_pilot.retry_timer_elapsed",
			sourceEventId,
			taskRevision: retryContext.taskRevision,
			payload: {
				attempt,
				nextAttempt: attempt + 1,
				retryAfterMs: failure.retryAfterMs,
				failure,
			},
			availableAt,
		});
		throw new MissionPilotProviderRetryScheduledError(failure, availableAt);
	}
}
