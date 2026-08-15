import { and, eq, inArray, sql } from "drizzle-orm";
import { securityFinalJudgmentV1Schema } from "../../../shared/schemas/security-intelligence-runtime.schema";
import {
	deriveSecurityKnowledgeCandidateBatch,
	deriveSecurityKnowledgeCandidateItem,
	proposeSecurityKnowledgeCandidateBatchCommandSchema,
	type SecurityKnowledgeCandidateBatch,
} from "../../../shared/schemas/security-knowledge-candidate-batch.schema";
import {
	deriveSecurityKnowledgeFeedbackBatch,
	deriveSecurityKnowledgeFeedbackEvent,
	proposeSecurityKnowledgeFeedbackBatchCommandSchema,
	type SecurityKnowledgeFeedbackBatch,
} from "../../../shared/schemas/security-knowledge-feedback-batch.schema";
import { db } from "../../db/client";
import { taskRuns } from "../../db/schema-task-runs";
import {
	securityAssessmentReceipts,
	securityAssessmentSubjectBindings,
	securityKnowledgeCandidateOutbox,
	securityKnowledgeFeedbackOutbox,
} from "../../db/security-intelligence-schema";
import { AppError } from "../../lib/errors";
import { dispatchSecurityKnowledgeOutbox } from "./security-knowledge-outbox-dispatcher.service";

const CANDIDATE_PATH =
	"/api/integrations/security-intelligence/v1/candidate-batches";
const FEEDBACK_PATH =
	"/api/integrations/security-intelligence/v1/feedback-batches";
const PRODUCER_VERSION = "0.1.0";

function integrationBaseUrl() {
	const raw =
		process.env.NIGHTWORKERS_CONTEXT_STILL_INTEGRATION_URL?.trim() ||
		"http://127.0.0.1:39170";
	const parsed = new URL(raw);
	const loopback = ["127.0.0.1", "[::1]", "::1"].includes(parsed.hostname);
	if (
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.search !== "" ||
		parsed.hash !== "" ||
		(parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
	) {
		throw new AppError(
			503,
			"SECURITY_KNOWLEDGE_INTEGRATION_URL_UNSAFE",
			"contextStill integration URLはHTTPSまたはloopback HTTPである必要があります。",
		);
	}
	parsed.pathname = parsed.pathname.replace(/\/$/, "");
	return parsed.toString().replace(/\/$/, "");
}

function candidateEndpoint() {
	return `${integrationBaseUrl()}${CANDIDATE_PATH}`;
}

function feedbackEndpoint() {
	return `${integrationBaseUrl()}${FEEDBACK_PATH}`;
}

function assessmentEvidenceRows(payload: unknown) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return [];
	const bundle = payload as {
		dependencyAssessment?: {
			assessmentRef?: unknown;
			evidenceRefs?: Array<{ ref?: unknown; digest?: unknown }>;
		};
		authorizationShadow?: {
			status?: unknown;
			assessment?: {
				assessmentRef?: unknown;
				evidenceRefs?: Array<{ ref?: unknown; digest?: unknown }>;
			};
		};
	};
	return [
		bundle.dependencyAssessment,
		bundle.authorizationShadow?.status === "available"
			? bundle.authorizationShadow.assessment
			: undefined,
	].flatMap((assessment) => {
		if (typeof assessment?.assessmentRef !== "string") return [];
		return (assessment.evidenceRefs ?? []).flatMap((evidence) =>
			typeof evidence.ref === "string" && typeof evidence.digest === "string"
				? [
						{
							assessmentRef: assessment.assessmentRef,
							evidenceRef: evidence.ref,
							evidenceDigest: evidence.digest,
						},
					]
				: [],
		);
	});
}

async function requireRunWithFinalJudgment(runId: string) {
	const run = await requireRun(runId);
	const judgment = securityFinalJudgmentV1Schema.safeParse(run.finalJudgment);
	if (!judgment.success) {
		throw new AppError(
			409,
			"SECURITY_KNOWLEDGE_FINAL_JUDGMENT_REQUIRED",
			"Security Knowledge proposalには保存済みFinal Judgmentが必要です。",
		);
	}
	return { run, judgment: judgment.data };
}

