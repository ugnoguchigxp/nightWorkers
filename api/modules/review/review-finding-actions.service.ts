import { AppError, NotFoundError } from "../../lib/errors";
import type { ReviewEvidenceRef } from "./results/types";
import {
	type ReviewFindingDisposition,
	rowPromptSuggestion,
} from "./review-mode.model";
import * as reviewRepo from "./review-mode.repository";
import { getReviewSessionDetail } from "./review-mode.service";

export async function setReviewFindingDisposition(
	reviewSessionId: string,
	findingId: string,
	input: {
		disposition: ReviewFindingDisposition;
		note?: string;
		evidenceRefs?: ReviewEvidenceRef[];
	},
) {
	const finding = await reviewRepo.getReviewFinding(reviewSessionId, findingId);
	if (!finding) throw new NotFoundError("Review finding not found");
	if (["accepted_risk", "ignored"].includes(input.disposition)) {
		if (!input.note?.trim()) {
			throw new AppError(
				400,
				"FINDING_DISPOSITION_NOTE_REQUIRED",
				"Accepted risk and dismissed findings require a note",
			);
		}
	}
	if (input.disposition === "accepted_risk") {
		const refs = input.evidenceRefs?.length
			? input.evidenceRefs
			: finding.evidenceRefsJson;
		if (!Array.isArray(refs) || refs.length === 0) {
			throw new AppError(
				400,
				"ACCEPTED_RISK_EVIDENCE_REQUIRED",
				"Accepted risk requires evidence refs",
			);
		}
	}
	const status =
		input.disposition === "accepted_risk"
			? "accepted"
			: input.disposition === "ignored"
				? "dismissed"
				: [
							"agent_followup",
							"prompt_suggestion",
							"security_plugin_handoff",
						].includes(input.disposition)
					? "converted"
					: "accepted";
	if (input.disposition === "prompt_suggestion") {
		const promptSuggestion = await ensureReviewPromptSuggestion(
			finding,
			input.evidenceRefs,
		);
		await reviewRepo.updateReviewFindingDisposition(finding.id, {
			disposition: input.disposition,
			dispositionStatus: status,
			dispositionNote: input.note?.trim() || null,
			evidenceRefsJson: input.evidenceRefs?.length
				? input.evidenceRefs
				: undefined,
			createdGoalId: promptSuggestion.id,
		});
		return getReviewSessionDetail(reviewSessionId);
	}
	if (input.disposition === "security_plugin_handoff") {
		await ensureReviewSecurityHandoff(finding, input.evidenceRefs);
		await reviewRepo.updateReviewFindingDisposition(finding.id, {
			disposition: input.disposition,
			dispositionStatus: status,
			dispositionNote: input.note?.trim() || null,
			evidenceRefsJson: input.evidenceRefs?.length
				? input.evidenceRefs
				: undefined,
		});
		return getReviewSessionDetail(reviewSessionId);
	}
	await reviewRepo.updateReviewFindingDisposition(findingId, {
		disposition: input.disposition,
		dispositionStatus: status,
		dispositionNote: input.note?.trim() || null,
		evidenceRefsJson: input.evidenceRefs?.length
			? input.evidenceRefs
			: undefined,
	});
	return getReviewSessionDetail(reviewSessionId);
}

function findingEvidenceRefs(
	finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>,
) {
	return Array.isArray(finding.evidenceRefsJson)
		? (finding.evidenceRefsJson as ReviewEvidenceRef[])
		: [];
}

async function ensureReviewPromptSuggestion(
	finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>,
	evidenceRefsOverride?: ReviewEvidenceRef[],
) {
	const evidenceRefs = evidenceRefsOverride?.length
		? evidenceRefsOverride
		: findingEvidenceRefs(finding);
	if (evidenceRefs.length === 0) {
		throw new AppError(
			400,
			"REVIEW_PROMPT_SUGGESTION_EVIDENCE_REQUIRED",
			"Review prompt suggestions require evidence refs",
		);
	}
	const session = await reviewRepo.getReviewSession(finding.reviewSessionId);
	if (!session) throw new NotFoundError("Review session not found");
	const existing = await reviewRepo.getReviewPromptSuggestionByFinding(
		finding.id,
	);
	if (isTestEvidenceFinding(finding.title)) {
		const prompt = buildTestEvidencePromptSuggestionText(finding);
		const expectedOutcome =
			"受け入れ条件に対応するテスト証跡が分かる、または focused test が追加されている。";
		const acceptanceCriteria =
			"該当する受け入れ条件について、test / it / describe 名または test body から対応関係を確認できる。";
		const verificationHint = "関連する focused test を実行する。";
		const created = await reviewRepo.createReviewPromptSuggestion({
			reviewSessionId: finding.reviewSessionId,
			findingId: finding.id,
			runId: finding.runId,
			taskId: finding.taskId,
			repositoryId: session.repositoryId,
			title: `改善依頼 Prompt: ${testEvidencePromptTitle(finding.title)}`,
			prompt,
			expectedOutcome,
			acceptanceCriteria,
			verificationHint,
			evidenceRefsJson: evidenceRefs,
		});
		return existing ?? created;
	}
	const expectedOutcome = finding.body || finding.title;
	const acceptanceCriteria =
		"The cited review finding is resolved or explicitly re-routed.";
	const verificationHint =
		"Run the focused verification relevant to the finding.";
	const created = await reviewRepo.createReviewPromptSuggestion({
		reviewSessionId: finding.reviewSessionId,
		findingId: finding.id,
		runId: finding.runId,
		taskId: finding.taskId,
		repositoryId: session.repositoryId,
		title: `追加対応: ${finding.title}`,
		prompt: buildPromptSuggestionText({
			title: finding.title,
			body: finding.body,
			acceptanceCriteria,
			verificationHint,
		}),
		expectedOutcome,
		acceptanceCriteria,
		verificationHint,
		evidenceRefsJson: evidenceRefs,
	});
	return existing ?? created;
}

