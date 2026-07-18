import type { NativeApiToolResult } from "./native-api-tool-history";

export type NativeApiDispatchState = {
	readFiles: string[];
	postImport?: NativeApiPostImportState | null;
};

export type NativeApiPostImportState = {
	toolCallId: string;
	mode: "template" | "git";
	templateId?: string | null;
	variant?: string | null;
	manifest?: unknown;
	llmContext?: unknown;
	recommendedVerificationCommands: string[];
};

export type NativeApiDispatchResult = {
	kind: "continue";
	toolResult: NativeApiToolResult;
	state: NativeApiDispatchState;
};
