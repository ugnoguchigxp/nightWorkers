import { contentDigest } from "./utf8-content-page";

export type EvidenceBindingStatus = "canonical" | "legacy_unbound";

export type EvidenceSubjectBinding = {
	id: string;
	version: 1;
	bindingStatus: EvidenceBindingStatus;
	taskId: string;
	taskRevisionSnapshotId: string;
	taskRevision: number;
	taskDigest: string;
	implementationRunId: string;
	workspaceId: string | null;
	workspaceAllocationVersion: number | null;
	repositoryIdentityRevision: number | null;
	admissionAttestationId: string | null;
	admissionAttestationDigest: string | null;
	admittedHeadSha: string | null;
	baseHead: string | null;
	sourceStateHash: string;
	diffDigest: string;
	verificationDocumentId: string | null;
	verificationDocumentDigest: string | null;
	bindingDigest: string;
	createdAt: string;
};

export type EvidenceFreshness =
	| { status: "current"; reasons: [] }
	| { status: "stale"; reasons: string[] }
	| { status: "foreign"; reasons: string[] }
	| { status: "failed"; reasons: string[] }
	| { status: "missing"; reasons: string[] };

export type EvidenceSubjectComparable = Omit<
	EvidenceSubjectBinding,
	"id" | "bindingDigest" | "createdAt"
>;

export function canonicalJson(value: unknown): string {
	return JSON.stringify(sortValue(value));
}

export function canonicalDigest(value: unknown): string {
	return contentDigest(canonicalJson(value));
}

export function buildEvidenceBindingDigest(
	input: EvidenceSubjectComparable,
): string {
	return canonicalDigest(input);
}

export function compareEvidenceSubject(input: {
	evidence: EvidenceSubjectBinding | null;
	current: EvidenceSubjectBinding | null;
	resultPassed?: boolean;
}): EvidenceFreshness {
	if (!input.evidence || !input.current)
		return { status: "missing", reasons: ["evidence_subject_missing"] };
	if (input.resultPassed === false)
		return { status: "failed", reasons: ["evidence_result_failed"] };

	const foreignReasons: string[] = [];
	if (input.evidence.taskId !== input.current.taskId)
		foreignReasons.push("task_mismatch");
	if (input.evidence.implementationRunId !== input.current.implementationRunId)
		foreignReasons.push("implementation_run_mismatch");
	if (input.evidence.workspaceId !== input.current.workspaceId)
		foreignReasons.push("workspace_mismatch");
	if (foreignReasons.length > 0)
		return { status: "foreign", reasons: foreignReasons };

	const staleReasons: string[] = [];
	if (
		input.evidence.taskRevisionSnapshotId !==
			input.current.taskRevisionSnapshotId ||
		input.evidence.taskDigest !== input.current.taskDigest
	)
		staleReasons.push("task_revision_changed");
	if (
		input.evidence.workspaceAllocationVersion !==
		input.current.workspaceAllocationVersion
	)
		staleReasons.push("workspace_allocation_changed");
	if (
		input.evidence.repositoryIdentityRevision !==
		input.current.repositoryIdentityRevision
	)
		staleReasons.push("repository_identity_changed");
	if (
		input.evidence.admissionAttestationId !==
			input.current.admissionAttestationId ||
		input.evidence.admissionAttestationDigest !==
			input.current.admissionAttestationDigest
	)
		staleReasons.push("workspace_attestation_changed");
	if (input.evidence.admittedHeadSha !== input.current.admittedHeadSha)
		staleReasons.push("admitted_head_changed");
	if (input.evidence.baseHead !== input.current.baseHead)
		staleReasons.push("base_head_changed");
	if (input.evidence.sourceStateHash !== input.current.sourceStateHash)
		staleReasons.push("source_state_changed");
	if (input.evidence.diffDigest !== input.current.diffDigest)
		staleReasons.push("diff_changed");
	if (
		input.evidence.verificationDocumentId !==
			input.current.verificationDocumentId ||
		input.evidence.verificationDocumentDigest !==
			input.current.verificationDocumentDigest
	)
		staleReasons.push("verification_document_changed");
	if (
		input.evidence.bindingStatus !== "canonical" ||
		input.current.bindingStatus !== "canonical"
	)
		staleReasons.push("legacy_binding");
	if (staleReasons.length > 0)
		return { status: "stale", reasons: staleReasons };
	return { status: "current", reasons: [] };
}

function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => [key, sortValue(entry)]),
	);
}