async function requireRun(runId: string) {
	const [run] = await db
		.select()
		.from(taskRuns)
		.where(eq(taskRuns.id, runId))
		.limit(1);
	if (!run)
		throw new AppError(
			404,
			"SECURITY_KNOWLEDGE_RUN_NOT_FOUND",
			"Run not found",
		);
	return run;
}

export async function proposeSecurityKnowledgeCandidateBatch(
	rawInput: unknown,
	context: { producerPrincipalRef: string },
) {
	const input =
		proposeSecurityKnowledgeCandidateBatchCommandSchema.parse(rawInput);
	const { run, judgment } = await requireRunWithFinalJudgment(input.runId);
	if (judgment.judgmentDigest !== input.expectedFinalJudgmentDigest) {
		throw new AppError(
			409,
			"SECURITY_KNOWLEDGE_FINAL_JUDGMENT_CONFLICT",
			"Final Judgment digestがproposalの前提と一致しません。",
		);
	}
	const bindings = judgment.assessmentSubjectBindingRefs.length
		? await db
				.select()
				.from(securityAssessmentSubjectBindings)
				.where(
					inArray(
						securityAssessmentSubjectBindings.bindingRef,
						judgment.assessmentSubjectBindingRefs,
					),
				)
		: [];
	const receiptIds = [
		...new Set(bindings.map((binding) => binding.assessmentReceiptId)),
	];
	const receipts = receiptIds.length
		? await db
				.select()
				.from(securityAssessmentReceipts)
				.where(inArray(securityAssessmentReceipts.id, receiptIds))
		: [];
	const finalEvidenceRefs = new Set(
		judgment.conditionEvaluations.flatMap(
			(evaluation) => evaluation.evidenceRefs,
		),
	);
	const allowedEvidence = receipts.flatMap((receipt) => {
		const target = receipt.normalizedTargetJson as {
			sourceRevision?: unknown;
			targetDigest?: unknown;
		};
		return assessmentEvidenceRows(receipt.payloadJson).map((evidence) => ({
			...evidence,
			sourceProjectRef: receipt.canonicalProjectRef,
			sourceRevision: target.sourceRevision,
			targetDigest: target.targetDigest,
		}));
	});
	for (const item of input.items) {
		for (const evidence of item.evidenceRefs) {
			const matched = allowedEvidence.some(
				(allowed) =>
					allowed.assessmentRef === evidence.assessmentRef &&
					allowed.evidenceRef === evidence.evidenceRef &&
					allowed.evidenceDigest === evidence.evidenceDigest &&
					allowed.sourceProjectRef === evidence.sourceProjectRef &&
					allowed.sourceRevision === evidence.sourceRevision &&
					allowed.targetDigest === evidence.targetDigest,
			);
			if (!matched || !finalEvidenceRefs.has(evidence.evidenceRef)) {
				throw new AppError(
					409,
					"SECURITY_KNOWLEDGE_FOREIGN_EVIDENCE",
					"candidate evidenceはcurrent RunのFinal Judgmentとassessment receiptへbindingされていません。",
					{ evidenceRef: evidence.evidenceRef },
				);
			}
		}
	}
	const items = input.items.map(deriveSecurityKnowledgeCandidateItem);
	const batch = deriveSecurityKnowledgeCandidateBatch({
		idempotencyKey: `security-candidates:${input.commandRef}:v1`,
		producer: { system: "nightworkers", version: PRODUCER_VERSION },
		correlation: { taskRef: `task:${run.taskId}`, runRef: `run:${run.id}` },
		items,
	});
	const saved = await saveCandidateOutbox(batch, context.producerPrincipalRef);
	void dispatchSecurityKnowledgeOutbox().catch(() => undefined);
	return saved;
}

