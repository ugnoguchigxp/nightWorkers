export type RunControlPhase = "active" | "recovery" | "closeout" | "terminal";

export type RunTerminalReason =
	| "completed"
	| "blocked"
	| "cancelled"
	| "needs_human"
	| "runtime_failed";

export type TransportStatus = "completed" | "failed" | "cancelled";

export type DomainOutcome =
	| "succeeded"
	| "failed"
	| "blocked"
	| "no_change"
	| "unknown";

export type RunEffect =
	| "observation"
	| "workspace_mutation"
	| "workflow_mutation"
	| "verification"
	| "external_mutation"
	| "none"
	| "unknown";

export type EffectConfidence = "declared" | "observed" | "inferred" | "unknown";

export interface RunControlState {
	version: 1;
	runId: string;
	phase: RunControlPhase;
	progressRevision: number;
	workspaceRevision: number;
	workflowRevision: number;
	todoRevision: number;
	evidenceRevision: number;
	contextEpoch: number;
	lastMutationSequence: number | null;
	lastEvidenceSequence: number | null;
	consecutiveNoProgressTurns: number;
	terminalReason: RunTerminalReason | null;
	stateVersion: number;
}

export interface ToolOutcomeEnvelope {
	version: 1;
	runId: string;
	toolName: string;
	invocationId: string;
	actionKey: string;
	transportStatus: TransportStatus;
	domainOutcome: DomainOutcome;
	effect: RunEffect;
	effectConfidence: EffectConfidence;
	progressRevisionBefore: number;
	progressRevisionAfter: number;
	invocationDigest: string;
	resultDigest: string;
	evidenceRefs: string[];
	artifactRefs: string[];
	retryPolicy: "immediate" | "after_progress" | "never";
	modelView: unknown;
}

export interface PreparedRunAction {
	id: string;
	runId: string;
	sequence: number;
	toolName: string;
	actionKey: string;
	normalizedArgsDigest: string;
	progressRevision: number;
	dedupeRevision: number;
	effect: RunEffect;
}

export interface ReusableRunAction {
	id: string;
	runId: string;
	toolName: string;
	actionKey: string;
	progressRevision: number;
	dedupeRevision: number;
	transportStatus: TransportStatus;
	domainOutcome: DomainOutcome;
	effect: RunEffect;
	resultDigest: string;
	evidenceRefs: string[];
	artifactRefs: string[];
	modelView: unknown;
	repeatCount: number;
}

export type PrepareRunActionResult =
	| { kind: "execute"; state: RunControlState; action: PreparedRunAction }
	| { kind: "reuse"; state: RunControlState; action: ReusableRunAction }
	| { kind: "terminal"; state: RunControlState };

export function createInitialRunControlState(runId: string): RunControlState {
	return {
		version: 1,
		runId,
		phase: "active",
		progressRevision: 0,
		workspaceRevision: 0,
		workflowRevision: 0,
		todoRevision: 0,
		evidenceRevision: 0,
		contextEpoch: 0,
		lastMutationSequence: null,
		lastEvidenceSequence: null,
		consecutiveNoProgressTurns: 0,
		terminalReason: null,
		stateVersion: 0,
	};
}
