import { AppError, NotFoundError } from "../../lib/errors";
import type {
	ReviewEvidenceRef,
	ReviewFinding,
} from "../../services/review-results/types";
import { buildReviewEvidencePackFromRun } from "../../services/review-rubrics/evidence-pack";
import * as repo from "./nightworkers.repository";
import {
	buildRecommendationFromEvidence,
	sectionFindings,
} from "./nightworkers.review-mode.evidence";
import {
	countFindings,
	planSections,
	type ReviewFindingDisposition,
	type ReviewSectionKind,
	type ReviewSectionProgress,
	rowArtifact,
	rowFinding,
	rowPromptSuggestion,
	rowRecommendation,
	rowSecurityHandoff,
	rowSession,
	SECTION_ORDER,
} from "./nightworkers.review-mode.model";
import * as reviewRepo from "./nightworkers.review-mode.repository";
import { runAgenticTestEvidenceReview } from "./nightworkers.review-mode.test-evidence-agent";
import type { TestEvidenceReviewResult } from "./nightworkers.review-mode.test-evidence-agent.schema";
import {
	type AcceptanceTestCoverageResult,
	buildTestEvidencePrecheck,
} from "./nightworkers.review-mode.test-evidence-precheck";
import { toErrorMessage } from "./run-orchestration/utils";

async function buildPackForRun(runId: string) {
	const run = await repo.getTaskRun(runId);
	if (!run) throw new NotFoundError("Run not found");
	const events = await repo.listTaskEventsForRun(runId);
	const todos = await repo.listTaskRunTodosForRun(runId);
	const pack = buildReviewEvidencePackFromRun(run, events);
	return { run, events, todos, pack };
}

export async function getOrCreateReviewRecommendation(runId: string) {
	const existing = await reviewRepo.getReviewRecommendationByRun(runId);
	if (existing) return rowRecommendation(existing);
	const { run, todos, pack } = await buildPackForRun(runId);
	const task = await repo.getTask(run.taskId);
	const repositoryId = run.repositoryId || task?.repositoryId;
	if (!repositoryId) throw new NotFoundError("Repository not found for run");
	const openTodoCount = todos.filter((todo) =>
		["pending", "running"].includes(todo.status),
	).length;
	const recommendation = buildRecommendationFromEvidence({
		runId,
		taskId: run.taskId,
		repositoryId,
		pack,
		openTodoCount,
	});
	const row = await reviewRepo.upsertReviewRecommendation({
		runId,
		taskId: run.taskId,
		repositoryId,
		level: recommendation.level,
		defaultAction: recommendation.defaultAction,
		reasonsJson: recommendation.reasons,
	});
	return rowRecommendation(row);
}

