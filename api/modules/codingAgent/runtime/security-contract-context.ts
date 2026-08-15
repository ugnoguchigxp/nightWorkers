import { createHash } from "node:crypto";
import type { JsonValue } from "s11tnext";
import type { AgentRunContext } from "./types";

const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_ARRAY_ITEMS = 50;

export function formatSecurityContractContextForPrompt(
	context: AgentRunContext,
): JsonValue | undefined {
	const source = context.contextSnapshot.securityContractContext;
	if (!source || typeof source !== "object" || Array.isArray(source)) {
		return undefined;
	}
	const serialized = JSON.stringify(source);
	if (Buffer.byteLength(serialized, "utf8") <= MAX_PROMPT_BYTES) {
		return JSON.parse(serialized) as JsonValue;
	}
	const record = source as Record<string, unknown>;
	const contract = asRecord(record.securityContract);
	return JSON.parse(
		JSON.stringify({
			available: true,
			compacted: true,
			fullSnapshotDigest: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
			fullSnapshotBytes: Buffer.byteLength(serialized, "utf8"),
			canonicalQuery: {
				taskRevisionSnapshotId: contract?.taskRevisionSnapshotId ?? null,
				securityContractRef: contract?.contractRef ?? null,
			},
			securityContract: contract
				? {
						version: contract.version,
						contractRef: contract.contractRef,
						contractDigest: contract.contractDigest,
						contractRevision: contract.contractRevision,
						taskRevisionSnapshotId: contract.taskRevisionSnapshotId,
						projectRef: contract.projectRef,
						sourceState: contract.sourceState,
						affectedAssets: compactArray(contract.affectedAssets),
						declaredInvariantRefs: compactArray(contract.declaredInvariantRefs),
						knowledgeRefs: compactArray(contract.knowledgeRefs),
						assessmentSubjectBindingRefs: compactArray(
							contract.assessmentSubjectBindingRefs,
						),
						requiredBaselineVerificationRefs: compactArray(
							contract.requiredBaselineVerificationRefs,
						),
						targetedVerificationCandidateRefs: compactArray(
							contract.targetedVerificationCandidateRefs,
						),
						unknowns: compactArray(contract.unknowns),
					}
				: null,
			adoptedCompletionConditions: compactArray(
				record.adoptedCompletionConditions,
			),
			assessmentSubjectBindings: compactArray(record.assessmentSubjectBindings),
			assessmentAttempts: compactArray(record.assessmentAttempts),
			assessmentSummaries: compactArray(record.assessmentSummaries),
		}),
	) as JsonValue;
}

function compactArray(value: unknown) {
	if (!Array.isArray(value)) return value ?? [];
	if (value.length <= MAX_ARRAY_ITEMS) return value;
	return {
		items: value.slice(0, MAX_ARRAY_ITEMS),
		itemCount: value.length,
		omittedCount: value.length - MAX_ARRAY_ITEMS,
		digest: `sha256:${createHash("sha256")
			.update(JSON.stringify(value))
			.digest("hex")}`,
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
