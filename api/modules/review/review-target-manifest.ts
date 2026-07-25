import { AppError } from "../../lib/errors";
import { digestText } from "../../services/text-digest";
import * as repo from "../nightworkers/nightworkers.repository";
import type { ReviewTarget, ReviewTargetManifest } from "./review-mode.model";

export type ReviewTargetManifestContext = {
	contextDigest: string;
	verificationSnapshotId: string;
	verificationSnapshotDigest: string;
	sourceRuns: Array<{
		runId: string;
		role: "implementation";
	}>;
};

export async function buildReviewTargetManifest(input: {
	target: ReviewTarget;
	context?: ReviewTargetManifestContext | null;
}): Promise<ReviewTargetManifest> {
	const requestedSources = input.context?.sourceRuns ?? [
		{ runId: input.target.runId, role: "implementation" as const },
	];
	const sourceRuns: ReviewTargetManifest["sourceRuns"] = [];
	for (const source of requestedSources) {
		const run = await repo.getTaskRun(source.runId);
		if (!run || run.taskId !== input.target.taskId) {
			throw new AppError(
				409,
				"REVIEW_TARGET_SOURCE_MISMATCH",
				"Review target source run is missing or belongs to another task.",
			);
		}
		sourceRuns.push({
			runId: run.id,
			role: source.role,
			status: run.status,
			diffDigest: digestText(run.diffPatch ?? ""),
			finalReportDigest: digestText(run.finalReport ?? ""),
		});
	}
	const unsigned = {
		version: 2 as const,
		taskId: input.target.taskId,
		contextDigest: input.context?.contextDigest ?? null,
		verificationSnapshotId: input.context?.verificationSnapshotId ?? null,
		verificationSnapshotDigest:
			input.context?.verificationSnapshotDigest ?? null,
		sourceRuns,
		targetFiles: input.target.targetFiles
			.map((file) => ({
				path: file.path,
				diffDigest: digestText(file.diff),
				diffBytes: file.diffBytes,
			}))
			.sort((left, right) => left.path.localeCompare(right.path)),
	};
	return {
		...unsigned,
		digest: digestText(JSON.stringify(unsigned)),
	};
}

export function readReviewTargetManifest(
	contextSnapshot: unknown,
): ReviewTargetManifest | null {
	const context = record(contextSnapshot);
	const reviewRun = record(context.reviewRun);
	const manifest = record(reviewRun.targetManifest);
	if (manifest.version !== 2 || typeof manifest.digest !== "string")
		return null;
	const unsigned = parseUnsignedManifest(manifest);
	if (!unsigned || digestText(JSON.stringify(unsigned)) !== manifest.digest)
		return null;
	return { ...unsigned, digest: manifest.digest };
}

function parseUnsignedManifest(
	manifest: Record<string, unknown>,
): Omit<ReviewTargetManifest, "digest"> | null {
	if (
		typeof manifest.taskId !== "string" ||
		!nullableString(manifest.contextDigest) ||
		!nullableString(manifest.verificationSnapshotId) ||
		!nullableString(manifest.verificationSnapshotDigest) ||
		!Array.isArray(manifest.sourceRuns) ||
		!Array.isArray(manifest.targetFiles)
	)
		return null;
	const sourceRuns = manifest.sourceRuns.map(record);
	const targetFiles = manifest.targetFiles.map(record);
	if (
		sourceRuns.some(
			(source) =>
				typeof source.runId !== "string" ||
				source.role !== "implementation" ||
				typeof source.status !== "string" ||
				typeof source.diffDigest !== "string" ||
				typeof source.finalReportDigest !== "string",
		) ||
		targetFiles.some(
			(file) =>
				typeof file.path !== "string" ||
				typeof file.diffDigest !== "string" ||
				typeof file.diffBytes !== "number" ||
				!Number.isFinite(file.diffBytes),
		)
	)
		return null;
	return {
		version: 2,
		taskId: manifest.taskId,
		contextDigest: manifest.contextDigest as string | null,
		verificationSnapshotId: manifest.verificationSnapshotId as string | null,
		verificationSnapshotDigest: manifest.verificationSnapshotDigest as
			| string
			| null,
		sourceRuns: sourceRuns as ReviewTargetManifest["sourceRuns"],
		targetFiles: targetFiles as ReviewTargetManifest["targetFiles"],
	};
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
