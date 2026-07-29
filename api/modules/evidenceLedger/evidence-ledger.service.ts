import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { taskRevisionSnapshots } from "../../db/schema-base";
import { taskRuns } from "../../db/schema-task-execution";
import { verificationDocuments } from "../../db/verification-schema";
import {
	buildEvidenceBindingDigest,
	canonicalDigest,
	type EvidenceSubjectBinding,
	type EvidenceSubjectComparable,
} from "../agentsShare";
import * as repository from "./evidence-ledger.repository";

export async function bindEvidenceSubject(input: {
	taskId: string;
	runId: string;
	sourceStateHash: string;
	verificationDocumentId?: string | null;
}): Promise<EvidenceSubjectBinding | null> {
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(
			and(eq(taskRuns.id, input.runId), eq(taskRuns.taskId, input.taskId)),
		);
	if (
		!run?.taskRevisionSnapshotId ||
		run.taskRevision === null ||
		!run.taskDigest
	) {
		return null;
	}
	const [revisionSnapshot] = await db
		.select()
		.from(taskRevisionSnapshots)
		.where(eq(taskRevisionSnapshots.id, run.taskRevisionSnapshotId));
	if (
		!revisionSnapshot ||
		revisionSnapshot.taskId !== input.taskId ||
		revisionSnapshot.revision !== run.taskRevision ||
		revisionSnapshot.digest !== run.taskDigest
	) {
		return null;
	}
	const document = input.verificationDocumentId
		? await db
				.select()
				.from(verificationDocuments)
				.where(
					and(
						eq(verificationDocuments.id, input.verificationDocumentId),
						eq(verificationDocuments.taskId, input.taskId),
					),
				)
				.then((rows) => rows[0] ?? null)
		: null;
	if (input.verificationDocumentId && !document) return null;

	const subject: EvidenceSubjectComparable = {
		version: 1,
		bindingStatus: "canonical",
		taskId: input.taskId,
		taskRevisionSnapshotId: revisionSnapshot.id,
		taskRevision: revisionSnapshot.revision,
		taskDigest: revisionSnapshot.digest,
		implementationRunId: run.id,
		workspaceId: run.workspaceId,
		workspaceAllocationVersion: run.workspaceAllocationVersion,
		repositoryIdentityRevision: run.repositoryIdentityRevision,
		admissionAttestationId: run.admissionAttestationId,
		admissionAttestationDigest: run.admissionAttestationDigest,
		admittedHeadSha: run.admittedHeadSha,
		baseHead: run.baseRef,
		sourceStateHash: input.sourceStateHash,
		diffDigest: canonicalDigest({
			baseHead: run.baseRef,
			sourceStateHash: input.sourceStateHash,
		}),
		verificationDocumentId: document?.id ?? null,
		verificationDocumentDigest: document
			? canonicalDigest(document.documentJson)
			: null,
	};
	const bindingDigest = buildEvidenceBindingDigest(subject);
	return repository.createEvidenceSubject({ ...subject, bindingDigest });
}
