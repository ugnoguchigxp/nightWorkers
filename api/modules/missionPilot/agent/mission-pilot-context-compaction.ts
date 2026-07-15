import type {
	ProviderToolDefinition,
	ProviderToolMessage,
} from "../../../services/structured-llm/public";
import {
	boundMissionPilotCompactionInput,
	estimateMissionPilotProviderRequestTokens,
} from "./mission-pilot-context-envelope";

export const MISSION_PILOT_COMPACTION_SYSTEM_CONTEXT = `
Mission Pilotの永続conversationを、次のturnで判断を継続できる日本語の要約へ圧縮してください。
ユーザーの依頼、採用済み判断、実行済みactionと結果、未解決事項、Specification・Artifact・Run outcomeの正本参照、digest、paging cursorを保持してください。
workerのreasoning、tool call履歴、stdout/stderr、token streamは要約へ入れないでください。本文を固定診断文へ置き換えず、正本参照を失わないでください。
`.trim();

export function shouldCompactMissionPilotContext(input: {
	systemContext: string;
	messages: ProviderToolMessage[];
	tools: ProviderToolDefinition[];
	softTokenBudget: number;
}) {
	return (
		estimateMissionPilotProviderRequestTokens(input) > input.softTokenBudget
	);
}

export function buildMissionPilotCompactionRequest(
	messages: ProviderToolMessage[],
	maxBytes = 240_000,
) {
	return boundMissionPilotCompactionInput(messages, maxBytes);
}
