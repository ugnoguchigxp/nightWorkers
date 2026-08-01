export type VerificationEvidenceFreshness = "current" | "stale" | "unverified";

export type VerificationEvidenceStaleReason =
	| "code_changed"
	| "later_verification_failed";

export type VerificationEvidenceObservation = {
	id: string;
	occurredAt?: unknown;
	kind: "code_change" | "verification";
	verification?: {
		state: "running" | "passed" | "failed" | "needs_action" | "unknown";
		full: boolean;
		affectsFreshness?: boolean;
	};
};

export type VerificationEvidenceHistoryContext = {
	lastFullPass: {
		eventId: string;
		occurredAt?: unknown;
	} | null;
	freshness: VerificationEvidenceFreshness;
	staleReason: VerificationEvidenceStaleReason | null;
};

export function buildVerificationEvidenceHistory(
	observations: VerificationEvidenceObservation[],
): Map<string, VerificationEvidenceHistoryContext> {
	const contexts = new Map<string, VerificationEvidenceHistoryContext>();
	let lastFullPass: VerificationEvidenceHistoryContext["lastFullPass"] = null;
	let staleReason: VerificationEvidenceStaleReason | null = null;

	for (const observation of observations) {
		if (observation.kind === "code_change") {
			if (lastFullPass) staleReason = "code_changed";
			continue;
		}

		const verification = observation.verification;
		if (!verification || verification.state === "running") continue;

		if (verification.full && verification.state === "passed") {
			lastFullPass = {
				eventId: observation.id,
				occurredAt: observation.occurredAt,
			};
			staleReason = null;
		} else if (
			lastFullPass &&
			verification.affectsFreshness !== false &&
			verification.state === "failed"
		) {
			staleReason = "later_verification_failed";
		}

		contexts.set(observation.id, {
			lastFullPass,
			freshness: lastFullPass
				? staleReason
					? "stale"
					: "current"
				: "unverified",
			staleReason,
		});
	}

	return contexts;
}
