import crypto from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { MissionPilotRunOutcome } from "../../../shared/schemas/mission-pilot-agent.schema";
import { db } from "../../db/client";
import {
	nativeApiTurns,
	taskRunCommitRecords,
	taskRuns,
} from "../../db/schema";
import {
	verificationEvidenceCases,
	verificationEvidenceRuns,
} from "../../db/verification-schema";

export type PublicRunOutcome = MissionPilotRunOutcome;

export async function readPublicRunOutcome(
	runId: string,
): Promise<PublicRunOutcome | null> {
	const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, runId));
	if (!run) return null;
	const [terminalNativeTurn] = await db
		.select()
		.from(nativeApiTurns)
		.where(
			and(
				eq(nativeApiTurns.runId, runId),
				inArray(nativeApiTurns.status, ["completed", "failed", "cancelled"]),
			),
		)
		.orderBy(desc(nativeApiTurns.turnIndex))
		.limit(1);
	const judgment = asRecord(run.finalJudgment);
	const context = asRecord(run.contextSnapshot);
	const nativeAssistant = terminalNativeTurn
		? lastAssistantContent(terminalNativeTurn.historyJson)
		: null;
	const finalReport = nativeAssistant ?? nonEmpty(run.finalReport);
	const blockerRecord = asRecord(judgment.blocker);
	const blockerMessage =
		nonEmpty(blockerRecord.message) ?? nonEmpty(judgment.blockerMessage);
	const verificationSummary =
		nonEmpty(judgment.verificationSummary) ??
		nonEmpty(asRecord(run.testResults).summary);
	return {
		runId: run.id,
		executionMode:
			nonEmpty(context.executionMode) ?? nonEmpty(judgment.executionMode),
		terminalState: run.status,
		finalReport,
		blocker: blockerMessage
			? {
					code: nonEmpty(blockerRecord.code) ?? nonEmpty(judgment.blockerCode),
					message: blockerMessage,
				}
			: null,
		verificationSummary,
		artifactRefs: readArtifactRefs(judgment.artifactRefs),
		completedAt: (run.finishedAt ?? run.endedAt)?.toISOString() ?? null,
		diagnostic: terminalNativeTurn?.errorJson ?? null,
	};
}

export async function readPublicRunChangeSummary(runId: string) {
	const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, runId));
	if (!run) return null;
	const [commitRecord] = await db
		.select()
		.from(taskRunCommitRecords)
		.where(eq(taskRunCommitRecords.runId, runId));
	const patch = run.diffPatch ?? "";
	const paths = commitRecord?.ownedCandidatePathsJson?.length
		? commitRecord.ownedCandidatePathsJson
		: changedPathsFromPatch(patch);
	let additions = 0;
	let deletions = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		if (line.startsWith("-") && !line.startsWith("---")) deletions++;
	}
	return {
		runId,
		changedFiles: paths,
		fileCount: paths.length,
		additions,
		deletions,
		diffDigest: patch
			? `sha256:${crypto.createHash("sha256").update(patch).digest("hex")}`
			: null,
		stageableOwnedPaths: commitRecord?.stageableOwnedPathsJson ?? [],
		excludedPaths: commitRecord?.excludedPathsJson ?? [],
		gitStatus: commitRecord?.status ?? "not_recorded",
		commitSha: commitRecord?.commitSha ?? null,
	};
}

export async function readPublicRunVerification(
	runId: string,
	options: { cursor?: number; limit?: number } = {},
) {
	const [run] = await db.select().from(taskRuns).where(eq(taskRuns.id, runId));
	if (!run) return null;
	const evidence = await db
		.select()
		.from(verificationEvidenceRuns)
		.where(eq(verificationEvidenceRuns.runId, runId))
		.orderBy(verificationEvidenceRuns.startedAt);
	const cursor = Math.max(0, options.cursor ?? 0);
	const limit = Math.min(50, Math.max(1, options.limit ?? 20));
	const pageRows = evidence.slice(cursor, cursor + limit);
	const cases = pageRows.length
		? await db
				.select()
				.from(verificationEvidenceCases)
				.where(
					inArray(
						verificationEvidenceCases.evidenceRunId,
						pageRows.map((row) => row.id),
					),
				)
		: [];
	return {
		runId,
		verificationSummary:
			nonEmpty(asRecord(run.finalJudgment).verificationSummary) ??
			nonEmpty(asRecord(run.testResults).summary),
		commands: pageRows.map((row) => {
			const commandCases = cases.filter(
				(item) => item.evidenceRunId === row.id,
			);
			return {
				evidenceRunId: row.id,
				checkKind: row.checkKind,
				command: row.command,
				cwd: row.cwd,
				exitCode: row.exitCode,
				durationMs: row.finishedAt.getTime() - row.startedAt.getTime(),
				testCounts: countCaseStatuses(commandCases),
				summary: row.summaryJson,
				artifactRefs: {
					stdout: row.rawStdoutArtifactId,
					stderr: row.rawStderrArtifactId,
					parsed: row.parsedArtifactId,
				},
				failures: commandCases
					.filter((item) => item.status === "failed")
					.map((item) => ({
						name: item.name,
						filePath: item.filePath,
						message: item.failureMessage,
					})),
			};
		}),
		page: {
			cursor,
			count: pageRows.length,
			total: evidence.length,
			nextCursor:
				cursor + pageRows.length < evidence.length
					? cursor + pageRows.length
					: null,
		},
	};
}

function changedPathsFromPatch(patch: string) {
	const paths = new Set<string>();
	for (const line of patch.split("\n")) {
		if (!line.startsWith("diff --git a/")) continue;
		const marker = " b/";
		const index = line.indexOf(marker);
		if (index >= 0) paths.add(line.slice(index + marker.length));
	}
	return [...paths];
}

function countCaseStatuses(cases: Array<{ status: string }>) {
	return cases.reduce<Record<string, number>>((counts, item) => {
		counts[item.status] = (counts[item.status] ?? 0) + 1;
		return counts;
	}, {});
}

function lastAssistantContent(history: unknown) {
	if (!Array.isArray(history)) return null;
	for (let index = history.length - 1; index >= 0; index--) {
		const item = asRecord(history[index]);
		if (item.type !== "assistant") continue;
		const content = nonEmpty(item.content);
		if (content) return content;
	}
	return null;
}

function readArtifactRefs(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const record = asRecord(item);
		const kind = nonEmpty(record.kind);
		const id = nonEmpty(record.id);
		return kind && id ? [{ kind, id }] : [];
	});
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function nonEmpty(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}
