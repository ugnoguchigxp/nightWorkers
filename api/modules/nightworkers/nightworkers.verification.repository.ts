import { and, desc, eq, inArray } from "drizzle-orm";
import type {
	ExpectedEvidence,
	NormalizedVerificationEvidence,
	SpecificationVerificationDocument,
	VerificationChecklistItem,
} from "../../../shared/schemas/verification-checklist.schema";
import { db } from "../../db/client";
import {
	verificationChecklistItems,
	verificationDocuments,
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../../db/verification-schema";

export async function createVerificationDocument(input: {
	taskId: string;
	runId?: string | null;
	specMessageId?: string | null;
	specArtifactId?: string | null;
	verificationArtifactId?: string | null;
	sourceSpecPath: string;
	document: SpecificationVerificationDocument;
}) {
	const [document] = await db
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
	const checklistRows = input.document.conditions.map((condition) => ({
		verificationDocumentId: document.id,
		taskId: input.taskId,
		conditionId: condition.id,
		text: condition.text,
		required: condition.required,
		verificationKind: condition.verificationKind,
		expectedEvidenceJson: condition.expectedEvidence,
		status:
			condition.verificationKind === "manual"
				? "manual"
				: condition.verificationKind === "not_applicable"
					? "not_applicable"
					: "pending",
		evidenceIdsJson: [],
		reason:
			condition.verificationKind === "manual"
				? "manual verification が必要です。"
				: condition.verificationKind === "not_applicable"
					? "自動検証対象外です。"
					: null,
	}));
	if (checklistRows.length > 0) {
		await db.insert(verificationChecklistItems).values(checklistRows);
	}
	return document;
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
	checkKind: string;
	evidence: NormalizedVerificationEvidence;
}) {
	const [row] = await db
		.insert(verificationEvidenceRuns)
		.values({
			id: input.evidence.id,
			taskId: input.taskId,
			runId: input.runId ?? null,
			verificationDocumentId: input.verificationDocumentId ?? null,
			checkKind: input.checkKind,
			command: input.evidence.command,
			cwd: input.evidence.cwd,
			exitCode: input.evidence.exitCode,
			runner: input.evidence.runner,
			rawStdoutArtifactId: input.evidence.rawStdoutArtifactId,
			rawStderrArtifactId: input.evidence.rawStderrArtifactId,
			parsedArtifactId: input.evidence.parsedArtifactId ?? null,
			summaryJson: input.evidence.summary,
			commandLevelConditionIdsJson: input.evidence.commandLevelConditionIds,
			sourceSnapshotJson: input.evidence.sourceSnapshot ?? null,
			testExecutionObserved: input.evidence.testExecutionObserved,
			sourceMutatedDuringCheck: input.evidence.sourceMutatedDuringCheck,
			startedAt: new Date(input.evidence.startedAt),
			finishedAt: new Date(input.evidence.finishedAt),
		})
		.onConflictDoUpdate({
			target: verificationEvidenceRuns.id,
			set: {
				updatedAt: new Date(),
				exitCode: input.evidence.exitCode,
				summaryJson: input.evidence.summary,
			},
		})
		.returning();
	if (!row) throw new Error("Failed to create verification evidence run");
	if (input.evidence.cases.length > 0) {
		await db
			.delete(verificationEvidenceCases)
			.where(eq(verificationEvidenceCases.evidenceRunId, row.id));
		await db.insert(verificationEvidenceCases).values(
			input.evidence.cases.map((testCase) => ({
				evidenceRunId: row.id,
				verificationDocumentId: input.verificationDocumentId ?? null,
				conditionIdsJson: testCase.conditionIds,
				name: testCase.name,
				filePath: testCase.filePath ?? null,
				status: testCase.status,
				durationMs: testCase.durationMs ?? null,
				failureMessage: testCase.failureMessage ?? null,
			})),
		);
	}
	return row;
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
