import type { SecurityFinalJudgmentV1 } from "../../../../../shared/schemas/security-intelligence-runtime.schema";

export type RuntimeLaneKind =
	| "native-local"
	| "codex-agent"
	| "external-process"
	| "future-adapter";

export type RuntimeContractWarningSeverity = "info" | "warning" | "error";

export interface RuntimeContractWarning {
	code: string;
	severity: RuntimeContractWarningSeverity;
	message: string;
	providerItemId?: string | null;
	providerStateId?: string | null;
	rawError?: string | null;
	toolName?: string | null;
	todoId?: string | null;
	todoSeq?: number | null;
	changedFiles?: string[];
	command?: string | null;
	todoEvidenceSource?: "db" | "context" | "none";
	sequence?: number;
	occurredAt?: string;
	count?: number;
}

type RuntimeEventPayload = unknown;

export type RuntimeLaneEvent =
	| { type: "runtime_started"; message: string; payload?: RuntimeEventPayload }
	| { type: "turn_started"; message: string; payload?: RuntimeEventPayload }
	| { type: "turn_finished"; message: string; payload?: RuntimeEventPayload }
	| {
			type: "model_response_started";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "model_response_failed";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "model_response_delta";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "model_response_finished";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "model_response_parse_failed";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "model_response_repaired";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "model_retry_scheduled";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "model_retry_started";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "supervisor_decision";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "tool_call_started";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "tool_call_progress";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "tool_call_finished";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "verification_started";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| {
			type: "verification_finished";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| { type: "diff_collected"; message: string; payload?: RuntimeEventPayload }
	| { type: "runtime_finished"; message: string; payload?: RuntimeEventPayload }
	| {
			type: "runtime_warning";
			message: string;
			payload?: RuntimeEventPayload;
	  }
	| { type: "runtime_error"; message: string; payload?: RuntimeEventPayload };

export interface RuntimeLaneSink {
	emit(event: RuntimeLaneEvent): Promise<void>;
}

export interface RuntimeLaneResult {
	terminalState:
		| "completed"
		| "needs_review"
		| "needs_human"
		| "failed"
		| "timed_out"
		| "blocked"
		| "cancelled";
	summary: string;
	finalReport: string;
	stoppedBy:
		| "decision"
		| "budget"
		| "tool_failure"
		| "llm_error"
		| "missing_tool_call"
		| "policy"
		| "hook"
		| "cancelled";
	riskLevel: "low" | "medium" | "high";
	humanActionRequired?: boolean;
	logContent?: string;
	diffPatch?: string;
	testResults?: unknown;
	usage?: unknown;
	contractWarnings?: RuntimeContractWarning[];
	securityFinalJudgment?: SecurityFinalJudgmentV1;
}