async function saveCandidateOutbox(
	batch: SecurityKnowledgeCandidateBatch,
	producerPrincipalRef: string,
) {
	return db.transaction(async (tx) => {
		const endpoint = candidateEndpoint();
		const [existing] = await tx
			.select()
			.from(securityKnowledgeCandidateOutbox)
			.where(
				and(
					eq(
						securityKnowledgeCandidateOutbox.producerPrincipalRef,
						producerPrincipalRef,
					),
					eq(securityKnowledgeCandidateOutbox.endpoint, endpoint),
					eq(securityKnowledgeCandidateOutbox.contractVersion, 1),
					eq(
						securityKnowledgeCandidateOutbox.idempotencyKey,
						batch.idempotencyKey,
					),
				),
			)
			.limit(1);
		if (existing) {
			if (existing.batchPayloadDigest !== batch.batchPayloadDigest) {
				throw new AppError(
					409,
					"SECURITY_KNOWLEDGE_OUTBOX_IDEMPOTENCY_CONFLICT",
					"同じcommand refに異なるcandidate payloadが指定されました。",
				);
			}
			return existing;
		}
		const [created] = await tx
			.insert(securityKnowledgeCandidateOutbox)
			.values({
				producerPrincipalRef,
				endpoint,
				contractVersion: 1,
				idempotencyKey: batch.idempotencyKey,
				batchRef: batch.batchRef,
				batchPayloadDigest: batch.batchPayloadDigest,
				payloadJson: batch,
				status: "pending",
			})
			.onConflictDoNothing()
			.returning();
		if (created) return created;
		const [concurrent] = await tx
			.select()
			.from(securityKnowledgeCandidateOutbox)
			.where(
				and(
					eq(
						securityKnowledgeCandidateOutbox.producerPrincipalRef,
						producerPrincipalRef,
					),
					eq(securityKnowledgeCandidateOutbox.endpoint, endpoint),
					eq(securityKnowledgeCandidateOutbox.contractVersion, 1),
					eq(
						securityKnowledgeCandidateOutbox.idempotencyKey,
						batch.idempotencyKey,
					),
				),
			)
			.limit(1);
		if (
			!concurrent ||
			concurrent.batchPayloadDigest !== batch.batchPayloadDigest
		) {
			throw new AppError(
				409,
				"SECURITY_KNOWLEDGE_OUTBOX_IDEMPOTENCY_CONFLICT",
				"同じcommand refに異なるcandidate payloadが指定されました。",
			);
		}
		return concurrent;
	});
}

export async function proposeSecurityKnowledgeFeedbackBatch(
	rawInput: unknown,
	context: { producerPrincipalRef: string },
) {
	const input =
		proposeSecurityKnowledgeFeedbackBatchCommandSchema.parse(rawInput);
	const run = await requireRun(input.runId);
	const judgment = securityFinalJudgmentV1Schema.safeParse(run.finalJudgment);
	for (const event of input.events) {
		if (
			event.correlation.taskRef !== `task:${run.taskId}` ||
			event.correlation.runRef !== `run:${run.id}`
		) {
			throw new AppError(
				409,
				"SECURITY_KNOWLEDGE_FEEDBACK_CORRELATION_CONFLICT",
				"feedback eventはrequest-scoped Task / Runへbindingされていません。",
			);
		}
		if (
			["verification_outcome", "false_warning", "harm_signal"].includes(
				event.eventType,
			)
		) {
			if (!judgment.success) {
				throw new AppError(
					409,
					"SECURITY_KNOWLEDGE_FEEDBACK_FINAL_JUDGMENT_REQUIRED",
					"検証結果feedbackには保存済みFinal Judgmentが必要です。",
				);
			}
			const allowedEvidence = new Set(
				judgment.data.conditionEvaluations.flatMap(
					(evaluation) => evaluation.evidenceRefs,
				),
			);
			const foreignEvidence = event.evidenceRefs.filter(
				(evidenceRef) => !allowedEvidence.has(evidenceRef),
			);
			if (
				foreignEvidence.length > 0 ||
				(event.correlation.verificationRef !== undefined &&
					!allowedEvidence.has(event.correlation.verificationRef))
			) {
				throw new AppError(
					409,
					"SECURITY_KNOWLEDGE_FEEDBACK_FOREIGN_EVIDENCE",
					"feedback evidenceはcurrent RunのFinal Judgmentへbindingされていません。",
					{ evidenceRefs: foreignEvidence },
				);
			}
		}
	}
	const batch = deriveSecurityKnowledgeFeedbackBatch({
		idempotencyKey: `security-feedback:${input.commandRef}:v1`,
		producer: { system: "nightworkers", version: PRODUCER_VERSION },
		events: input.events.map(deriveSecurityKnowledgeFeedbackEvent),
	});
	const saved = await saveFeedbackOutbox(batch, context.producerPrincipalRef);
	void dispatchSecurityKnowledgeOutbox().catch(() => undefined);
	return saved;
}

