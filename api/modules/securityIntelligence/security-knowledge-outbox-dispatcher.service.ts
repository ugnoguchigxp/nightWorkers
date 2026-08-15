import { and, eq, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
	securityKnowledgeCandidateBatchResponseSchema,
	securityKnowledgeCandidateBatchSchema,
} from "../../../shared/schemas/security-knowledge-candidate-batch.schema";
import {
	securityKnowledgeFeedbackBatchResponseSchema,
	securityKnowledgeFeedbackBatchSchema,
} from "../../../shared/schemas/security-knowledge-feedback-batch.schema";
import { canonicalStringifySecurityIntelligenceValue } from "../../../shared/security-intelligence-assessment-contract";
import { db } from "../../db/client";
import {
	securityKnowledgeCandidateOutbox,
	securityKnowledgeCandidateReceipts,
	securityKnowledgeFeedbackOutbox,
	securityKnowledgeFeedbackReceipts,
} from "../../db/security-intelligence-schema";

const MAX_ATTEMPTS = 5;

class NonRetryableDeliveryError extends Error {}

function exportEnabled(kind: "candidate" | "feedback") {
	return (
		process.env[
			kind === "candidate"
				? "NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED"
				: "NIGHTWORKERS_SECURITY_KNOWLEDGE_FEEDBACK_EXPORT_ENABLED"
		] === "true"
	);
}

async function boundedJson(response: Response, maxBytes: number) {
	const contentLength = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(contentLength) && contentLength > maxBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw new NonRetryableDeliveryError("response_too_large");
	}
	if (!response.body) throw new NonRetryableDeliveryError("response_empty");
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			total += chunk.value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new NonRetryableDeliveryError("response_too_large");
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	try {
		return JSON.parse(
			Buffer.concat(
				chunks.map((chunk) => Buffer.from(chunk)),
				total,
			).toString("utf8"),
		);
	} catch {
		throw new NonRetryableDeliveryError("response_json_invalid");
	}
}

function exactUniqueSet(actual: string[], expected: string[]) {
	return (
		new Set(actual).size === actual.length &&
		new Set(expected).size === expected.length &&
		actual.length === expected.length &&
		actual.every((value) => expected.includes(value))
	);
}

function sameCanonicalValue(left: unknown, right: unknown) {
	return (
		canonicalStringifySecurityIntelligenceValue(left) ===
		canonicalStringifySecurityIntelligenceValue(right)
	);
}

function assertCandidateReceiptMatchesOutbox(
	row: typeof securityKnowledgeCandidateOutbox.$inferSelect,
	response: ReturnType<
		typeof securityKnowledgeCandidateBatchResponseSchema.parse
	>,
) {
	const batch = securityKnowledgeCandidateBatchSchema.parse(row.payloadJson);
	if (
		row.batchRef !== batch.batchRef ||
		row.batchPayloadDigest !== batch.batchPayloadDigest ||
		response.receipt.batchRef !== batch.batchRef ||
		!exactUniqueSet(
			response.receipt.items.map((item) => item.candidateRef),
			batch.items.map((item) => item.candidateRef),
		)
	) {
		throw new NonRetryableDeliveryError("receipt_binding_mismatch");
	}
}

function assertFeedbackReceiptMatchesOutbox(
	row: typeof securityKnowledgeFeedbackOutbox.$inferSelect,
	response: ReturnType<
		typeof securityKnowledgeFeedbackBatchResponseSchema.parse
	>,
) {
	const batch = securityKnowledgeFeedbackBatchSchema.parse(row.payloadJson);
	const receiptEventRefs = [
		...response.receipt.acceptedEventRefs,
		...response.receipt.duplicateEventRefs,
		...response.receipt.rejectedEvents.map((event) => event.eventRef),
	];
	if (
		row.batchRef !== batch.batchRef ||
		row.batchPayloadDigest !== batch.batchPayloadDigest ||
		response.receipt.batchRef !== batch.batchRef ||
		!exactUniqueSet(
			receiptEventRefs,
			batch.events.map((event) => event.eventRef),
		)
	) {
		throw new NonRetryableDeliveryError("receipt_binding_mismatch");
	}
}

