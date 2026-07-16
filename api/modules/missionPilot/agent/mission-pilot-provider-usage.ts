import { logEvent } from "../../../lib/logger";
import { estimateTokens } from "../../../services/conversation-context/token-budget";
import { recordLlmUsage } from "../../../services/llm-usage";
import { missionPilotThoughtTrace } from "../../nightworkers/nightworkers.trace-provenance";
import type { MissionPilotProviderPort } from "./mission-pilot-agent.ports";

export async function recordMissionPilotProviderTurnUsage(input: {
	sessionId: string;
	taskId: string;
	turnId: string;
	providerCallIndex: number;
	label: "mission_pilot_agent" | "mission_pilot_compaction";
	systemContext: string;
	messages: unknown[];
	response: Extract<
		Awaited<ReturnType<MissionPilotProviderPort["nextTurn"]>>,
		{ type: "supported" }
	>;
	durationMs: number;
}) {
	const callId = `mission-pilot:${input.sessionId}:${input.turnId}:${input.label}:${input.providerCallIndex}`;
	const provider =
		typeof input.response.providerDebug?.provider === "string"
			? input.response.providerDebug.provider
			: "mission-pilot-provider";
	try {
		await recordLlmUsage({
			taskId: input.taskId,
			callId,
			provider,
			model: input.response.model ?? null,
			label: input.label,
			usage: input.response.usage,
			durationMs: input.durationMs,
			promptPartTokenEstimates: {
				systemPromptTokens: estimateTokens(input.systemContext),
				userPromptTokens: estimateTokens(JSON.stringify(input.messages)),
			},
			trace: missionPilotThoughtTrace({
				sessionId: input.sessionId,
				callId,
			}),
			metadataJson: {
				role: "mission_pilot",
				missionPilotSessionId: input.sessionId,
				turnId: input.turnId,
				providerCallIndex: input.providerCallIndex,
				callKind: input.label,
			},
		});
		return true;
	} catch (error) {
		logEvent({
			channel: "mission-pilot-provider-usage",
			level: "error",
			message:
				"Mission Pilot provider response was preserved, but usage persistence failed.",
			meta: {
				sessionId: input.sessionId,
				taskId: input.taskId,
				turnId: input.turnId,
				callId,
				errorMessage: error instanceof Error ? error.message : String(error),
			},
		});
		return false;
	}
}