async function buildStatusArtifact(reviewSessionId: string) {
	const sessionRow = await reviewRepo.getReviewSession(reviewSessionId);
	if (!sessionRow) throw new NotFoundError("Review session not found");
	const recommendationRow =
		sessionRow.recommendationId &&
		(await reviewRepo.getReviewRecommendationByRun(sessionRow.runId));
	const recommendation = rowRecommendation(
		recommendationRow ||
			(await reviewRepo.getReviewRecommendationByRun(sessionRow.runId)),
	);
	if (!recommendation)
		throw new NotFoundError("Review recommendation not found");
	const artifacts = await reviewRepo.listReviewArtifacts(reviewSessionId);
	const findings = await reviewRepo.listReviewFindings(reviewSessionId);
	const promptSuggestions =
		await reviewRepo.listReviewPromptSuggestions(reviewSessionId);
	const securityHandoffs =
		await reviewRepo.listReviewSecurityHandoffs(reviewSessionId);
	const artifactByKind = new Map(
		artifacts.map((artifact) => [artifact.kind, artifact]),
	);
	const findingsBySection = new Map<string, typeof findings>();
	for (const finding of findings) {
		const source = finding.sourceSection || "findings";
		findingsBySection.set(source, [
			...(findingsBySection.get(source) || []),
			finding,
		]);
	}
	const sectionPlans = planSections(recommendation);
	const sections = sectionPlans.map((plan) => {
		const artifact = artifactByKind.get(plan.kind);
		const sourceFindings = findingsBySection.get(plan.kind) || [];
		return {
			kind: plan.kind,
			requirement: plan.requirement,
			progress:
				plan.requirement === "omitted"
					? ("done" as const)
					: ((artifact?.status as ReviewSectionProgress | undefined) ??
						"not_started"),
			reason: plan.reason,
			artifactId: artifact?.id ?? null,
			findingCounts: countFindings(sourceFindings),
		};
	});
	const requiredKinds = new Set(
		sections
			.filter((section) => section.requirement === "required")
			.map((section) => section.kind),
	);
	const unresolvedBlocking = findings.filter(
		(finding) =>
			requiredKinds.has(finding.sourceSection as ReviewSectionKind) &&
			finding.severity === "blocking" &&
			!["accepted", "converted", "dismissed"].includes(
				finding.dispositionStatus,
			),
	);
	const requiredRemaining = sections
		.filter(
			(section) =>
				section.requirement === "required" && section.progress !== "done",
		)
		.map((section) => section.kind);
	const blockingReason =
		requiredRemaining.length > 0
			? "Required review sections are not complete."
			: unresolvedBlocking.length > 0
				? "Unresolved blocking findings remain."
				: null;
	const statusArtifact = {
		version: 1 as const,
		reviewSessionId,
		runId: sessionRow.runId,
		taskId: sessionRow.taskId,
		recommendation,
		sections,
		finalActionGate: {
			canApprove: !blockingReason,
			blockingReason,
			unresolvedBlockingFindingIds: unresolvedBlocking.map(
				(finding) => finding.id,
			),
			requiredSectionKindsRemaining: requiredRemaining,
		},
		promptSuggestionCount: promptSuggestions.filter(
			(item) => item.status === "draft",
		).length,
		securityHandoffCount: securityHandoffs.length,
	};
	await reviewRepo.upsertReviewArtifact({
		reviewSessionId,
		runId: sessionRow.runId,
		taskId: sessionRow.taskId,
		kind: "review_status",
		status: "done",
		artifactJson: statusArtifact,
		sourceEvidenceRefsJson: recommendation.reasons.flatMap(
			(reason) => reason.evidenceRefs,
		),
	});
	return statusArtifact;
}

export async function startReviewSessionForRun(runId: string) {
	const recommendation = await getOrCreateReviewRecommendation(runId);
	if (!recommendation)
		throw new NotFoundError("Review recommendation not found");
	const session = await reviewRepo.createOrStartReviewSession({
		runId,
		taskId: recommendation.taskId,
		repositoryId: recommendation.repositoryId,
		recommendationId: recommendation.id,
	});
	await buildStatusArtifact(session.id);
	return getReviewSessionDetail(session.id);
}

export async function autoStartReviewSessionForRun(runId: string) {
	const detail = await startReviewSessionForRun(runId);
	await repo.createRunEvent({
		version: 1,
		runId,
		taskId: detail.session.taskId,
		timestamp: new Date().toISOString(),
		type: "review.session_auto_started",
		severity: "info",
		actor: "system",
		message: "Review Mode session was automatically started for run closeout.",
		data: { reviewSessionId: detail.session.id },
	});
	await repo.createRunEvent({
		version: 1,
		runId,
		taskId: detail.session.taskId,
		timestamp: new Date().toISOString(),
		type: "review.required_section_auto_started",
		severity: "info",
		actor: "system",
		message: "Required test evidence review was automatically started.",
		data: { reviewSessionId: detail.session.id, section: "test_coverage" },
	});
	try {
		return await runReviewSection(detail.session.id, "test_coverage");
	} catch (error) {
		const message = toErrorMessage(error);
		await reviewRepo.upsertReviewArtifact({
			reviewSessionId: detail.session.id,
			runId,
			taskId: detail.session.taskId,
			kind: "test_coverage",
			status: "needs_human",
			artifactJson: {
				version: 2,
				kind: "test_coverage",
				requirement: "required",
				summary: "Required test evidence review could not complete.",
				mode: "precheck_only",
				precheck: null,
				agenticReview: null,
				degradedReason: message,
				findings: [
					{
						severity: "warning",
						title: "Required test evidence review could not complete",
						body: message,
						evidenceRefs: [],
					},
				],
				recommendedActions: [
					"Review the failure reason and rerun the required test evidence section.",
				],
			},
			sourceEvidenceRefsJson: [],
		});
		await repo.createRunEvent({
			version: 1,
			runId,
			taskId: detail.session.taskId,
			timestamp: new Date().toISOString(),
			type: "review.required_section_auto_failed",
			severity: "warning",
			actor: "system",
			message: "Required test evidence review could not complete.",
			data: {
				reviewSessionId: detail.session.id,
				section: "test_coverage",
				error: message,
			},
		});
		return getReviewSessionDetail(detail.session.id);
	}
}

