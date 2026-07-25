import { and, eq } from "drizzle-orm";
import { isVerificationChecklistItemComplete } from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import {
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";

export async function getEvidenceCheckSnapshot(input: {
	taskId: string;
	verificationDocumentId: string;
}) {
	const [document] = await db
		.select()
		.from(verificationDocuments)
		.where(
			and(
				eq(verificationDocuments.id, input.verificationDocumentId),
				eq(verificationDocuments.taskId, input.taskId),
				eq(verificationDocuments.status, "active"),
			),
		)
		.limit(1);
	if (!document) return null;
	const rows = await db
		.select()
		.from(verificationChecklistItems)
		.where(eq(verificationChecklistItems.verificationDocumentId, document.id))
		.orderBy(verificationChecklistItems.conditionId);
	const conditions = rows.map((row) => ({
		id: row.conditionId,
		text: row.text,
		status: row.status,
		required: row.required,
		evidenceIds: row.evidenceIdsJson,
		reason: row.reason,
		lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
	}));
	const confirmed = rows.filter((row) =>
		isVerificationChecklistItemComplete({
			required: row.required,
			status: row.status,
		}),
	).length;
	const failed = rows.filter((row) => row.status === "failed").length;
	return {
		taskId: input.taskId,
		verificationDocumentId: document.id,
		specMessageId: document.specMessageId,
		specArtifactId: document.specArtifactId,
		generatedAt: document.generatedAt.toISOString(),
		conditions,
		summary: {
			total: rows.length,
			confirmed,
			failed,
			pending: Math.max(0, rows.length - confirmed - failed),
		},
	};
}