async function deliverOutbox(
	kind: "candidate" | "feedback",
	row: typeof securityKnowledgeCandidateOutbox.$inferSelect,
) {
	if (!exportEnabled(kind)) return;
	const token =
		kind === "candidate"
			? process.env.NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN?.trim()
			: process.env.NIGHTWORKERS_CONTEXT_STILL_FEEDBACK_TOKEN?.trim();
	if (!token) {
		await recordDeliveryFailure(kind, row, "integration_token_missing", true);
		return;
	}
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10_000);
	try {
		const response = await fetch(row.endpoint, {
			method: "POST",
			redirect: "manual",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(row.payloadJson),
			signal: controller.signal,
		});
		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined);
			const retryable = response.status === 429 || response.status >= 500;
			await recordDeliveryFailure(
				kind,
				row,
				`http_${response.status}`,
				retryable,
			);
			return;
		}
		const payload = await boundedJson(response, 512 * 1024);
		if (kind === "candidate") {
			const parsed =
				securityKnowledgeCandidateBatchResponseSchema.parse(payload);
			assertCandidateReceiptMatchesOutbox(row, parsed);
			const status = parsed.receipt.items.some(
				(item) => item.status === "rejected",
			)
				? parsed.receipt.items.some((item) => item.status !== "rejected")
					? "partial"
					: "rejected"
				: "delivered";
			await db.transaction(async (tx) => {
				await tx
					.insert(securityKnowledgeCandidateReceipts)
					.values({
						outboxId: row.id,
						receiptRef: parsed.receipt.receiptRef,
						responseJson: parsed,
					})
					.onConflictDoNothing();
				const [receipt] = await tx
					.select()
					.from(securityKnowledgeCandidateReceipts)
					.where(eq(securityKnowledgeCandidateReceipts.outboxId, row.id))
					.limit(1);
				const existingResponse =
					securityKnowledgeCandidateBatchResponseSchema.safeParse(
						receipt?.responseJson,
					);
				if (
					!receipt ||
					!existingResponse.success ||
					receipt.receiptRef !== parsed.receipt.receiptRef ||
					!sameCanonicalValue(existingResponse.data.receipt, parsed.receipt)
				) {
					throw new NonRetryableDeliveryError(
						"candidate_receipt_integrity_conflict",
					);
				}
				await tx
					.update(securityKnowledgeCandidateOutbox)
					.set({ status, updatedAt: new Date(), nextAttemptAt: null })
					.where(
						and(
							eq(securityKnowledgeCandidateOutbox.id, row.id),
							or(
								eq(securityKnowledgeCandidateOutbox.status, "pending"),
								eq(securityKnowledgeCandidateOutbox.status, "failed"),
							),
						),
					);
			});
		} else {
			const parsed =
				securityKnowledgeFeedbackBatchResponseSchema.parse(payload);
			assertFeedbackReceiptMatchesOutbox(row, parsed);
			const status = parsed.receipt.rejectedEvents.length
				? parsed.receipt.acceptedEventRefs.length ||
					parsed.receipt.duplicateEventRefs.length
					? "partial"
					: "rejected"
				: "delivered";
			await db.transaction(async (tx) => {
				await tx
					.insert(securityKnowledgeFeedbackReceipts)
					.values({
						outboxId: row.id,
						receiptRef: parsed.receipt.receiptRef,
						responseJson: parsed,
					})
					.onConflictDoNothing();
				const [receipt] = await tx
					.select()
					.from(securityKnowledgeFeedbackReceipts)
					.where(eq(securityKnowledgeFeedbackReceipts.outboxId, row.id))
					.limit(1);
				const existingResponse =
					securityKnowledgeFeedbackBatchResponseSchema.safeParse(
						receipt?.responseJson,
					);
				if (
					!receipt ||
					!existingResponse.success ||
					receipt.receiptRef !== parsed.receipt.receiptRef ||
					!sameCanonicalValue(existingResponse.data.receipt, parsed.receipt)
				) {
					throw new NonRetryableDeliveryError(
						"feedback_receipt_integrity_conflict",
					);
				}
				await tx
					.update(securityKnowledgeFeedbackOutbox)
					.set({ status, updatedAt: new Date(), nextAttemptAt: null })
					.where(
						and(
							eq(securityKnowledgeFeedbackOutbox.id, row.id),
							or(
								eq(securityKnowledgeFeedbackOutbox.status, "pending"),
								eq(securityKnowledgeFeedbackOutbox.status, "failed"),
							),
						),
					);
			});
		}
	} catch (error) {
		const code =
			error instanceof NonRetryableDeliveryError
				? error.message
				: error instanceof Error
					? error.name
					: "transport_error";
		const retryable =
			!(error instanceof z.ZodError) &&
			!(error instanceof NonRetryableDeliveryError) &&
			(error instanceof TypeError ||
				(error instanceof Error && error.name === "AbortError"));
		await recordDeliveryFailure(kind, row, code, retryable);
	} finally {
		clearTimeout(timeout);
	}
}

