import type {
	DomainOutcome,
	RunControlState,
	RunEffect,
	RunTerminalReason,
} from "./contracts";

export type RunControlEvent =
	| {
			type: "action_completed";
			sequence: number;
			effect: RunEffect;
			domainOutcome: DomainOutcome;
			evidenceCount: number;
			artifactCount: number;
	  }
	| { type: "no_progress_turn" }
	| { type: "progress_observed"; effect: RunEffect; sequence?: number | null }
	| { type: "enter_closeout" }
	| { type: "finalize_rejected" }
	| { type: "rotate_context" }
	| { type: "terminalize"; reason: RunTerminalReason };

export function reduceRunControlState(
	state: RunControlState,
	event: RunControlEvent,
): RunControlState {
	if (state.phase === "terminal") return state;

	switch (event.type) {
		case "action_completed":
			return applyActionCompleted(state, event);
		case "no_progress_turn": {
			const count = state.consecutiveNoProgressTurns + 1;
			return changed(state, {
				consecutiveNoProgressTurns: count,
				phase: count >= 2 ? "recovery" : state.phase,
			});
		}
		case "progress_observed":
			return applyObservedProgress(state, event.effect, event.sequence ?? null);
		case "enter_closeout":
			return changed(state, { phase: "closeout" });
		case "finalize_rejected":
			return changed(state, {
				phase: "recovery",
				consecutiveNoProgressTurns: Math.max(
					2,
					state.consecutiveNoProgressTurns,
				),
			});
		case "rotate_context":
			return changed(state, { contextEpoch: state.contextEpoch + 1 });
		case "terminalize":
			return changed(state, {
				phase: "terminal",
				terminalReason: event.reason,
				consecutiveNoProgressTurns: 0,
			});
	}
}

function applyActionCompleted(
	state: RunControlState,
	event: Extract<RunControlEvent, { type: "action_completed" }>,
) {
	const evidenceProduced =
		event.evidenceCount > 0 || event.effect === "verification";
	const madeProgress =
		event.domainOutcome === "succeeded" &&
		(event.effect === "workspace_mutation" ||
			event.effect === "workflow_mutation" ||
			event.effect === "external_mutation" ||
			event.effect === "unknown");
	const evidenceProgress =
		evidenceProduced && event.domainOutcome !== "unknown";
	const progressDelta = madeProgress || evidenceProgress ? 1 : 0;
	const usefulObservation =
		event.effect === "observation" && event.domainOutcome === "succeeded";
	return changed(state, {
		phase:
			progressDelta > 0 && state.phase === "recovery" ? "active" : state.phase,
		progressRevision: state.progressRevision + progressDelta,
		workspaceRevision:
			state.workspaceRevision +
			(event.effect === "workspace_mutation" &&
			event.domainOutcome === "succeeded"
				? 1
				: 0),
		workflowRevision:
			state.workflowRevision +
			(event.effect === "workflow_mutation" &&
			event.domainOutcome === "succeeded"
				? 1
				: 0),
		todoRevision:
			state.todoRevision +
			(event.effect === "workflow_mutation" &&
			event.domainOutcome === "succeeded"
				? 1
				: 0),
		evidenceRevision: state.evidenceRevision + (evidenceProduced ? 1 : 0),
		lastMutationSequence: madeProgress
			? event.sequence
			: state.lastMutationSequence,
		lastEvidenceSequence: evidenceProduced
			? event.sequence
			: state.lastEvidenceSequence,
		consecutiveNoProgressTurns:
			progressDelta > 0 || usefulObservation
				? 0
				: state.consecutiveNoProgressTurns + 1,
	});
}

function applyObservedProgress(
	state: RunControlState,
	effect: RunEffect,
	sequence: number | null,
) {
	const workspaceMutation = effect === "workspace_mutation";
	const workflowMutation = effect === "workflow_mutation";
	const evidence = effect === "verification";
	const isProgress = workspaceMutation || workflowMutation || evidence;
	if (!isProgress) return state;
	return changed(state, {
		phase: state.phase === "recovery" ? "active" : state.phase,
		progressRevision: state.progressRevision + 1,
		workspaceRevision: state.workspaceRevision + (workspaceMutation ? 1 : 0),
		workflowRevision: state.workflowRevision + (workflowMutation ? 1 : 0),
		todoRevision: state.todoRevision + (workflowMutation ? 1 : 0),
		evidenceRevision: state.evidenceRevision + (evidence ? 1 : 0),
		lastMutationSequence:
			workspaceMutation || workflowMutation
				? sequence
				: state.lastMutationSequence,
		lastEvidenceSequence: evidence ? sequence : state.lastEvidenceSequence,
		consecutiveNoProgressTurns: 0,
	});
}

function changed(
	state: RunControlState,
	patch: Partial<RunControlState>,
): RunControlState {
	return { ...state, ...patch, stateVersion: state.stateVersion + 1 };
}