export async function getLatestReviewSessionDetailForTask(taskId: string) {
	const session = await reviewRepo.getLatestReviewSessionForTask(taskId);
	if (!session) return null;
	return getReviewSessionDetail(session.id);
}

export async function getReviewSessionDetail(reviewSessionId: string) {
	await buildStatusArtifact(reviewSessionId);
	const sessionRow = await reviewRepo.getReviewSession(reviewSessionId);
	if (!sessionRow) throw new NotFoundError("Review session not found");
	const recommendation = rowRecommendation(
		await reviewRepo.getReviewRecommendationByRun(sessionRow.runId),
	);
	if (!recommendation)
		throw new NotFoundError("Review recommendation not found");
	const artifacts = await reviewRepo.listReviewArtifacts(reviewSessionId);
	const findings = await reviewRepo.listReviewFindings(reviewSessionId);
	const promptSuggestions =
		await reviewRepo.listReviewPromptSuggestions(reviewSessionId);
	const securityHandoffs =
		await reviewRepo.listReviewSecurityHandoffs(reviewSessionId);
	const statusArtifact = artifacts.find(
		(artifact) => artifact.kind === "review_status",
	)?.artifactJson as Awaited<ReturnType<typeof buildStatusArtifact>>;
	const session = rowSession(sessionRow);
	if (!session) throw new NotFoundError("Review session not found");
	return {
		session,
		recommendation,
		statusArtifact,
		artifacts: artifacts.map(rowArtifact),
		findings: findings.map(rowFinding),
		promptSuggestions: promptSuggestions.map(rowPromptSuggestion),
		securityHandoffs: securityHandoffs.map(rowSecurityHandoff),
	};
}

export async function runReviewSection(
	reviewSessionId: string,
	sectionKind: ReviewSectionKind,
) {
	if (!SECTION_ORDER.includes(sectionKind))
		throw new AppError(400, "INVALID_SECTION", "Invalid review section");
	const session = await reviewRepo.getReviewSession(reviewSessionId);
	if (!session) throw new NotFoundError("Review session not found");
	const { pack } = await buildPackForRun(session.runId);
	const recommendation = await getOrCreateReviewRecommendation(session.runId);
	if (!recommendation)
		throw new NotFoundError("Review recommendation not found");
	const planned = planSections(recommendation).find(
		(section) => section.kind === sectionKind,
	);
	if (!planned)
		throw new AppError(400, "INVALID_SECTION", "Invalid review section");
	if (sectionKind === "prompt_suggestions") {
		return createReviewPromptSuggestions(reviewSessionId);
	}
	if (sectionKind === "test_coverage") {
		return runTestEvidenceSection({
			reviewSessionId,
			session,
			planned,
		});
	}
	const findings =
		sectionKind === "findings"
			? (await reviewRepo.listReviewFindings(reviewSessionId)).map(
					(finding) => ({
						severity: finding.severity as ReviewFinding["severity"],
						title: finding.title,
						body: finding.body ?? undefined,
						evidenceRefs: Array.isArray(finding.evidenceRefsJson)
							? (finding.evidenceRefsJson as ReviewEvidenceRef[])
							: [],
					}),
				)
			: sectionFindings(sectionKind, pack);
	if (sectionKind !== "findings") {
		await reviewRepo.createReviewFindings(
			findings.map((finding) => ({
				reviewSessionId,
				runId: session.runId,
				taskId: session.taskId,
				severity: finding.severity,
				title: finding.title,
				body: finding.body ?? null,
				evidenceRefsJson: finding.evidenceRefs ?? [],
				sourceSection: sectionKind,
			})),
		);
	}
	const artifact = {
		version: 1,
		kind: sectionKind,
		requirement: planned.requirement,
		summary:
			findings.length === 0
				? "No findings were produced by deterministic review."
				: `${findings.length} deterministic finding${findings.length === 1 ? "" : "s"} produced.`,
		evidence: {
			diff: pack.diff,
			selectedEvents: pack.selectedEvents,
		},
		findings,
		recommendedActions: findings.map((finding) =>
			finding.severity === "blocking"
				? "Resolve, convert to follow-up, or accept risk with note."
				: "Review and route disposition if needed.",
		),
	};
	await reviewRepo.upsertReviewArtifact({
		reviewSessionId,
		runId: session.runId,
		taskId: session.taskId,
		kind: sectionKind,
		status: "done",
		artifactJson: artifact,
		sourceEvidenceRefsJson: findings.flatMap(
			(finding) => finding.evidenceRefs ?? [],
		),
	});
	return getReviewSessionDetail(reviewSessionId);
}

