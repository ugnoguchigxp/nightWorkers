import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../api/db/client";
import {
	securityKnowledgeCandidateOutbox,
	securityKnowledgeCandidateReceipts,
	securityKnowledgeFeedbackOutbox,
	securityKnowledgeFeedbackReceipts,
} from "../api/db/security-intelligence-schema";
import { getSecurityKnowledgeOutboxProjection } from "../api/modules/securityIntelligence/security-knowledge-outbox.service";
import { dispatchSecurityKnowledgeOutbox } from "../api/modules/securityIntelligence/security-knowledge-outbox-dispatcher.service";

const fixture = JSON.parse(
	readFileSync(
		new URL(
			"../shared/fixtures/security-knowledge-candidate-batch-v1.json",
			import.meta.url,
		),
		"utf8",
	),
) as { valid: { batch: Record<string, unknown>; response: unknown } };

const feedbackFixture = JSON.parse(
	readFileSync(
		new URL(
			"../shared/fixtures/security-knowledge-feedback-batch-v1.json",
			import.meta.url,
		),
		"utf8",
	),
) as {
	batchRef: string;
	batchPayloadDigest: string;
	idempotencyKey: string;
	events: Array<{ eventRef: string }>;
};

async function insertCandidateOutbox() {
	const [row] = await db
		.insert(securityKnowledgeCandidateOutbox)
		.values({
			producerPrincipalRef: "coding-agent-run:test",
			endpoint:
				"http://127.0.0.1:39170/api/integrations/security-intelligence/v1/candidate-batches",
			contractVersion: 1,
			idempotencyKey: String(fixture.valid.batch.idempotencyKey),
			batchRef: String(fixture.valid.batch.batchRef),
			batchPayloadDigest: String(fixture.valid.batch.batchPayloadDigest),
			payloadJson: fixture.valid.batch,
			status: "pending",
		})
		.returning();
	if (!row) throw new Error("candidate outbox row was not created");
	return row;
}

async function insertFeedbackOutbox() {
	const [row] = await db
		.insert(securityKnowledgeFeedbackOutbox)
		.values({
			producerPrincipalRef: "coding-agent-run:test",
			endpoint:
				"http://127.0.0.1:39170/api/integrations/security-intelligence/v1/feedback-batches",
			contractVersion: 1,
			idempotencyKey: feedbackFixture.idempotencyKey,
			batchRef: feedbackFixture.batchRef,
			batchPayloadDigest: feedbackFixture.batchPayloadDigest,
			payloadJson: feedbackFixture,
			status: "pending",
		})
		.returning();
	if (!row) throw new Error("feedback outbox row was not created");
	return row;
}

