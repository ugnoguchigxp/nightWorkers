import { NotFoundError } from "../../lib/errors";
import * as repo from "../nightworkers/nightworkers.repository";
import {
	countFindings,
	planSections,
	type ReviewRunOptions,
	type ReviewSectionKind,
	type ReviewSectionProgress,
	rowArtifact,
	rowFinding,
	rowPromptSuggestion,
	rowRecommendation,
	rowSecurityHandoff,
	rowSession,
} from "./review-mode.model";
import * as reviewRepo from "./review-mode.repository";
import { getOrCreateReviewRecommendation } from "./review-recommendation.service";
import { startReviewRunForSession } from "./review-run.service";

export { getOrCreateReviewRecommendation } from "./review-recommendation.service";

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
	return detail;
}

export async function startReviewRun(
	reviewSessionId: string,
	options?: Partial<ReviewRunOptions> | null,
	missionInput?: Parameters<typeof startReviewRunForSession>[2],
) {
	await startReviewRunForSession(reviewSessionId, options, missionInput);
	return getReviewSessionDetail(reviewSessionId);
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
