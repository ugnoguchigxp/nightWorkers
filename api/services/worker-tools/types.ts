export type WorkerToolRecoveryDisposition =
	| "retry_same_input"
	| "retry_with_input"
	| "agent_action"
	| "human_input"
	| "host_defect";

export type WorkerToolRecoveryCandidate = {
	toolName: string;
	actionCode: string;
	argsPatch?: Record<string, unknown>;
};

export type WorkerToolRecovery =
	| {
			disposition: "retry_same_input" | "human_input" | "host_defect";
			candidates?: WorkerToolRecoveryCandidate[];
	  }
	| {
			disposition: "retry_with_input" | "agent_action";
			candidates: [
				WorkerToolRecoveryCandidate,
				...WorkerToolRecoveryCandidate[],
			];
	  };

export function isWorkerToolRecovery(
	value: unknown,
): value is WorkerToolRecovery {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const recovery = value as Record<string, unknown>;
	const disposition = recovery.disposition;
	if (!isWorkerToolRecoveryDisposition(disposition)) return false;
	const candidates = recovery.candidates;
	if (candidates === undefined) {
		return disposition !== "retry_with_input" && disposition !== "agent_action";
	}
	if (!Array.isArray(candidates) || !candidates.every(isRecoveryCandidate)) {
		return false;
	}
	return (
		candidates.length > 0 ||
		(disposition !== "retry_with_input" && disposition !== "agent_action")
	);
}

function isWorkerToolRecoveryDisposition(
	value: unknown,
): value is WorkerToolRecoveryDisposition {
	return (
		value === "retry_same_input" ||
		value === "retry_with_input" ||
		value === "agent_action" ||
		value === "human_input" ||
		value === "host_defect"
	);
}

function isRecoveryCandidate(
	value: unknown,
): value is WorkerToolRecoveryCandidate {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.toolName === "string" &&
		candidate.toolName.trim().length > 0 &&
		typeof candidate.actionCode === "string" &&
		candidate.actionCode.trim().length > 0 &&
		(candidate.argsPatch === undefined ||
			(Boolean(candidate.argsPatch) &&
				typeof candidate.argsPatch === "object" &&
				!Array.isArray(candidate.argsPatch)))
	);
}

export type WorkerToolResult<TPayload> = {
	ok: boolean;
	toolName: string;
	startedAt: string;
	finishedAt: string;
	payload: TPayload;
	error?: {
		code: string;
		message: string;
		retryable?: boolean;
		recoveryAction?: string;
		recovery?: WorkerToolRecovery;
		issues?: Array<{
			path: Array<string | number>;
			message: string;
		}>;
	};
	artifactIds?: string[];
};