async function recordDeliveryFailure(
	kind: "candidate" | "feedback",
	row: typeof securityKnowledgeCandidateOutbox.$inferSelect,
	code: string,
	retryable: boolean,
) {
	const attempts = row.attemptCount + 1;
	const dead = !retryable || attempts >= MAX_ATTEMPTS;
	const nextAttemptAt = dead
		? null
		: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** (attempts - 1)));
	const update = {
		status: dead ? "dead_letter" : "failed",
		attemptCount: attempts,
		nextAttemptAt,
		lastErrorCode: code.slice(0, 128),
		lastErrorMessage: "contextStill delivery failed",
		updatedAt: new Date(),
	} as const;
	if (kind === "candidate") {
		await db
			.update(securityKnowledgeCandidateOutbox)
			.set(update)
			.where(
				and(
					eq(securityKnowledgeCandidateOutbox.id, row.id),
					or(
						eq(securityKnowledgeCandidateOutbox.status, "pending"),
						eq(securityKnowledgeCandidateOutbox.status, "failed"),
					),
				),
			);
		return;
	}
	await db
		.update(securityKnowledgeFeedbackOutbox)
		.set(update)
		.where(
			and(
				eq(securityKnowledgeFeedbackOutbox.id, row.id),
				or(
					eq(securityKnowledgeFeedbackOutbox.status, "pending"),
					eq(securityKnowledgeFeedbackOutbox.status, "failed"),
				),
			),
		);
}

export async function dispatchSecurityKnowledgeOutbox() {
	const candidateEnabled = exportEnabled("candidate");
	const feedbackEnabled = exportEnabled("feedback");
	if (!candidateEnabled && !feedbackEnabled) {
		return { candidates: 0, feedback: 0 };
	}
	const now = new Date();
	const [candidates, feedback] = await Promise.all([
		candidateEnabled
			? db
					.select()
					.from(securityKnowledgeCandidateOutbox)
					.where(
						and(
							or(
								eq(securityKnowledgeCandidateOutbox.status, "pending"),
								eq(securityKnowledgeCandidateOutbox.status, "failed"),
							),
							or(
								isNull(securityKnowledgeCandidateOutbox.nextAttemptAt),
								lte(securityKnowledgeCandidateOutbox.nextAttemptAt, now),
							),
						),
					)
					.limit(10)
			: Promise.resolve([]),
		feedbackEnabled
			? db
					.select()
					.from(securityKnowledgeFeedbackOutbox)
					.where(
						and(
							or(
								eq(securityKnowledgeFeedbackOutbox.status, "pending"),
								eq(securityKnowledgeFeedbackOutbox.status, "failed"),
							),
							or(
								isNull(securityKnowledgeFeedbackOutbox.nextAttemptAt),
								lte(securityKnowledgeFeedbackOutbox.nextAttemptAt, now),
							),
						),
					)
					.limit(10)
			: Promise.resolve([]),
	]);
	for (const row of candidates) await deliverOutbox("candidate", row);
	for (const row of feedback) await deliverOutbox("feedback", row);
	return { candidates: candidates.length, feedback: feedback.length };
}
