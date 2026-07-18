import type { AgentRuntimeResult } from "../codingAgent";
import * as repo from "../nightworkers/nightworkers.repository";
import * as reviewRepo from "./review-mode.repository";

type ReviewRunSnapshot = {
	reviewSessionId?: string;
	reviewedRunId?: string;
	options?: unknown;
	targetSummary?: unknown;
};

export async function finalizeReviewRunFromRuntime(input: {
	runId: string;
	taskId: string;
	status:
		| "completed"
		| "needs_review"
		| "needs_human"
		| "failed"
		| "blocked"
		| "timed_out"
		| "cancelled";
	contextSnapshot: unknown;
	runtimeResult: AgentRuntimeResult;
}) {
	const reviewRun = readReviewRunSnapshot(input.contextSnapshot);
	if (!reviewRun?.reviewSessionId || !reviewRun.reviewedRunId) return;
	const session = await reviewRepo.getReviewSession(reviewRun.reviewSessionId);
	if (!session) return;
	const findings = parseReviewRunFindings(
		input.runtimeResult.finalReport || "",
	);
	if (findings.length > 0) {
		await reviewRepo.createReviewFindings(
			findings.map((finding) => ({
				reviewSessionId: session.id,
				runId: session.runId,
				taskId: session.taskId,
				severity: finding.severity,
				title: finding.title,
				body: finding.body,
				evidenceRefsJson: finding.path
					? [{ kind: "changed_file", path: finding.path }]
					: [],
				sourceSection: "review_run",
			})),
		);
	}
	const existing = (
		await reviewRepo.listReviewArtifacts(reviewRun.reviewSessionId)
	).find((artifact) => artifact.kind === "review_run");
	const existingPayload =
		existing?.artifactJson &&
		typeof existing.artifactJson === "object" &&
		!Array.isArray(existing.artifactJson)
			? (existing.artifactJson as Record<string, unknown>)
			: {};
	await reviewRepo.upsertReviewArtifact({
		reviewSessionId: session.id,
		runId: session.runId,
		taskId: session.taskId,
		kind: "review_run",
		status: reviewArtifactStatus(input.status),
		artifactJson: {
			...existingPayload,
			status: reviewArtifactStatus(input.status),
			reviewRunId: input.runId,
			finalReport:
				input.runtimeResult.finalReport || input.runtimeResult.summary,
			findings,
			fixesApplied: false,
		},
		sourceEvidenceRefsJson: [],
	});
	await repo.createRunEvent({
		version: 1,
		runId: session.runId,
		taskId: session.taskId,
		timestamp: new Date().toISOString(),
		type: "review.run_completed",
		severity:
			reviewArtifactStatus(input.status) === "done" ? "info" : "warning",
		actor: "system",
		message: `Review Run finished with status: ${reviewArtifactStatus(input.status)}.`,
		data: {
			reviewSessionId: session.id,
			reviewRunId: input.runId,
			reviewedRunId: reviewRun.reviewedRunId,
			status: reviewArtifactStatus(input.status),
			findingCount: findings.length,
			fixesApplied: false,
		},
	});
	const correctionRequested =
		!hasMissionPilotContext(input.contextSnapshot) &&
		readReviewApplyFixes(reviewRun.options) &&
		findings.some((finding) => finding.severity !== "info");
	if (!correctionRequested) return;
	const correctionMessage = buildCorrectionRequestMessage({
		reviewSessionId: session.id,
		reviewRunId: input.runId,
		reviewedRunId: reviewRun.reviewedRunId,
		findings,
	});
	try {
		await repo.createTaskMessage({
			taskId: input.taskId,
			runId: null,
			role: "user",
			content: correctionMessage,
			messageType: "review_correction_request",
			payloadJson: {
				kind: "review_correction_request",
				reviewSessionId: session.id,
				reviewRunId: input.runId,
				findings,
			},
		});
		const { startTaskRun } = await import(
			"../nightworkers/run-orchestration/start-task-run-entry"
		);
		const correctionRun = await startTaskRun(input.taskId, {
			executionMode: "implementation",
			executionModeSource: "review_run",
			latestUserMessageOverride: correctionMessage,
			runtimeOptionsPatch: {
				reviewCorrection: {
					mode: "implementation_session",
					phase: "implementation",
					cycle: readReviewCorrectionCycle(input.contextSnapshot) + 1,
					applyFixes: readReviewApplyFixes(reviewRun.options),
					commitChanges: readReviewCommitChanges(reviewRun.options),
					reviewSessionId: session.id,
					sourceReviewRunId: input.runId,
					fromReviewSessionId: session.id,
					fromReviewRunId: input.runId,
					findingCount: findings.length,
				},
			},
		});
		await repo.createRunEvent({
			version: 1,
			runId: input.runId,
			taskId: input.taskId,
			timestamp: new Date().toISOString(),
			type: "review.correction_requested",
			severity: "info",
			actor: "system",
			message:
				"Accepted Review findings were handed off to a new Implementation Session.",
			data: {
				reviewSessionId: session.id,
				reviewRunId: input.runId,
				correctionRunId: correctionRun?.id ?? null,
				correctionMode: "implementation_session",
				findingCount: findings.length,
			},
		});
	} catch (error) {
		await repo.createRunEvent({
			version: 1,
			runId: input.runId,
			taskId: input.taskId,
			timestamp: new Date().toISOString(),
			type: "review.correction_requested",
			severity: "error",
			actor: "system",
			message: "Review correction handoff could not start.",
			data: {
				reviewSessionId: session.id,
				correctionMode: "implementation_session",
				findingCount: findings.length,
				error: error instanceof Error ? error.message : String(error),
			},
		});
	}
}

