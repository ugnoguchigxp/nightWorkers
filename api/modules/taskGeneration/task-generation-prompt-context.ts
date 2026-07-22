import crypto from "node:crypto";
import type { ProjectSignalSnapshot } from "../../../shared/schemas/task-generation.schema";

export type TaskGenerationPromptStage =
	| "estimate"
	| "task_candidates"
	| "mission_plans";

function digestJson(value: unknown) {
	return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function boundedText(value: string | null, maxChars: number) {
	if (!value || value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n...[truncated; canonicalDigest=${digestJson(value)}]`;
}

function compactJsonValue(value: unknown, maxChars: number) {
	if (value === null || value === undefined) return null;
	const serialized = JSON.stringify(value);
	if (serialized.length <= maxChars) return value;
	return {
		truncated: true,
		canonicalDigest: digestJson(value),
		preview: serialized.slice(0, maxChars),
	};
}

export function buildTaskGenerationSystemContext(
	signal: ProjectSignalSnapshot,
) {
	return {
		schemaVersion: "nightworkers.task-generation-system-context/v1",
		implementation: signal.implementationContext ?? { source: "unavailable" },
		moduleOntology: signal.repositorySnapshot?.moduleOntology ?? null,
		canonicalSignalDigest: digestJson(signal),
	};
}

export function buildTaskGenerationPromptSignal(
	signal: ProjectSignalSnapshot,
	stage: TaskGenerationPromptStage,
) {
	const snapshot = signal.repositorySnapshot;
	const llmContextIsPrimary =
		signal.implementationContext?.source === "llm_context";
	const estimateOnly = stage === "estimate";
	const sourceExcerptLimit = estimateOnly ? 4 : 8;
	const sourceExcerptChars = estimateOnly ? 900 : 1_200;
	const diffLimit = estimateOnly ? 1 : 2;
	const diffChars = estimateOnly ? 2_000 : 3_000;

	return {
		schemaVersion: "nightworkers.task-generation-prompt-signal/v1",
		stage,
		canonicalSignalDigest: digestJson(signal),
		repository: {
			id: signal.repository.id,
			name: signal.repository.name,
			branch: signal.repository.branch,
		},
		activeGoals: signal.activeGoals,
		latestEvaluation: signal.latestEvaluation
			? {
					overallScore: signal.latestEvaluation.overallScore,
					dimensions: signal.latestEvaluation.dimensions,
					summary: boundedText(signal.latestEvaluation.summary, 800),
				}
			: null,
		latestQuality: {
			coverage: compactJsonValue(signal.latestQuality.coverage, 1_000),
			e2e: compactJsonValue(signal.latestQuality.e2e, 1_000),
		},
		repositorySnapshot: snapshot
			? {
					packageName: snapshot.packageName,
					description: snapshot.description,
					readmeExcerpt: llmContextIsPrimary
						? null
						: boundedText(snapshot.readmeExcerpt, estimateOnly ? 1_000 : 2_000),
					sourceFiles: snapshot.sourceFiles.slice(0, estimateOnly ? 30 : 60),
					routeFiles: snapshot.routeFiles.slice(0, estimateOnly ? 20 : 40),
					migrationFiles: snapshot.migrationFiles.slice(
						0,
						estimateOnly ? 10 : 20,
					),
					sourceExcerpts: llmContextIsPrimary
						? []
						: snapshot.sourceExcerpts
								.slice(0, sourceExcerptLimit)
								.map((item) => ({
									path: item.path,
									excerpt: boundedText(item.excerpt, sourceExcerptChars),
								})),
					recentCommitDiffs: llmContextIsPrimary
						? []
						: snapshot.recentCommitDiffs.slice(0, diffLimit).map((item) => ({
								hash: item.hash,
								subject: item.subject,
								diffExcerpt: boundedText(item.diffExcerpt, diffChars),
							})),
					packageScripts: snapshot.packageScripts.slice(0, 24),
					omittedCounts: {
						sourceFiles: Math.max(
							0,
							snapshot.sourceFiles.length - (estimateOnly ? 30 : 60),
						),
						routeFiles: Math.max(
							0,
							snapshot.routeFiles.length - (estimateOnly ? 20 : 40),
						),
						migrationFiles: Math.max(
							0,
							snapshot.migrationFiles.length - (estimateOnly ? 10 : 20),
						),
						sourceExcerpts: Math.max(
							0,
							snapshot.sourceExcerpts.length - sourceExcerptLimit,
						),
						recentCommitDiffs: Math.max(
							0,
							snapshot.recentCommitDiffs.length - diffLimit,
						),
					},
				}
			: null,
		qualityCapabilities: signal.qualityCapabilities,
	};
}
