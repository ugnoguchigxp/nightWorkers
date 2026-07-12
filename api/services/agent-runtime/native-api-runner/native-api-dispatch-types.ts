import type { NativeApiToolResult } from "./native-api-tool-history";

export type NativeApiDispatchState = {
	readFiles: string[];
	specificationRead: boolean;
	specificationReadFromResumeFallback?: boolean;
	initialInstructionsCompleted?: boolean;
	contextCompiled?: boolean;
	todoAligned?: boolean;
	startupCompleted?: boolean;
	newContextWindowRequested?: boolean;
	postImport?: NativeApiPostImportState | null;
	importProjectSucceeded?: boolean;
	importProjectFailed?: boolean;
	copyDirectorySucceeded?: boolean;
	manifestReadAfterImport?: boolean;
	successfulVerificationCommands?: string[];
	compileEvalCompleted?: boolean;
};

export type NativeApiPostImportState = {
	toolCallId: string;
	mode: "template" | "git";
	templateId?: string | null;
	variant?: string | null;
	manifest?: unknown;
	llmContext?: unknown;
	recommendedVerificationCommands: string[];
	verifiedCommand?: string | null;
};

export type NativeApiDispatchResult =
	| {
			kind: "continue";
			toolResult: NativeApiToolResult;
			state: NativeApiDispatchState;
	  }
	| {
			kind: "final";
			toolResult: NativeApiToolResult;
			finalReport: string;
			summary: string;
			state: NativeApiDispatchState;
	  };