function readReviewApplyFixes(value: unknown) {
	return readReviewBooleanOption(value, "applyFixes");
}

function readReviewCommitChanges(value: unknown) {
	return readReviewBooleanOption(value, "commitChanges");
}

function readReviewBooleanOption(
	value: unknown,
	key: "applyFixes" | "commitChanges",
) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const nested = record.options;
	const options =
		nested && typeof nested === "object" && !Array.isArray(nested)
			? (nested as Record<string, unknown>)
			: record;
	return options[key] === true;
}

function readReviewCorrectionCycle(contextSnapshot: unknown) {
	if (
		!contextSnapshot ||
		typeof contextSnapshot !== "object" ||
		Array.isArray(contextSnapshot)
	) {
		return 0;
	}
	const correction = (contextSnapshot as Record<string, unknown>)
		.reviewCorrection;
	if (
		!correction ||
		typeof correction !== "object" ||
		Array.isArray(correction)
	) {
		return 0;
	}
	const cycle = (correction as Record<string, unknown>).cycle;
	return typeof cycle === "number" && Number.isInteger(cycle) && cycle >= 0
		? cycle
		: 0;
}

function hasMissionPilotContext(contextSnapshot: unknown) {
	if (
		!contextSnapshot ||
		typeof contextSnapshot !== "object" ||
		Array.isArray(contextSnapshot)
	) {
		return false;
	}
	const missionPilot = (contextSnapshot as Record<string, unknown>)
		.missionPilot;
	return Boolean(
		missionPilot &&
			typeof missionPilot === "object" &&
			!Array.isArray(missionPilot),
	);
}

function buildCorrectionRequestMessage(input: {
	reviewSessionId: string;
	reviewRunId: string;
	reviewedRunId: string;
	findings: Array<{
		severity: "blocking" | "warning" | "info";
		title: string;
		body: string | null;
		path: string | null;
	}>;
}) {
	return [
		"Review correction request: execute this work in a new Implementation Session.",
		`reviewSessionId=${input.reviewSessionId}`,
		`reviewRunId=${input.reviewRunId}`,
		`reviewedRunId=${input.reviewedRunId}`,
		"Accepted findings:",
		...input.findings
			.filter((finding) => finding.severity !== "info")
			.map(
				(finding) =>
					`- [${finding.severity}] ${finding.title}${finding.path ? ` (${finding.path})` : ""}: ${finding.body ?? ""}`,
			),
		"Review provider history, reasoning, and tool transcript are not handoff inputs. Use only these findings plus persisted artifacts/evidence and current repository state.",
	].join("\n");
}

export function parseReviewRunFindings(text: string): Array<{
	severity: "blocking" | "warning" | "info";
	title: string;
	body: string | null;
	path: string | null;
}> {
	const jsonFindings = parseJsonFindings(text);
	if (jsonFindings.length > 0) return jsonFindings;
	const findings: Array<{
		severity: "blocking" | "warning" | "info";
		title: string;
		body: string | null;
		path: string | null;
	}> = [];
	for (const line of text.split("\n")) {
		const match =
			/^\s*[-*]\s*\[(blocking|warning|info)\]\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/i.exec(
				line,
			);
		if (!match) continue;
		findings.push({
			severity: match[1].toLowerCase() as "blocking" | "warning" | "info",
			title: match[2].trim(),
			body: null,
			path: match[3]?.trim() || null,
		});
	}
	return findings;
}

function readReviewRunSnapshot(
	contextSnapshot: unknown,
): ReviewRunSnapshot | null {
	if (!contextSnapshot || typeof contextSnapshot !== "object") return null;
	const reviewRun = (contextSnapshot as Record<string, unknown>).reviewRun;
	if (!reviewRun || typeof reviewRun !== "object" || Array.isArray(reviewRun)) {
		return null;
	}
	return reviewRun as ReviewRunSnapshot;
}

function reviewArtifactStatus(
	status:
		| "completed"
		| "needs_review"
		| "needs_human"
		| "failed"
		| "blocked"
		| "timed_out"
		| "cancelled",
) {
	if (status === "completed" || status === "needs_review") return "done";
	if (status === "needs_human") return "needs_human";
	return "failed";
}

function parseJsonFindings(text: string) {
	const candidates = [
		...text.matchAll(/```json\s*([\s\S]*?)```/g),
		...text.matchAll(/```\s*([\s\S]*?)```/g),
	].map((match) => match[1]);
	if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
		candidates.unshift(text.trim());
	}
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			const values = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.findings)
					? parsed.findings
					: [];
			const findings = values.map(normalizeFinding).filter(Boolean);
			if (findings.length > 0) return findings;
		} catch {}
	}
	return [];
}

function normalizeFinding(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	const severity =
		record.severity === "blocking" ||
		record.severity === "warning" ||
		record.severity === "info"
			? record.severity
			: null;
	const title =
		typeof record.title === "string"
			? record.title.trim()
			: typeof record.category === "string"
				? record.category.trim()
				: "";
	if (!severity || !title) return null;
	return {
		severity,
		title,
		body:
			typeof record.body === "string"
				? record.body
				: typeof record.evidence === "string"
					? [
							record.evidence,
							typeof record.recommendedAction === "string"
								? record.recommendedAction
								: null,
						]
							.filter(Boolean)
							.join("\n")
					: null,
		path:
			typeof record.path === "string"
				? record.path
				: typeof record.file === "string"
					? record.file
					: null,
	};
}