async function runTestEvidenceSection(input: {
	reviewSessionId: string;
	session: NonNullable<Awaited<ReturnType<typeof reviewRepo.getReviewSession>>>;
	planned: ReturnType<typeof planSections>[number];
}) {
	const precheck = await buildTestEvidencePrecheck({
		taskId: input.session.taskId,
		repositoryId: input.session.repositoryId,
	});
	const planEvidenceRefs = planEvidenceRefsFromPrecheck(precheck);
	let mode: "precheck_only" | "agentic_review" = "precheck_only";
	let status: ReviewSectionProgress = "done";
	let agenticReview: TestEvidenceReviewResult | null = null;
	let degradedReason: string | undefined;
	let findings: ReviewFinding[] = [];

	if (!precheck.planFound || precheck.criteria.length === 0) {
		findings = [
			{
				severity: "warning",
				title: !precheck.planFound
					? "Test evidence review could not find an implementation plan"
					: "Test evidence review could not find acceptance criteria",
				body: !precheck.planFound
					? "受け入れ条件を抽出する実装計画 artifact が見つからないため、テスト証跡確認は事前確認のみで停止しました。"
					: "実装計画の受け入れ条件 section に箇条書きの条件がないため、テスト証跡確認は事前確認のみで停止しました。",
				evidenceRefs: planEvidenceRefs,
			},
		];
		status = "needs_human";
	} else {
		const agentic = await runAgenticTestEvidenceReview({
			taskId: input.session.taskId,
			repositoryId: input.session.repositoryId,
			precheck,
		});
		if (agentic.ok) {
			mode = "agentic_review";
			agenticReview = agentic.result;
			findings = findingsFromTestEvidenceReview(
				agentic.result,
				planEvidenceRefs,
			);
		} else {
			degradedReason = agentic.degradedReason;
			agenticReview = {
				version: 1,
				summary: "Agentic test evidence review could not complete.",
				criteria: [],
				commandsRun: agentic.commandsRun,
			};
			findings = [
				{
					severity: "warning",
					title: "Agentic test evidence review could not complete",
					body: `Agentic 確認に失敗しました。precheck 結果のみ表示しています。理由: ${agentic.degradedReason}`,
					evidenceRefs: planEvidenceRefs,
				},
			];
			status = "needs_human";
		}
	}

	const insertedFindings = await reviewRepo.createReviewFindings(
		findings.map((finding) => ({
			reviewSessionId: input.reviewSessionId,
			runId: input.session.runId,
			taskId: input.session.taskId,
			severity: finding.severity,
			title: finding.title,
			body: finding.body ?? null,
			evidenceRefsJson: finding.evidenceRefs ?? [],
			sourceSection: "test_coverage",
		})),
	);

	await reviewRepo.upsertReviewArtifact({
		reviewSessionId: input.reviewSessionId,
		runId: input.session.runId,
		taskId: input.session.taskId,
		kind: "test_coverage",
		status,
		artifactJson: {
			version: 2,
			kind: "test_coverage",
			requirement: input.planned.requirement,
			summary: testEvidenceArtifactSummary(precheck, agenticReview, mode),
			mode,
			precheck,
			agenticReview,
			degradedReason,
			findings,
			recommendedActions: findings.map((finding) =>
				finding.title === "Agentic test evidence review could not complete"
					? "Review the precheck result manually or rerun this section after provider/tool support is available."
					: "Review the generated improvement prompt and decide whether to continue this session.",
			),
		},
		sourceEvidenceRefsJson: planEvidenceRefs,
	});

	for (const finding of insertedFindings.filter(
		(item) =>
			["warning", "blocking"].includes(item.severity) &&
			isTestEvidenceFinding(item.title),
	)) {
		if (
			!Array.isArray(finding.evidenceRefsJson) ||
			finding.evidenceRefsJson.length === 0
		)
			continue;
		const promptSuggestion = await ensureReviewPromptSuggestion(finding);
		await reviewRepo.updateReviewFindingDisposition(finding.id, {
			disposition: "prompt_suggestion",
			dispositionStatus: "converted",
			createdGoalId: promptSuggestion.id,
		});
	}
	await refreshPromptSuggestionsArtifact(input.reviewSessionId);
	return getReviewSessionDetail(input.reviewSessionId);
}

