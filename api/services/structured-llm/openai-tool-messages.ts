import fs from "node:fs";
import type { ProviderToolMessage } from "./tool-calls";

export function toOpenAIToolMessages(messages: ProviderToolMessage[]) {
	return messages.map((message) => {
		if (message.role === "assistant") {
			return {
				role: "assistant",
				content: message.content || null,
				...(message.toolCalls?.length
					? {
							tool_calls: message.toolCalls.map((toolCall) => ({
								id: toolCall.id,
								type: "function",
								function: {
									name: toolCall.name,
									arguments: JSON.stringify(toolCall.arguments ?? {}),
								},
							})),
						}
					: {}),
			};
		}
		if (message.role === "tool") {
			return {
				role: "tool",
				tool_call_id: message.toolCallId,
				content: message.content,
			};
		}
		return {
			role: message.role,
			content:
				message.role === "user"
					? toOpenAIUserContent(message.content)
					: message.content,
		};
	});
}

function toOpenAIUserContent(
	content: Extract<ProviderToolMessage, { role: "user" }>["content"],
) {
	if (typeof content === "string") return content;
	return content.map((part) => {
		if (part.type === "text") return part;
		const base64 = fs.readFileSync(part.image.path).toString("base64");
		return {
			type: "image_url",
			image_url: { url: `data:${part.image.mediaType};base64,${base64}` },
		};
	});
}
