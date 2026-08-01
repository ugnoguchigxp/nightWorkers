import { and, desc, eq, inArray } from "drizzle-orm";
import type {
	ExpectedEvidence,
	NormalizedVerificationEvidence,
	SpecificationVerificationDocument,
	VerificationChecklistItem,
} from "../../../shared/schemas/verification-checklist.schema";
import { db } from "../../db/client";
import { taskMessages } from "../../db/schema";
import {
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../../db/verification-schema";
import { AppError } from "../../lib/errors";
import { canonicalDigest } from "../agentsShare";

export async function createVerificationDocument(input: {
	taskId: string;
	runId?: string | null;
	specMessageId?: string | null;
	specArtifactId?: string | null;
	verificationArtifactId?: string | null;
	sourceSpecPath: string;
	document: SpecificationVerificationDocument;
}) {
	const checklistRows = input.document.conditions.map((condition) => ({
		condition,
	}));
	return db.transaction(async (tx) => {
		await tx
			.update(verificationDocuments)
			.set({ status: "superseded", updatedAt: new Date() })
			.where(
				and(
					eq(verificationDocuments.taskId, input.taskId),
					eq(verificationDocuments.status, "active"),
				),
			);
		const [document] = await tx
			.insert(verificationDocuments)
			.values({
				taskId: input.taskId,
				runId: input.runId ?? null,
				specMessageId: input.specMessageId ?? null,
				specArtifactId: input.specArtifactId ?? null,
				verificationArtifactId: input.verificationArtifactId ?? null,
				sourceSpecPath: input.sourceSpecPath,
				schemaVersion: input.document.version,
				status: "active",
				documentJson: input.document as unknown as Record<string, unknown>,
				generatedAt: new Date(input.document.generatedAt),
			})
			.returning();
		if (!document) throw new Error("Failed to create verification document");
		if (checklistRows.length > 0) {
			await tx.insert(verificationChecklistItems).values(
				checklistRows.map(({ condition }) => ({
					verificationDocumentId: document.id,
					taskId: input.taskId,
					conditionId: condition.id,
					text: condition.text,
					required: condition.required,
					verificationKind: condition.verificationKind,
					expectedEvidenceJson: condition.expectedEvidence,
					status:
						condition.verificationKind === "not_applicable"
							? "not_applicable"
							: "pending",
					evidenceIdsJson: [],
					reason:
						condition.verificationKind === "manual"
							? "manual verification の確認証跡が必要です。"
							: condition.verificationKind === "not_applicable"
								? "自動検証対象外です。"
								: null,
				})),
			);
		}
		return document;
	});
}

export async function getVerificationSourceMessage(id: string) {
	const [message] = await db
		.select({ id: taskMessages.id, taskId: taskMessages.taskId })
		.from(taskMessages)
		.where(eq(taskMessages.id, id));
	return message ?? null;
}

export async function getLatestVerificationDocumentForTask(taskId: string) {
	const [document] = await db
		.select()
		.from(verificationDocuments)
		.where(eq(verificationDocuments.taskId, taskId))
		.orderBy(desc(verificationDocuments.createdAt))
		.limit(1);
	return document ?? null;
}

export async function getLatestActiveVerificationDocumentForTask(
	taskId: string,
) {
	const [document] = await db
		.select()
		.from(verificationDocuments)
		.where(
			and(
				eq(verificationDocuments.taskId, taskId),
				eq(verificationDocuments.status, "active"),
			),
		)
		.orderBy(desc(verificationDocuments.createdAt))
		.limit(1);
	return document ?? null;
}

export async function getVerificationDocument(id: string) {
	const [document] = await db
		.select()
		.from(verificationDocuments)
		.where(eq(verificationDocuments.id, id));
	return document ?? null;
}

export async function listVerificationChecklistItems(
	verificationDocumentId: string,
): Promise<VerificationChecklistItem[]> {
	const rows = await db
		.select()
		.from(verificationChecklistItems)
		.where(
			eq(
				verificationChecklistItems.verificationDocumentId,
				verificationDocumentId,
			),
		)
		.orderBy(verificationChecklistItems.conditionId);
	return rows.map((row) => ({
		id: row.id,
		conditionId: row.conditionId,
		text: row.text,
		required: row.required,
		verificationKind:
			row.verificationKind as VerificationChecklistItem["verificationKind"],
		expectedEvidence: Array.isArray(row.expectedEvidenceJson)
			? (row.expectedEvidenceJson as ExpectedEvidence[])
			: [],
		status: row.status as VerificationChecklistItem["status"],
		evidenceIds: Array.isArray(row.evidenceIdsJson) ? row.evidenceIdsJson : [],
		lastCheckedAt: row.lastCheckedAt?.toISOString(),
		reason: row.reason ?? undefined,
	}));
}

export async function updateVerificationChecklistItems(
	verificationDocumentId: string,
	items: VerificationChecklistItem[],
) {
	for (const item of items) {
		await db
			.update(verificationChecklistItems)
			.set({
				status: item.status,
				evidenceIdsJson: item.evidenceIds,
				reason: item.reason ?? null,
				lastCheckedAt: item.lastCheckedAt
					? new Date(item.lastCheckedAt)
					: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(
						verificationChecklistItems.verificationDocumentId,
						verificationDocumentId,
					),
					eq(verificationChecklistItems.conditionId, item.conditionId),
				),
			);
	}
}

export async function createVerificationEvidenceRun(input: {
	taskId: string;
	runId?: string | null;
	verificationDocumentId?: string | null;
	subjectId?: string | null;
	checkKind: string;
	evidence: NormalizedVerificationEvidence;
}) {
	const values = {
		id: input.evidence.id,
		taskId: input.taskId,
		runId: input.runId ?? null,
		verificationDocumentId: input.verificationDocumentId ?? null,
		subjectId: input.subjectId ?? null,
		checkKind: input.checkKind,
		command: input.evidence.command,
		cwd: input.evidence.cwd,
		exitCode: input.evidence.exitCode,
		runner: input.evidence.runner,
		rawStdoutArtifactId: input.evidence.rawStdoutArtifactId,
		rawStderrArtifactId: input.evidence.rawStderrArtifactId,
		parsedArtifactId: input.evidence.parsedArtifactId ?? null,
		summaryJson: input.evidence.summary,
		evidenceKindsJson: input.evidence.evidenceKinds ?? [],
		commandLevelConditionIdsJson: input.evidence.commandLevelConditionIds,
		sourceSnapshotJson: input.evidence.sourceSnapshot ?? null,
		testExecutionObserved: input.evidence.testExecutionObserved ?? false,
		sourceMutatedDuringCheck: input.evidence.sourceMutatedDuringCheck ?? false,
		startedAt: new Date(input.evidence.startedAt),
		finishedAt: new Date(input.evidence.finishedAt),
	};
	return db.transaction(async (tx) => {
		const [created] = await tx
			.insert(verificationEvidenceRuns)
			.values(values)
			.onConflictDoNothing({ target: verificationEvidenceRuns.id })
			.returning();
		if (!created) {
			const [existing] = await tx
				.select()
				.from(verificationEvidenceRuns)
				.where(eq(verificationEvidenceRuns.id, input.evidence.id));
			if (!existing)
				throw new Error("Failed to read existing verification evidence run");
			if (
				verificationEvidenceIdentity(existing) !==
				verificationEvidenceIdentity(values)
			) {
				throw new AppError(
					409,
					"verification_evidence_conflict",
					"Verification Evidence ID is already bound to different evidence.",
				);
			}
			return existing;
		}
		if (input.evidence.cases.length > 0) {
			await tx.insert(verificationEvidenceCases).values(
				input.evidence.cases.map((testCase) => ({
					evidenceRunId: created.id,
					verificationDocumentId: input.verificationDocumentId ?? null,
					conditionIdsJson: testCase.conditionIds,
					caseKey: testCase.caseKey ?? null,
					name: testCase.name,
					filePath: testCase.filePath ?? null,
					runner: testCase.runner ?? input.evidence.runner,
					evidenceKind: testCase.evidenceKind ?? null,
					status: testCase.status,
					durationMs: testCase.durationMs ?? null,
					failureMessage: testCase.failureMessage ?? null,
				})),
			);
		}
		return created;
	});
}

function verificationEvidenceIdentity(
	value: Pick<
		typeof verificationEvidenceRuns.$inferSelect,
		| "id"
		| "taskId"
		| "runId"
		| "verificationDocumentId"
		| "subjectId"
		| "checkKind"
		| "command"
		| "cwd"
		| "exitCode"
		| "runner"
		| "rawStdoutArtifactId"
		| "rawStderrArtifactId"
		| "parsedArtifactId"
		| "summaryJson"
		| "evidenceKindsJson"
		| "commandLevelConditionIdsJson"
		| "sourceSnapshotJson"
		| "testExecutionObserved"
		| "sourceMutatedDuringCheck"
		| "startedAt"
		| "finishedAt"
	>,
) {
	return canonicalDigest({
		id: value.id,
		taskId: value.taskId,
		runId: value.runId,
		verificationDocumentId: value.verificationDocumentId,
		subjectId: value.subjectId,
		checkKind: value.checkKind,
		command: value.command,
		cwd: value.cwd,
		exitCode: value.exitCode,
		runner: value.runner,
		rawStdoutArtifactId: value.rawStdoutArtifactId,
		rawStderrArtifactId: value.rawStderrArtifactId,
		parsedArtifactId: value.parsedArtifactId,
		summaryJson: value.summaryJson,
		evidenceKindsJson: value.evidenceKindsJson,
		commandLevelConditionIdsJson: value.commandLevelConditionIdsJson,
		sourceSnapshotJson: value.sourceSnapshotJson,
		testExecutionObserved: value.testExecutionObserved,
		sourceMutatedDuringCheck: value.sourceMutatedDuringCheck,
		startedAt: value.startedAt.toISOString(),
		finishedAt: value.finishedAt.toISOString(),
	});
}

export async function listVerificationEvidenceRuns(ids: string[]) {
	if (ids.length === 0) return [];
	return db
		.select()
		.from(verificationEvidenceRuns)
		.where(inArray(verificationEvidenceRuns.id, ids));
}

export async function listVerificationEvidenceRunsForTask(taskId: string) {
	return db
		.select()
		.from(verificationEvidenceRuns)
		.where(eq(verificationEvidenceRuns.taskId, taskId));
}
