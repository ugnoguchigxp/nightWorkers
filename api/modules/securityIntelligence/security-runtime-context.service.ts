import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import {
	securityAssessmentAttempts,
	securityAssessmentReceipts,
	securityAssessmentSubjectBindings,
} from "../../db/security-intelligence-schema";
import {
	getCurrentCompletionConditions,
	getCurrentSecurityContract,
} from "./security-intelligence.repository";
import { getSecurityKnowledgeOutboxProjection } from "./security-knowledge-outbox.service";

function assessmentProjection(payload: unknown) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const bundle = payload as {
		dependencyAssessment?: {
			assessmentRef?: unknown;
			outcome?: unknown;
			coverage?: unknown;
			unknowns?: unknown;
		};
		authorizationShadow?: {
			status?: unknown;
			reasonCode?: unknown;
			assessment?: {
				assessmentRef?: unknown;
				outcome?: unknown;
				coverage?: unknown;
				unknowns?: unknown;
			};
		};
		limitationCodes?: unknown;
	};
	return {
		dependency: bundle.dependencyAssessment
			? {
					assessmentRef: bundle.dependencyAssessment.assessmentRef,
					outcome: bundle.dependencyAssessment.outcome,
					coverage: bundle.dependencyAssessment.coverage,
					unknowns: bundle.dependencyAssessment.unknowns,
				}
			: null,
		authorization:
			bundle.authorizationShadow?.status === "available"
				? {
						status: "available",
						assessmentRef: bundle.authorizationShadow.assessment?.assessmentRef,
						outcome: bundle.authorizationShadow.assessment?.outcome,
						coverage: bundle.authorizationShadow.assessment?.coverage,
						unknowns: bundle.authorizationShadow.assessment?.unknowns,
					}
				: {
						status: bundle.authorizationShadow?.status,
						reasonCode: bundle.authorizationShadow?.reasonCode,
					},
		limitationCodes: bundle.limitationCodes,
	};
}

export async function buildSecurityRuntimeContextSnapshot(input: {
	taskRevisionSnapshotId: string | null;
	runId: string;
}) {
	if (!input.taskRevisionSnapshotId) return null;
	const [contract, conditions, bindings, attempts, knowledgeOutbox] =
		await Promise.all([
			getCurrentSecurityContract(input.taskRevisionSnapshotId),
			getCurrentCompletionConditions(input.taskRevisionSnapshotId),
			db
				.select()
				.from(securityAssessmentSubjectBindings)
				.where(
					eq(
						securityAssessmentSubjectBindings.taskRevisionSnapshotId,
						input.taskRevisionSnapshotId,
					),
				),
			db
				.select()
				.from(securityAssessmentAttempts)
				.where(
					eq(
						securityAssessmentAttempts.taskRevisionSnapshotId,
						input.taskRevisionSnapshotId,
					),
				),
			getSecurityKnowledgeOutboxProjection(input.runId),
		]);
	const visibleBindings = bindings
		.filter(
			(binding) =>
				binding.phase === "pre_implementation" ||
				binding.implementationRunId === input.runId,
		)
		.sort((left, right) => left.bindingRef.localeCompare(right.bindingRef));
	const receiptIds = [
		...new Set(visibleBindings.map((binding) => binding.assessmentReceiptId)),
	];
	const receipts = receiptIds.length
		? await db
				.select()
				.from(securityAssessmentReceipts)
				.where(inArray(securityAssessmentReceipts.id, receiptIds))
		: [];
	const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
	return {
		version: 1 as const,
		securityContract: contract?.contract ?? null,
		securityContractHeadRevision: contract?.headRevision ?? 0,
		adoptedCompletionConditions: conditions
			.map((item) => item.condition)
			.filter((condition) => condition.state === "adopted")
			.sort((left, right) =>
				left.conditionRef.localeCompare(right.conditionRef),
			),
		assessmentSubjectBindings: visibleBindings.map((binding) => ({
			bindingRef: binding.bindingRef,
			phase: binding.phase,
			assessmentReceiptRef:
				receiptById.get(binding.assessmentReceiptId)?.receiptRef ?? null,
			implementationRunId: binding.implementationRunId,
			evidenceSubjectSnapshotId: binding.evidenceSubjectSnapshotId,
		})),
		assessmentAttempts: attempts
			.filter(
				(attempt) =>
					attempt.phase === "pre_implementation" ||
					attempt.implementationRunId === input.runId,
			)
			.sort((left, right) => left.attemptRef.localeCompare(right.attemptRef))
			.map((attempt) => ({
				attemptRef: attempt.attemptRef,
				phase: attempt.phase,
				status: attempt.status,
				reasonCode: attempt.reasonCode,
				retryable: attempt.retryable,
			})),
		assessmentSummaries: receipts
			.sort((left, right) => left.receiptRef.localeCompare(right.receiptRef))
			.map((receipt) => ({
				receiptRef: receipt.receiptRef,
				bundleRef: receipt.bundleRef,
				projection: assessmentProjection(receipt.payloadJson),
			})),
		securityKnowledgeOutbox: knowledgeOutbox,
	};
}
