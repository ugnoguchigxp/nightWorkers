import { and, desc, eq, sql } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import { evidenceSubjectSnapshots } from "../../db/evidence-ledger-schema";
import { finalResponseEvidence } from "../../db/final-response-evidence-schema";
import { taskRuns } from "../../db/schema-task-execution";
import { canonicalDigest } from "../agentsShare";

type Database = typeof db | DbTransaction;

export async function appendFinalResponseEvidence(
	input: {
		taskId: string;
		runId: string;
		content: string;
	},
	database: Database = db,
) {
	const normalized = input.content.trim();
	if (!normalized) return null;
	const contentDigest = canonicalDigest(normalized);
	const persist = async (target: Database) => {
		const [run] = await target
			.select({ id: taskRuns.id })
			.from(taskRuns)
			.where(
				and(eq(taskRuns.id, input.runId), eq(taskRuns.taskId, input.taskId)),
			);
		if (!run) throw new Error("Final Response Evidence run/task mismatch");

		const [subject] = await target
			.select()
			.from(evidenceSubjectSnapshots)
			.where(eq(evidenceSubjectSnapshots.implementationRunId, input.runId))
			.orderBy(
				desc(evidenceSubjectSnapshots.createdAt),
				desc(sql<number>`rowid`),
			);
		const currentSubjectId = subject?.id ?? null;
		const sameContent = await target
			.select()
			.from(finalResponseEvidence)
			.where(
				and(
					eq(finalResponseEvidence.runId, input.runId),
					eq(finalResponseEvidence.contentDigest, contentDigest),
				),
			)
			.orderBy(desc(finalResponseEvidence.revision));
		const matchingBinding = sameContent.find(
			(item) =>
				item.subjectId === currentSubjectId &&
				item.bindingStatus ===
					(subject?.bindingStatus === "canonical"
						? "canonical"
						: "legacy_unbound"),
		);
		if (matchingBinding) return matchingBinding;

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const [latest] = await target
				.select({ revision: finalResponseEvidence.revision })
				.from(finalResponseEvidence)
				.where(eq(finalResponseEvidence.runId, input.runId))
				.orderBy(desc(finalResponseEvidence.revision));
			const [created] = await target
				.insert(finalResponseEvidence)
				.values({
					taskId: input.taskId,
					runId: input.runId,
					subjectId: subject?.id ?? null,
					revision: (latest?.revision ?? 0) + 1,
					bindingStatus:
						subject?.bindingStatus === "canonical"
							? "canonical"
							: "legacy_unbound",
					contentDigest,
					content: normalized,
				})
				.onConflictDoNothing()
				.returning();
			if (created) return created;
			const concurrentSameContent = await target
				.select()
				.from(finalResponseEvidence)
				.where(
					and(
						eq(finalResponseEvidence.runId, input.runId),
						eq(finalResponseEvidence.contentDigest, contentDigest),
					),
				)
				.orderBy(desc(finalResponseEvidence.revision));
			const concurrentMatchingBinding = concurrentSameContent.find(
				(item) =>
					item.subjectId === currentSubjectId &&
					item.bindingStatus ===
						(subject?.bindingStatus === "canonical"
							? "canonical"
							: "legacy_unbound"),
			);
			if (concurrentMatchingBinding) return concurrentMatchingBinding;
		}
		throw new Error("Failed to append Final Response Evidence");
	};
	return database === db ? db.transaction(persist) : persist(database);
}

export async function getLatestFinalResponseEvidence(runId: string) {
	const [evidence] = await db
		.select()
		.from(finalResponseEvidence)
		.where(eq(finalResponseEvidence.runId, runId))
		.orderBy(desc(finalResponseEvidence.revision));
	return evidence ?? null;
}
