import { and, desc, eq } from "drizzle-orm";
import { db } from "../../../db/client";
import { verificationDocuments } from "../../../db/verification-schema";
import { evaluateAcceptanceConditionAssurance } from "../verification/acceptance-condition-assurance.service";
import type { QualityGateResult } from "../verification/quality-gate.service";

export type CompletionCheckResult = {
	ok: boolean;
	verificationDocumentId: string | null;
	summary: {
		total: number;
		complete: number;
		failedRequired: number;
		unknownRequired: number;
	};
	failedRequired: Array<{ conditionId: string; text: string; reason?: string }>;
	unknownRequired: Array<{
		conditionId: string;
		text: string;
		reason?: string;
	}>;
	conditions: Array<{
		conditionId: string;
		text: string;
		required: boolean;
		status: string;
		reason?: string;
	}>;
	qualityGate: QualityGateResult;
	observability?: {
		requiredConditions: number;
		safePassConditions: number;
		unmappedConditions: number;
		detailsMissingConditions: number;
		staleConditions: number;
	};
	reason?: string;
};

export async function runCompletionCheck(input: {
	taskId: string;
	runId: string;
	verificationDocumentId?: string | null;
	repoRoot?: string;
}): Promise<CompletionCheckResult> {
	const document = input.verificationDocumentId
		? await db
				.select()
				.from(verificationDocuments)
				.where(
					and(
						eq(verificationDocuments.id, input.verificationDocumentId),
						eq(verificationDocuments.taskId, input.taskId),
						eq(verificationDocuments.status, "active"),
					),
				)
				.then((rows) => rows[0])
		: await db
				.select()
				.from(verificationDocuments)
				.where(
					and(
						eq(verificationDocuments.taskId, input.taskId),
						eq(verificationDocuments.status, "active"),
					),
				)
				.orderBy(desc(verificationDocuments.generatedAt))
				.limit(1)
				.then((rows) => rows[0]);
	if (!document) return missingDocumentResult();
	if (!input.repoRoot) {
		return {
			...missingDocumentResult("missing_repository_context"),
			verificationDocumentId: document.id,
		};
	}

	const evaluation = await evaluateAcceptanceConditionAssurance({
		taskId: input.taskId,
		runId: input.runId,
		verificationDocumentId: document.id,
		repoRoot: input.repoRoot,
	});
	const failedRequired = evaluation.conditions.filter(
		(condition) => condition.required && condition.assuranceStatus === "failed",
	);
	const unknownRequired = evaluation.conditions.filter(
		(condition) =>
			condition.required &&
			condition.assuranceStatus !== "safe_pass" &&
			condition.assuranceStatus !== "failed",
	);
	const complete = evaluation.conditions.filter(
		(condition) =>
			!condition.required || condition.assuranceStatus === "safe_pass",
	).length;
	const qualityGate: QualityGateResult = {
		passed: evaluation.qualityGate.passed,
		sourceStateHash: evaluation.sourceStateHash,
		inventory: evaluation.qualityGate.inventory,
		testExecution: evaluation.qualityGate.testExecution,
		fullVerify: {
			status: evaluation.qualityGate.fullVerify.status,
			...(evaluation.qualityGate.fullVerify.reason
				? { reason: evaluation.qualityGate.fullVerify.reason }
				: {}),
		},
		conditions: evaluation.conditions.map((condition) => ({
			conditionId: condition.conditionId,
			required: condition.required,
			status: !condition.required
				? "not_required"
				: condition.assuranceStatus === "safe_pass"
					? "passed"
					: "failed",
			...(condition.reasonCode ? { reason: condition.reasonCode } : {}),
		})),
	};
	return {
		ok: evaluation.passed,
		verificationDocumentId: document.id,
		summary: {
			total: evaluation.conditions.length,
			complete,
			failedRequired: failedRequired.length,
			unknownRequired: unknownRequired.length,
		},
		failedRequired: failedRequired.map(toConditionResult),
		unknownRequired: unknownRequired.map(toConditionResult),
		conditions: evaluation.conditions.map((condition) => ({
			conditionId: condition.conditionId,
			text: condition.text,
			required: condition.required,
			status: condition.assuranceStatus,
			...(condition.reasonCode ? { reason: condition.reasonCode } : {}),
		})),
		qualityGate,
		observability: {
			requiredConditions: evaluation.conditions.filter(
				(condition) => condition.required,
			).length,
			safePassConditions: evaluation.conditions.filter(
				(condition) =>
					condition.required && condition.assuranceStatus === "safe_pass",
			).length,
			unmappedConditions: evaluation.conditions.filter(
				(condition) => condition.assuranceStatus === "unmapped",
			).length,
			detailsMissingConditions: evaluation.conditions.filter(
				(condition) => condition.assuranceStatus === "details_missing",
			).length,
			staleConditions: evaluation.conditions.filter(
				(condition) => condition.assuranceStatus === "stale",
			).length,
		},
		reason:
			failedRequired.length || unknownRequired.length
				? "required_conditions_incomplete"
				: evaluation.qualityGate.passed
					? undefined
					: "quality_gate_incomplete",
	};
}

function toConditionResult(input: {
	conditionId: string;
	text: string;
	reasonCode: string | null;
}) {
	return {
		conditionId: input.conditionId,
		text: input.text,
		...(input.reasonCode ? { reason: input.reasonCode } : {}),
	};
}

function missingDocumentResult(
	reason = "missing_verification_document",
): CompletionCheckResult {
	return {
		ok: false,
		verificationDocumentId: null,
		summary: {
			total: 0,
			complete: 0,
			failedRequired: 0,
			unknownRequired: 0,
		},
		failedRequired: [],
		unknownRequired: [],
		conditions: [],
		qualityGate: {
			passed: false,
			inventory: { status: "unknown", activeCaseCount: 0, reason },
			testExecution: { status: "unknown", reason },
			fullVerify: { status: "unknown", reason },
			conditions: [],
		},
		observability: {
			requiredConditions: 0,
			safePassConditions: 0,
			unmappedConditions: 0,
			detailsMissingConditions: 0,
			staleConditions: 0,
		},
		reason,
	};
}
