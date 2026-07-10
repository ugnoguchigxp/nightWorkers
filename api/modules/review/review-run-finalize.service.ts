import type { AgentRuntimeResult } from "../../services/agent-runtime/types";
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
			fixesApplied: Boolean(input.runtimeResult.diffPatch?.trim()),
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
			fixesApplied: Boolean(input.runtimeResult.diffPatch?.trim()),
		},
	});
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
	const title = typeof record.title === "string" ? record.title.trim() : "";
	if (!severity || !title) return null;
	return {
		severity,
		title,
		body: typeof record.body === "string" ? record.body : null,
		path: typeof record.path === "string" ? record.path : null,
	};
}