function isTestEvidenceFinding(title: string) {
	return (
		title.startsWith("Test evidence not confirmed for acceptance criterion") ||
		title.startsWith(
			"Test evidence review is unclear for acceptance criterion",
		) ||
		title === "Agentic test evidence review could not complete"
	);
}

function testEvidencePromptTitle(title: string) {
	if (title.startsWith("Test evidence review is unclear")) {
		return "受け入れ条件のテスト証跡が判断不能です";
	}
	if (title.startsWith("Test evidence not confirmed")) {
		return "受け入れ条件のテスト証跡を確認できません";
	}
	return "テスト証跡確認を完了できません";
}

function extractCriterionFromFinding(finding: {
	title: string;
	body: string | null;
}) {
	const bodyMatch = /^受け入れ条件:\s*(.+)$/m.exec(finding.body ?? "");
	if (bodyMatch?.[1]) return bodyMatch[1].trim();
	const titleMatch = /acceptance criterion:\s*(.+)$/i.exec(finding.title);
	return titleMatch?.[1]?.trim() || finding.title;
}

function extractCheckedScopeFromFinding(body: string | null) {
	if (!body) return ["Review Mode の test evidence section が作成した指摘。"];
	const lines = body.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim() === "確認した範囲:");
	if (start < 0) return [body];
	const scoped = lines
		.slice(start + 1)
		.filter((line) => line.trim().startsWith("- "));
	return scoped.length
		? scoped
		: ["確認範囲の詳細は review finding を参照してください。"];
}

function buildTestEvidencePromptSuggestionText(finding: {
	title: string;
	body: string | null;
}) {
	const criterion = extractCriterionFromFinding(finding);
	const checkedScope = extractCheckedScopeFromFinding(finding.body);
	return [
		"次の受け入れ条件に対応するテスト証跡を確認できませんでした。",
		"",
		"受け入れ条件:",
		`- ${criterion}`,
		"",
		"確認した範囲:",
		...checkedScope.map((line) =>
			line.trim().startsWith("- ") ? line : `- ${line}`,
		),
		"",
		"既存テストがある場合は test / it / describe 名や test body から対応関係を分かるようにしてください。",
		"対応テストがない場合は、該当条件を検証する focused test を追加してください。",
	].join("\n");
}

function buildPromptSuggestionText(input: {
	title: string;
	body: string | null;
	acceptanceCriteria: string;
	verificationHint: string;
}) {
	return [
		"次のレビュー指摘を解消するため、この session の作業を続けてください。",
		"",
		`指摘: ${input.title}`,
		"",
		`背景: ${input.body?.trim() || input.title}`,
		"",
		"やること:",
		"- 関連する証跡と差分を確認する",
		"- 必要な追加実装または追加修正を行う",
		"- focused verification を実行する",
		"- 結果をこの session に報告する",
		"",
		`完了条件: ${input.acceptanceCriteria}`,
		"",
		`検証: ${input.verificationHint}`,
	].join("\n");
}

function changedPathsFromEvidence(evidenceRefs: ReviewEvidenceRef[]) {
	return evidenceRefs
		.filter(
			(ref): ref is Extract<ReviewEvidenceRef, { kind: "changed_file" }> =>
				ref.kind === "changed_file",
		)
		.map((ref) => ref.path);
}

