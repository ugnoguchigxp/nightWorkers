import { randomUUID } from "node:crypto";
import { jsonFixWrapper } from "./json";
import type {
	ProviderToolCall,
	ProviderToolDefinition,
	ProviderToolMessage,
} from "./tool-calls";

export const CODEX_TOOL_TURN_SCHEMA_NAME = "mission_pilot_tool_turn";

export function buildCodexToolTurnJsonSchema(
	tools: ProviderToolDefinition[],
): Record<string, unknown> {
	const toolNames = [...new Set(tools.map((tool) => tool.name))];
	return {
		type: "object",
		properties: {
			content: { type: "string" },
			toolCalls: {
				type: "array",
				...(toolNames.length === 0 ? { maxItems: 0 } : {}),
				items: {
					type: "object",
					properties: {
						name:
							toolNames.length > 0
								? { type: "string", enum: toolNames }
								: { type: "string" },
						argumentsJson: { type: "string" },
					},
					required: ["name", "argumentsJson"],
					additionalProperties: false,
				},
			},
		},
		required: ["content", "toolCalls"],
		additionalProperties: false,
	};
}

export function buildCodexToolTurnPrompt(input: {
	messages: ProviderToolMessage[];
	tools: ProviderToolDefinition[];
}) {
	return [
		"現在のMission Pilot conversationを読み、次の応答を一度だけ決めてください。",
		"このCodex turnではMCP、command、filesystem、network、その他のtoolを直接実行しないでください。",
		"情報取得または操作が必要なら、下記の利用可能toolをtoolCallsへ出力してください。実行と権限検証はNightWorkersが行います。",
		"toolCalls[].argumentsJsonには、対象toolのinputSchemaに従うJSON objectを文字列として入れてください。",
		"複数toolを同時に要求する必要がなければ、一つだけ返してください。toolが不要ならtoolCallsは空配列にしてください。",
		"contentにはユーザーへ保持すべきassistant本文だけを入れてください。",
		"",
		"## Conversation",
		JSON.stringify(input.messages),
		"",
		"## Available tools",
		JSON.stringify(input.tools),
	].join("\n");
}

export function parseCodexToolTurnResponse(
	raw: string,
):
	| { ok: true; content: string; toolCalls: ProviderToolCall[] }
	| { ok: false; reason: string } {
	const repaired = jsonFixWrapper(raw);
	if (!repaired || !isRecord(repaired.parsedJson))
		return { ok: false, reason: "response must be a JSON object" };
	const envelope = repaired.parsedJson;
	if (typeof envelope.content !== "string")
		return { ok: false, reason: "content must be a string" };
	if (!Array.isArray(envelope.toolCalls))
		return { ok: false, reason: "toolCalls must be an array" };

	const toolCalls: ProviderToolCall[] = [];
	for (const [index, candidate] of envelope.toolCalls.entries()) {
		if (!isRecord(candidate) || typeof candidate.name !== "string")
			return {
				ok: false,
				reason: `toolCalls[${index}].name must be a string`,
			};
		if (typeof candidate.argumentsJson !== "string")
			return {
				ok: false,
				reason: `toolCalls[${index}].argumentsJson must be a string`,
			};
		toolCalls.push({
			id: `codex_call_${randomUUID()}`,
			name: candidate.name,
			arguments: parseArguments(candidate.argumentsJson),
		});
	}
	return { ok: true, content: envelope.content, toolCalls };
}

function parseArguments(raw: string): Record<string, unknown> {
	if (!raw.trim()) return {};
	try {
		const parsed = JSON.parse(raw);
		return isRecord(parsed) ? parsed : { value: parsed };
	} catch {
		return { _raw: raw };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
