import { describe, expect, it } from "vitest";
import {
	buildEvidenceBindingDigest,
	compareEvidenceSubject,
	type EvidenceSubjectBinding,
} from "../api/modules/agentsShare";

function subject(
	overrides: Partial<EvidenceSubjectBinding> = {},
): EvidenceSubjectBinding {
	return {
		id: "subject-1",
		version: 1,
		bindingStatus: "canonical",
		taskId: "task-1",
		taskRevisionSnapshotId: "revision-1",
		taskRevision: 1,
		taskDigest: "task-digest",
		implementationRunId: "run-1",
		workspaceId: "workspace-1",
		workspaceAllocationVersion: 1,
		repositoryIdentityRevision: 1,
		admissionAttestationId: "attestation-1",
		admissionAttestationDigest: "sha256:attestation",
		admittedHeadSha: "head-1",
		baseHead: "base-1",
		sourceStateHash: "source-1",
		diffDigest: "diff-1",
		verificationDocumentId: "document-1",
		verificationDocumentDigest: "document-digest-1",
		bindingDigest: "binding-1",
		createdAt: "2026-07-29T00:00:00.000Z",
		...overrides,
	};
}

describe("Evidence Subject freshness", () => {
	it("invalidates evidence after a diff/source change", () => {
		expect(
			compareEvidenceSubject({
				evidence: subject(),
				current: subject({
					id: "subject-2",
					sourceStateHash: "source-2",
					diffDigest: "diff-2",
				}),
			}),
		).toEqual({
			status: "stale",
			reasons: ["source_state_changed", "diff_changed"],
		});
	});

	it("treats another Run's evidence as foreign", () => {
		expect(
			compareEvidenceSubject({
				evidence: subject({ implementationRunId: "run-old" }),
				current: subject(),
			}),
		).toEqual({
			status: "foreign",
			reasons: ["implementation_run_mismatch"],
		});
	});

	it("builds the same digest regardless of object key insertion order", () => {
		const current = subject();
		const {
			id: _id,
			bindingDigest: _binding,
			createdAt: _created,
			...value
		} = current;
		expect(buildEvidenceBindingDigest(value)).toBe(
			buildEvidenceBindingDigest({ ...value }),
		);
	});
});