async function ensureReviewSecurityHandoff(
	finding: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewFinding>>>,
	evidenceRefsOverride?: ReviewEvidenceRef[],
) {
	const session = await reviewRepo.getReviewSession(finding.reviewSessionId);
	if (!session) throw new NotFoundError("Review session not found");
	const evidenceRefs = evidenceRefsOverride?.length
		? evidenceRefsOverride
		: findingEvidenceRefs(finding);
	const changedPaths = changedPathsFromEvidence(evidenceRefs);
	const requestedIntegration =
		process.env.NIGHTWORKERS_SECURITY_PLUGIN_INTEGRATION?.trim() || null;
	const handoffArtifact = {
		version: 1,
		kind: "security_handoff",
		findingId: finding.id,
		title: `Security handoff: ${finding.title}`,
		summary: finding.body || finding.title,
		requestedIntegration,
		status: requestedIntegration ? "requested" : "needs_configuration",
		changedPaths,
		evidenceRefs,
	};
	const handoff = await reviewRepo.createReviewSecurityHandoff({
		reviewSessionId: finding.reviewSessionId,
		findingId: finding.id,
		runId: finding.runId,
		taskId: finding.taskId,
		repositoryId: session.repositoryId,
		title: handoffArtifact.title,
		summary: handoffArtifact.summary,
		requestedIntegration,
		status: handoffArtifact.status,
		changedPathsJson: changedPaths,
		evidenceRefsJson: evidenceRefs,
		handoffArtifactJson: handoffArtifact,
	});
	await reviewRepo.upsertReviewArtifact({
		reviewSessionId: finding.reviewSessionId,
		runId: finding.runId,
		taskId: finding.taskId,
		kind: "security_handoff",
		status: requestedIntegration ? "done" : "needs_human",
		artifactJson: handoffArtifact,
		sourceEvidenceRefsJson: evidenceRefs,
	});
	return handoff;
}

export async function createReviewPromptSuggestions(reviewSessionId: string) {
	const findings = await reviewRepo.listReviewFindings(reviewSessionId);
	const existing =
		await reviewRepo.listReviewPromptSuggestions(reviewSessionId);
	const existingFindingIds = new Set(
		existing.map((suggestion) => suggestion.findingId),
	);
	const activeDraftCount = existing.filter(
		(suggestion) => suggestion.status === "draft",
	).length;
	const remainingSlots = Math.max(0, 5 - activeDraftCount);
	const targetFindings = findings
		.filter(
			(finding) =>
				remainingSlots > 0 &&
				!existingFindingIds.has(finding.id) &&
				Array.isArray(finding.evidenceRefsJson) &&
				finding.evidenceRefsJson.length > 0 &&
				(finding.disposition === "prompt_suggestion" ||
					(!finding.disposition &&
						finding.dispositionStatus === "unresolved" &&
						["blocking", "warning"].includes(finding.severity))),
		)
		.slice(0, remainingSlots);
	for (const finding of targetFindings) {
		const promptSuggestion = await ensureReviewPromptSuggestion(finding);
		await reviewRepo.updateReviewFindingDisposition(finding.id, {
			disposition: "prompt_suggestion",
			dispositionStatus: "converted",
			createdGoalId: promptSuggestion.id,
		});
	}
	await refreshPromptSuggestionsArtifact(reviewSessionId);
	return getReviewSessionDetail(reviewSessionId);
}

export async function updateReviewPromptSuggestion(
	reviewSessionId: string,
	suggestionId: string,
	input: { status: "dismissed" },
) {
	const suggestion = await reviewRepo.getReviewPromptSuggestion(
		reviewSessionId,
		suggestionId,
	);
	if (!suggestion)
		throw new NotFoundError("Review prompt suggestion not found");
	await reviewRepo.updateReviewPromptSuggestion(suggestion.id, {
		status: input.status,
		dismissedAt: input.status === "dismissed" ? new Date() : null,
	});
	await refreshPromptSuggestionsArtifact(reviewSessionId);
	return getReviewSessionDetail(reviewSessionId);
}

export async function useReviewPromptSuggestion(
	reviewSessionId: string,
	suggestionId: string,
	input: { createdMessageId?: string } = {},
) {
	const suggestion = await reviewRepo.getReviewPromptSuggestion(
		reviewSessionId,
		suggestionId,
	);
	if (!suggestion)
		throw new NotFoundError("Review prompt suggestion not found");
	await reviewRepo.updateReviewPromptSuggestion(suggestion.id, {
		status: "used",
		useCount: suggestion.useCount + 1,
		lastUsedAt: new Date(),
		createdMessageId:
			input.createdMessageId ?? suggestion.createdMessageId ?? null,
	});
	await refreshPromptSuggestionsArtifact(reviewSessionId);
	return getReviewSessionDetail(reviewSessionId);
}

async function refreshPromptSuggestionsArtifact(reviewSessionId: string) {
	const session = await reviewRepo.getReviewSession(reviewSessionId);
	if (!session) throw new NotFoundError("Review session not found");
	const promptSuggestions =
		await reviewRepo.listReviewPromptSuggestions(reviewSessionId);
	await reviewRepo.upsertReviewArtifact({
		reviewSessionId,
		runId: session.runId,
		taskId: session.taskId,
		kind: "prompt_suggestions",
		status: "done",
		artifactJson: {
			version: 1,
			promptSuggestions: promptSuggestions.map(rowPromptSuggestion),
		},
		sourceEvidenceRefsJson: promptSuggestions.flatMap((suggestion) =>
			Array.isArray(suggestion.evidenceRefsJson)
				? suggestion.evidenceRefsJson
				: [],
		),
	});
}