describe("Security Knowledge outbox dispatcher", () => {
	beforeEach(async () => {
		await db.delete(securityKnowledgeCandidateReceipts);
		await db.delete(securityKnowledgeFeedbackReceipts);
		await db.delete(securityKnowledgeCandidateOutbox);
		await db.delete(securityKnowledgeFeedbackOutbox);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("keeps both exporters disabled by default", async () => {
		await insertCandidateOutbox();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED",
			"false",
		);
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_FEEDBACK_EXPORT_ENABLED",
			"false",
		);

		await expect(dispatchSecurityKnowledgeOutbox()).resolves.toEqual({
			candidates: 0,
			feedback: 0,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("queries only batches correlated to the requested Run", async () => {
		await insertCandidateOutbox();
		await insertFeedbackOutbox();
		await expect(
			getSecurityKnowledgeOutboxProjection(
				"44444444-4444-4444-8444-444444444444",
			),
		).resolves.toMatchObject({
			candidateBatches: [{ batchRef: fixture.valid.batch.batchRef }],
			feedbackBatches: [],
		});
		await expect(
			getSecurityKnowledgeOutboxProjection("fixture"),
		).resolves.toMatchObject({
			candidateBatches: [],
			feedbackBatches: [{ batchRef: feedbackFixture.batchRef }],
		});
	});

	it("records enabled exporter token misconfiguration without network access", async () => {
		await insertCandidateOutbox();
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED",
			"true",
		);
		vi.stubEnv("NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN", "");

		await dispatchSecurityKnowledgeOutbox();
		const [row] = await db.select().from(securityKnowledgeCandidateOutbox);
		expect(row).toMatchObject({
			status: "failed",
			attemptCount: 1,
			lastErrorCode: "integration_token_missing",
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("persists a strict receipt before marking a batch delivered", async () => {
		const inserted = await insertCandidateOutbox();
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED",
			"true",
		);
		vi.stubEnv("NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN", "test-token");
		const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
			expect(init?.redirect).toBe("manual");
			return new Response(JSON.stringify(fixture.valid.response), {
				status: 200,
			});
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(dispatchSecurityKnowledgeOutbox()).resolves.toEqual({
			candidates: 1,
			feedback: 0,
		});
		const [row] = await db.select().from(securityKnowledgeCandidateOutbox);
		expect(row?.status).toBe("delivered");
		const receipts = await db.select().from(securityKnowledgeCandidateReceipts);
		expect(receipts).toHaveLength(1);
		expect(receipts[0]?.outboxId).toBe(inserted.id);
	});

	it("accepts the same durable receipt when only the replay flag changes", async () => {
		const inserted = await insertCandidateOutbox();
		const firstResponse = structuredClone(fixture.valid.response) as {
			replayed: boolean;
			receipt: { receiptRef: string };
		};
		firstResponse.replayed = false;
		await db.insert(securityKnowledgeCandidateReceipts).values({
			outboxId: inserted.id,
			receiptRef: firstResponse.receipt.receiptRef,
			responseJson: firstResponse,
		});
		const replayResponse = structuredClone(firstResponse);
		replayResponse.replayed = true;
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED",
			"true",
		);
		vi.stubEnv("NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN", "test-token");
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify(replayResponse), { status: 200 }),
				),
		);

		await dispatchSecurityKnowledgeOutbox();
		const [row] = await db.select().from(securityKnowledgeCandidateOutbox);
		expect(row?.status).toBe("delivered");
		expect(
			await db.select().from(securityKnowledgeCandidateReceipts),
		).toHaveLength(1);
	});

	it("stops reading an oversized response before accepting a receipt", async () => {
		await insertCandidateOutbox();
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED",
			"true",
		);
		vi.stubEnv("NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN", "test-token");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(300 * 1024));
							controller.enqueue(new Uint8Array(300 * 1024));
							controller.close();
						},
					}),
					{ status: 200 },
				),
			),
		);

		await dispatchSecurityKnowledgeOutbox();
		const [row] = await db.select().from(securityKnowledgeCandidateOutbox);
		expect(row).toMatchObject({
			status: "dead_letter",
			lastErrorCode: "response_too_large",
		});
		expect(await db.select().from(securityKnowledgeCandidateReceipts)).toEqual(
			[],
		);
	});

	it("dead-letters an invalid successful response without retrying", async () => {
		await insertCandidateOutbox();
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED",
			"true",
		);
		vi.stubEnv("NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN", "test-token");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
		);

		await dispatchSecurityKnowledgeOutbox();
		const [row] = await db.select().from(securityKnowledgeCandidateOutbox);
		expect(row?.status).toBe("dead_letter");
		expect(row?.attemptCount).toBe(1);
		expect(row?.nextAttemptAt).toBeNull();
		expect(row?.lastErrorMessage).toBe("contextStill delivery failed");
	});

	it("dead-letters a schema-valid receipt for a different candidate batch", async () => {
		await insertCandidateOutbox();
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED",
			"true",
		);
		vi.stubEnv("NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN", "test-token");
		const foreign = structuredClone(fixture.valid.response) as {
			receipt: { batchRef: string };
		};
		foreign.receipt.batchRef = `skcb:v1:${"f".repeat(64)}`;
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(JSON.stringify(foreign), { status: 200 }),
				),
		);

		await dispatchSecurityKnowledgeOutbox();
		const [row] = await db.select().from(securityKnowledgeCandidateOutbox);
		expect(row?.status).toBe("dead_letter");
		expect(row?.lastErrorCode).toBe("receipt_binding_mismatch");
		expect(await db.select().from(securityKnowledgeCandidateReceipts)).toEqual(
			[],
		);
	});

	it("dead-letters feedback receipts that do not partition the submitted events", async () => {
		await insertFeedbackOutbox();
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_FEEDBACK_EXPORT_ENABLED",
			"true",
		);
		vi.stubEnv("NIGHTWORKERS_CONTEXT_STILL_FEEDBACK_TOKEN", "test-token");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						replayed: false,
						receipt: {
							contractVersion: 1,
							batchRef: feedbackFixture.batchRef,
							receiptRef: `skfr:v1:${"e".repeat(64)}`,
							acceptedEventRefs: [feedbackFixture.events[0]?.eventRef],
							duplicateEventRefs: [],
							rejectedEvents: [],
						},
					}),
					{ status: 200 },
				),
			),
		);

		await dispatchSecurityKnowledgeOutbox();
		const [row] = await db.select().from(securityKnowledgeFeedbackOutbox);
		expect(row?.status).toBe("dead_letter");
		expect(row?.lastErrorCode).toBe("receipt_binding_mismatch");
		expect(await db.select().from(securityKnowledgeFeedbackReceipts)).toEqual(
			[],
		);
	});

	it("retries a bounded transient HTTP failure", async () => {
		await insertCandidateOutbox();
		vi.stubEnv(
			"NIGHTWORKERS_SECURITY_KNOWLEDGE_CANDIDATE_EXPORT_ENABLED",
			"true",
		);
		vi.stubEnv("NIGHTWORKERS_CONTEXT_STILL_CANDIDATE_TOKEN", "test-token");
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("", { status: 503 })),
		);

		await dispatchSecurityKnowledgeOutbox();
		const [row] = await db.select().from(securityKnowledgeCandidateOutbox);
		expect(row?.status).toBe("failed");
		expect(row?.attemptCount).toBe(1);
		expect(row?.nextAttemptAt).toBeInstanceOf(Date);
		expect(row?.lastErrorCode).toBe("http_503");
	});
});
