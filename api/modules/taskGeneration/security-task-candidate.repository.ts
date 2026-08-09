import crypto from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { type DbTransaction, db } from "../../db/client";
import {
	missionTaskCandidateBatches,
	missionTaskCandidates,
	securityTaskCandidateFindings,
} from "../../db/task-generation-schema";
import { mapCandidate } from "./task-generation.repository";

type SecurityCandidateInsert = {
	candidates: Array<typeof missionTaskCandidates.$inferInsert>;
	links: Array<{
		candidateId: string;
		repositoryId: string;
		scanRunRef: string;
		findingRef: string;
		fingerprintHash: string;
	}>;
};

export function createSecurityScanCandidates(input: SecurityCandidateInsert) {
	return db.transaction((tx) => insertSecurityScanCandidates(input, tx));
}

export function completeSecurityScanCandidateGeneration(
	input: SecurityCandidateInsert & {
		batchId: string;
		rawOutput: unknown;
		selectedModel: unknown;
	},
) {
	return db.transaction(async (tx) => {
		const candidates = await insertSecurityScanCandidates(input, tx);
		const [batch] = await tx
			.update(missionTaskCandidateBatches)
			.set({
				status: "completed",
				rawOutputJson: input.rawOutput,
				selectedModelJson: input.selectedModel,
				completedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(missionTaskCandidateBatches.id, input.batchId))
			.returning({ id: missionTaskCandidateBatches.id });
		if (!batch) {
			throw new Error(`Task candidate batch not found: ${input.batchId}`);
		}
		return candidates;
	});
}

export function listActiveSecurityFindingMatches(input: {
	repositoryId: string;
	fingerprintHashes: string[];
}) {
	if (input.fingerprintHashes.length === 0) return [];
	return db
		.select({
			candidateId: securityTaskCandidateFindings.candidateId,
			findingRef: securityTaskCandidateFindings.findingRef,
			fingerprintHash: securityTaskCandidateFindings.fingerprintHash,
			taskId: missionTaskCandidates.taskId,
		})
		.from(securityTaskCandidateFindings)
		.innerJoin(
			missionTaskCandidates,
			eq(missionTaskCandidates.id, securityTaskCandidateFindings.candidateId),
		)
		.where(
			and(
				eq(securityTaskCandidateFindings.repositoryId, input.repositoryId),
				inArray(
					securityTaskCandidateFindings.fingerprintHash,
					input.fingerprintHashes,
				),
				inArray(missionTaskCandidates.status, [
					"candidate",
					"selected",
					"task_created",
				]),
			),
		);
}

async function insertSecurityScanCandidates(
	input: SecurityCandidateInsert,
	database: DbTransaction,
) {
	const candidateRepositories = new Map(
		input.candidates.map((candidate) => [candidate.id, candidate.repositoryId]),
	);
	for (const candidate of input.candidates) {
		if (candidate.sourceKind !== "security_scan") {
			throw new Error(
				`Security candidate has an invalid source: ${candidate.id}`,
			);
		}
	}
	for (const link of input.links) {
		if (candidateRepositories.get(link.candidateId) !== link.repositoryId) {
			throw new Error(
				`Security candidate link does not match its candidate: ${link.candidateId}`,
			);
		}
	}
	const rows =
		input.candidates.length > 0
			? await database
					.insert(missionTaskCandidates)
					.values(input.candidates)
					.returning()
			: [];
	if (input.links.length > 0) {
		const now = new Date();
		await database.insert(securityTaskCandidateFindings).values(
			input.links.map((link) => ({
				id: crypto.randomUUID(),
				createdAt: now,
				updatedAt: now,
				...link,
			})),
		);
	}
	return rows.map((row) => mapCandidate(row));
}
