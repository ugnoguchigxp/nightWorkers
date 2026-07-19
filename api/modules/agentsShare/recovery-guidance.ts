export type CodingAgentRecoveryObservation = {
	kind: "command" | "tool" | "source" | "event" | "user_reproduction";
	summary: string;
	digest: string;
	rawRef?: string;
};

export type CodingAgentRecoveryRef = {
	kind: "history" | "error" | "source" | "todo" | "candidate";
	digest: string;
	cursor?: string;
	itemCount: number;
};

export type CodingAgentRecoveryGuidance = {
	authoritativeContext: {
		taskId?: string;
		runId?: string;
		repositoryRoot?: string;
		planRevision?: number;
		currentTodoId?: string;
	};
	observations: CodingAgentRecoveryObservation[];
	discrepancies: Array<{
		field: string;
		supplied?: string;
		authoritative?: string;
	}>;
	unresolvedItems: string[];
	recoveryRefs: CodingAgentRecoveryRef[];
	satisfactionConditions: string[];
	intentKey?: string;
	retryArguments?: Record<string, unknown>;
};

export function buildCodingAgentRecoveryGuidance(
	input: CodingAgentRecoveryGuidance,
): CodingAgentRecoveryGuidance {
	return {
		...input,
		authoritativeContext: { ...input.authoritativeContext },
		observations: [...input.observations],
		discrepancies: [...input.discrepancies],
		unresolvedItems: [...input.unresolvedItems],
		recoveryRefs: [...input.recoveryRefs],
		satisfactionConditions: [...input.satisfactionConditions],
		...(input.intentKey ? { intentKey: input.intentKey } : {}),
		...(input.retryArguments
			? { retryArguments: { ...input.retryArguments } }
			: {}),
	};
}