async function saveFeedbackOutbox(
	batch: SecurityKnowledgeFeedbackBatch,
	producerPrincipalRef: string,
) {
	return db.transaction(async (tx) => {
		const endpoint = feedbackEndpoint();
		const [existing] = await tx
			.select()
			.from(securityKnowledgeFeedbackOutbox)
			.where(
				and(
					eq(
						securityKnowledgeFeedbackOutbox.producerPrincipalRef,
						producerPrincipalRef,
					),
					eq(securityKnowledgeFeedbackOutbox.endpoint, endpoint),
					eq(securityKnowledgeFeedbackOutbox.contractVersion, 1),
					eq(
						securityKnowledgeFeedbackOutbox.idempotencyKey,
						batch.idempotencyKey,
					),
				),
			)
			.limit(1);
		if (existing) {
			if (existing.batchPayloadDigest !== batch.batchPayloadDigest) {
				throw new AppError(
					409,
					"SECURITY_KNOWLEDGE_FEEDBACK_IDEMPOTENCY_CONFLICT",
					"同じcommand refに異なるfeedback payloadが指定されました。",
				);
			}
			return existing;
		}
		const [created] = await tx
			.insert(securityKnowledgeFeedbackOutbox)
			.values({
				producerPrincipalRef,
				endpoint,
				contractVersion: 1,
				idempotencyKey: batch.idempotencyKey,
				batchRef: batch.batchRef,
				batchPayloadDigest: batch.batchPayloadDigest,
				payloadJson: batch,
				status: "pending",
			})
			.onConflictDoNothing()
			.returning();
		if (created) return created;
		const [concurrent] = await tx
			.select()
			.from(securityKnowledgeFeedbackOutbox)
			.where(
				and(
					eq(
						securityKnowledgeFeedbackOutbox.producerPrincipalRef,
						producerPrincipalRef,
					),
					eq(securityKnowledgeFeedbackOutbox.endpoint, endpoint),
					eq(securityKnowledgeFeedbackOutbox.contractVersion, 1),
					eq(
						securityKnowledgeFeedbackOutbox.idempotencyKey,
						batch.idempotencyKey,
					),
				),
			)
			.limit(1);
		if (
			!concurrent ||
			concurrent.batchPayloadDigest !== batch.batchPayloadDigest
		) {
			throw new AppError(
				409,
				"SECURITY_KNOWLEDGE_FEEDBACK_IDEMPOTENCY_CONFLICT",
				"同じcommand refに異なるfeedback payloadが指定されました。",
			);
		}
		return concurrent;
	});
}

export async function getSecurityKnowledgeOutboxProjection(runId: string) {
	const runRef = `run:${runId}`;
	const [candidateRows, feedbackRows] = await Promise.all([
		db
			.select()
			.from(securityKnowledgeCandidateOutbox)
			.where(
				sql`json_extract(${securityKnowledgeCandidateOutbox.payloadJson}, '$.correlation.runRef') = ${runRef}`,
			),
		db
			.select()
			.from(securityKnowledgeFeedbackOutbox)
			.where(
				sql`exists (
					select 1
					from json_each(${securityKnowledgeFeedbackOutbox.payloadJson}, '$.events') as event
					where json_extract(event.value, '$.correlation.runRef') = ${runRef}
				)`,
			),
	]);
	return {
		candidateBatches: candidateRows.map(projectOutbox),
		feedbackBatches: feedbackRows.map(projectOutbox),
	};
}

function projectOutbox(
	row: typeof securityKnowledgeCandidateOutbox.$inferSelect,
) {
	return {
		batchRef: row.batchRef,
		status: row.status,
		attemptCount: row.attemptCount,
		nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
		lastErrorCode: row.lastErrorCode,
	};
}

export const securityKnowledgeCandidateProposalSchema =
	proposeSecurityKnowledgeCandidateBatchCommandSchema;
export const securityKnowledgeFeedbackProposalSchema =
	proposeSecurityKnowledgeFeedbackBatchCommandSchema;
export { dispatchSecurityKnowledgeOutbox };