function planEvidenceRefsFromPrecheck(
	precheck: AcceptanceTestCoverageResult,
): ReviewEvidenceRef[] {
	return precheck.planMessageId
		? [
				{
					kind: "artifact" as const,
					artifactId: precheck.planMessageId,
					artifactKind: "feature_plan",
				},
			]
		: [];
}

function findingsFromTestEvidenceReview(
	result: TestEvidenceReviewResult,
	evidenceRefs: ReviewEvidenceRef[],
): ReviewFinding[] {
	return result.criteria
		.filter(
			(criterion) =>
				criterion.status === "not_found" || criterion.status === "unclear",
		)
		.map((criterion) => ({
			severity: "warning" as const,
			title:
				criterion.status === "not_found"
					? `Test evidence not confirmed for acceptance criterion: ${criterion.criterion}`
					: `Test evidence review is unclear for acceptance criterion: ${criterion.criterion}`,
			body: [
				`受け入れ条件: ${criterion.criterion}`,
				`状態: ${criterion.status}`,
				`信頼度: ${criterion.confidence}`,
				"確認した範囲:",
				...criterion.evidence.map((evidence) => {
					const source = [
						evidence.filePath ? `file=${evidence.filePath}` : null,
						evidence.testName ? `test=${evidence.testName}` : null,
						evidence.command ? `command=${evidence.command}` : null,
					]
						.filter(Boolean)
						.join(" ");
					return `- ${evidence.kind}${source ? ` (${source})` : ""}: ${evidence.note}`;
				}),
				criterion.improvementPrompt
					? `改善依頼 Prompt: ${criterion.improvementPrompt}`
					: "",
			]
				.filter(Boolean)
				.join("\n"),
			evidenceRefs,
		}));
}

function testEvidenceArtifactSummary(
	precheck: AcceptanceTestCoverageResult,
	agenticReview: TestEvidenceReviewResult | null,
	mode: "precheck_only" | "agentic_review",
) {
	if (mode === "precheck_only" || !agenticReview) {
		return `${precheck.matches.filter((match) => match.matched).length}/${precheck.criteria.length} acceptance criteria have similar test names in precheck.`;
	}
	const confirmed = agenticReview.criteria.filter(
		(item) => item.status === "confirmed",
	).length;
	const notFound = agenticReview.criteria.filter(
		(item) => item.status === "not_found",
	).length;
	const unclear = agenticReview.criteria.filter(
		(item) => item.status === "unclear",
	).length;
	return `${confirmed} confirmed, ${notFound} not confirmed, ${unclear} unclear by agentic test evidence review.`;
}

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
	if (input.disposition === "accepted_risk") {
		if (!input.note?.trim()) {
			throw new AppError(
				400,
				"ACCEPTED_RISK_NOTE_REQUIRED",
				"Accepted risk requires a note",
			);
		}
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

export async function applyReviewFinalAction(
	reviewSessionId: string,
	input: {
		action: "approve" | "request_changes" | "needs_human" | "exit_review";
		note?: string;
	},
) {
	const detail = await getReviewSessionDetail(reviewSessionId);
	const recommendation = detail.recommendation;
	if (
		input.action === "approve" &&
		!detail.statusArtifact.finalActionGate.canApprove
	) {
		throw new AppError(
			400,
			"REVIEW_APPROVE_BLOCKED",
			detail.statusArtifact.finalActionGate.blockingReason ||
				"Review cannot be approved",
		);
	}
	if (input.action === "exit_review" && recommendation.level === "required") {
		throw new AppError(
			400,
			"REQUIRED_REVIEW_CANNOT_EXIT",
			"Required review cannot be skipped",
		);
	}
	const status =
		input.action === "approve"
			? "approved"
			: input.action === "request_changes"
				? "changes_requested"
				: input.action === "needs_human"
					? "needs_human"
					: "cancelled";
	await reviewRepo.updateReviewSession(reviewSessionId, {
		status,
		completedAt: new Date(),
		finalAction: input.action,
		finalNote: input.note?.trim() || null,
	});
	return getReviewSessionDetail(reviewSessionId);
}
