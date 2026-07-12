import type { PromptImageAttachment } from "../../../shared/prompt-image";
import type { NormalizedLlmUsage } from "../llm-usage/types";
import type {
	CallSupervisorOptions,
	NormalizedSupervisorLlmRequest,
} from "./types";

export type ProviderToolDefinition = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

export type ProviderToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};

export type ProviderToolChoice =
	| "auto"
	| "required"
	| {
			type: "function";
			function: { name: string };
	  };

export type ProviderToolMessage =
	| { role: "system"; content: string }
	| {
			role: "user";
			content:
				| string
				| Array<
						| { type: "text"; text: string }
						| { type: "image"; image: PromptImageAttachment }
				  >;
	  }
	| { role: "assistant"; content: string; toolCalls?: ProviderToolCall[] }
	| { role: "tool"; toolCallId: string; content: string };

export type ProviderToolTurnResult =
	| {
			type: "supported";
			content: string;
			toolCalls: ProviderToolCall[];
			usage: NormalizedLlmUsage;
			model?: string | null;
			providerDebug?: Record<string, unknown>;
	  }
	| {
			type: "unsupported";
			reason: string;
			providerDebug?: Record<string, unknown>;
	  };

export type RawToolTurnCallOptions = Omit<
	CallSupervisorOptions,
	"schemaFirst" | "round"
> & {
	label: string;
	normalizedRequest: NormalizedSupervisorLlmRequest;
	toolChoice?: ProviderToolChoice;
	attemptTimeoutMs?: number;
};
