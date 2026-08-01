import { and, eq, inArray } from "drizzle-orm";
import type { ExpectedEvidence } from "../../../../shared/schemas/verification-checklist.schema";
import { db } from "../../../db/client";
import { taskRuns } from "../../../db/schema";
import {
	verificationChecklistItems,
	verificationDocuments,
} from "../../../db/verification-schema";
import { AppError } from "../../../lib/errors";
import { isCompatibleEvidenceKind } from "./evidence-kind-compatibility";

export async function validateRunCheckEvidenceScope(input: {
	taskId: string;
	runId?: string;
	verificationDocumentId: string;
	conditionIds: string[];
	evidenceKinds: ExpectedEvidence[];
}) {
	const [document, run] = await Promise.all([
		db
			.select({ id: verificationDocuments.id })
			.from(verificationDocuments)
			.where(
				and(
					eq(verificationDocuments.id, input.verificationDocumentId),
					eq(verificationDocuments.taskId, input.taskId),
					eq(verificationDocuments.status, "active"),
				),
			)
			.then((rows) => rows[0]),
		input.runId
			? db
					.select({ id: taskRuns.id })
					.from(taskRuns)
					.where(
						and(
							eq(taskRuns.id, input.runId),
							eq(taskRuns.taskId, input.taskId),
						),
					)
					.then((rows) => rows[0])
			: Promise.resolve(undefined),
	]);
	if (!document || !run) {
		throw new AppError(
			409,
			"verification_evidence_scope_mismatch",
			"Managed evidence requires an active Verification Document and a Run belonging to the requested Task.",
		);
	}
	if (input.conditionIds.length === 0) return;

	const conditionIds = Array.from(new Set(input.conditionIds));
	const items = await db
		.select({
			conditionId: verificationChecklistItems.conditionId,
			verificationKind: verificationChecklistItems.verificationKind,
			expectedEvidenceJson: verificationChecklistItems.expectedEvidenceJson,
		})
		.from(verificationChecklistItems)
		.where(
			and(
				eq(
					verificationChecklistItems.verificationDocumentId,
					input.verificationDocumentId,
				),
				eq(verificationChecklistItems.taskId, input.taskId),
				inArray(verificationChecklistItems.conditionId, conditionIds),
			),
		);
	const found = new Set(items.map((item) => item.conditionId));
	const unknown = conditionIds.filter((conditionId) => !found.has(conditionId));
	if (unknown.length > 0) {
		throw new AppError(
			400,
			"unknown_verification_condition",
			`The managed evidence scope contains unknown condition IDs: ${unknown.join(", ")}`,
		);
	}

	for (const item of items) {
		if (item.verificationKind === "manual") {
			throw new AppError(
				400,
				"manual_condition_requires_human_confirmation",
				`Condition ${item.conditionId} requires an authorized human confirmation and cannot be satisfied by run_check.`,
			);
		}
		const compatible = item.expectedEvidenceJson.some((expected) =>
			input.evidenceKinds.some((actual) =>
				isCompatibleEvidenceKind(expected as ExpectedEvidence, actual),
			),
		);
		if (!compatible) {
			throw new AppError(
				400,
				"verification_evidence_kind_mismatch",
				`Condition ${item.conditionId} does not accept the declared evidence kinds: ${input.evidenceKinds.join(", ") || "none"}`,
			);
		}
	}
}
