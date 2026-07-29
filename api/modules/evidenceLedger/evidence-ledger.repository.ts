import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { evidenceSubjectSnapshots } from "../../db/evidence-ledger-schema";
import type {
	EvidenceSubjectBinding,
	EvidenceSubjectComparable,
} from "../agentsShare";

export async function findEvidenceSubjectByBindingDigest(
	bindingDigest: string,
) {
	const [row] = await db
		.select()
		.from(evidenceSubjectSnapshots)
		.where(eq(evidenceSubjectSnapshots.bindingDigest, bindingDigest));
	return row ? mapEvidenceSubject(row) : null;
}

export async function getEvidenceSubject(id: string) {
	const [row] = await db
		.select()
		.from(evidenceSubjectSnapshots)
		.where(eq(evidenceSubjectSnapshots.id, id));
	return row ? mapEvidenceSubject(row) : null;
}

export async function createEvidenceSubject(
	subject: EvidenceSubjectComparable & { bindingDigest: string },
) {
	const [row] = await db
		.insert(evidenceSubjectSnapshots)
		.values({
			version: subject.version,
			bindingStatus: subject.bindingStatus,
			taskId: subject.taskId,
			taskRevisionSnapshotId: subject.taskRevisionSnapshotId,
			taskRevision: subject.taskRevision,
			taskDigest: subject.taskDigest,
			implementationRunId: subject.implementationRunId,
			workspaceId: subject.workspaceId,
			workspaceAllocationVersion: subject.workspaceAllocationVersion,
			repositoryIdentityRevision: subject.repositoryIdentityRevision,
			admissionAttestationId: subject.admissionAttestationId,
			admissionAttestationDigest: subject.admissionAttestationDigest,
			admittedHeadSha: subject.admittedHeadSha,
			baseHead: subject.baseHead,
			sourceStateHash: subject.sourceStateHash,
			diffDigest: subject.diffDigest,
			verificationDocumentId: subject.verificationDocumentId,
			verificationDocumentDigest: subject.verificationDocumentDigest,
			bindingDigest: subject.bindingDigest,
		})
		.onConflictDoNothing({
			target: evidenceSubjectSnapshots.bindingDigest,
		})
		.returning();
	if (row) return mapEvidenceSubject(row);
	const existing = await findEvidenceSubjectByBindingDigest(
		subject.bindingDigest,
	);
	if (!existing) throw new Error("Failed to create Evidence Subject");
	return existing;
}

function mapEvidenceSubject(
	row: typeof evidenceSubjectSnapshots.$inferSelect,
): EvidenceSubjectBinding {
	return {
		id: row.id,
		version: 1,
		bindingStatus:
			row.bindingStatus === "canonical" ? "canonical" : "legacy_unbound",
		taskId: row.taskId,
		taskRevisionSnapshotId: row.taskRevisionSnapshotId,
		taskRevision: row.taskRevision,
		taskDigest: row.taskDigest,
		implementationRunId: row.implementationRunId,
		workspaceId: row.workspaceId,
		workspaceAllocationVersion: row.workspaceAllocationVersion,
		repositoryIdentityRevision: row.repositoryIdentityRevision,
		admissionAttestationId: row.admissionAttestationId,
		admissionAttestationDigest: row.admissionAttestationDigest,
		admittedHeadSha: row.admittedHeadSha,
		baseHead: row.baseHead,
		sourceStateHash: row.sourceStateHash,
		diffDigest: row.diffDigest,
		verificationDocumentId: row.verificationDocumentId,
		verificationDocumentDigest: row.verificationDocumentDigest,
		bindingDigest: row.bindingDigest,
		createdAt: row.createdAt.toISOString(),
	};
}
