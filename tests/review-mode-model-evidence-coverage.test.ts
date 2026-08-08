import { describe, expect, it, vi } from "vitest";
import {
	buildRecommendationFromEvidence,
	sectionFindings,
} from "../api/modules/review/review-mode.evidence";
import {
	countFindings,
	planSections,
	rowArtifact,
	rowFinding,
	rowPromptSuggestion,
	rowRecommendation,
	rowSecurityHandoff,
	rowSession,
} from "../api/modules/review/review-mode.model";

function evidencePack(changedFiles: string[], bytes = 100) {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		diff: {
			hasChanges: bytes > 0,
			bytes,
			changedFiles,
			patch: "diff",
		},
		finalReport: null,
		verification: [],
		policy: [],
	} as never;
}

function recommendation(pack = evidencePack(["src/simple.ts"])) {
	return buildRecommendationFromEvidence({
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		pack,
		openTodoCount: 0,
	});
}

describe("review evidence recommendation coverage", () => {
	it("skips unchanged work and offers focused review for ordinary changes", () => {
		expect(recommendation(evidencePack([], 0))).toMatchObject({
			level: "none",
			defaultAction: "skip",
			reasons: [{ code: "minor_no_review_needed", evidenceRefs: [] }],
		});
		expect(recommendation()).toMatchObject({
			level: "optional",
			defaultAction: "offer_review",
			reasons: [
				{
					code: "minor_no_review_needed",
					evidenceRefs: [{ kind: "diff", hasChanges: true }],
				},
			],
		});
	});

	it("recommends review for large and broad changes", () => {
		const result = recommendation(
			evidencePack(
				Array.from({ length: 8 }, (_, index) => `src/file-${index}.ts`),
				20_001,
			),
		);
		expect(result).toMatchObject({
			level: "recommended",
			defaultAction: "offer_review",
		});
		expect(result.reasons.map((reason) => reason.code)).toEqual([
			"large_diff",
			"many_changed_files",
		]);
		expect(result.reasons[1].evidenceRefs).toHaveLength(8);
	});

	it("requires review for unresolved Todos and all sensitive path classes", () => {
		const pack = evidencePack([
			"src/auth/token.ts",
			"api/db/migrations/0001.sql",
			"shared/schemas/public.schema.ts",
			"api/modules/users/routes.ts",
			"src/ordinary.ts",
		]);
		const result = buildRecommendationFromEvidence({
			runId: "run-1",
			taskId: "task-1",
			repositoryId: "repo-1",
			pack,
			openTodoCount: 2,
		});
		expect(result).toMatchObject({
			level: "required",
			defaultAction: "require_review",
		});
		expect(result.reasons.map((reason) => reason.code)).toEqual([
			"todo_unresolved",
			"security_sensitive_change",
			"security_plugin_missing",
			"schema_or_migration_change",
			"public_contract_change",
		]);
		expect(
			result.reasons.find(
				(reason) => reason.code === "security_sensitive_change",
			)?.evidenceRefs,
		).toEqual([{ kind: "changed_file", path: "src/auth/token.ts" }]);
	});

	it("builds security-section findings and returns none for unrelated sections", () => {
		const pack = evidencePack([
			"oauth.ts",
			"db/schema.ts",
			"api/worker-tools/read.ts",
		]);
		const findings = sectionFindings("security_review", pack);
		expect(findings.map((finding) => finding.title)).toEqual([
			"Security-sensitive change needs external evidence",
			"Schema or migration change requires review",
			"Public contract change requires review",
		]);
		expect(sectionFindings("findings", pack)).toEqual([]);
		expect(sectionFindings("prompt_suggestions", pack)).toEqual([]);
		expect(
			sectionFindings("security_review", evidencePack(["src/plain.ts"])),
		).toEqual([]);
	});
});

describe("review row model coverage", () => {
	it("maps nullable recommendations and sessions", () => {
		expect(rowRecommendation(null)).toBeNull();
		expect(rowSession(null)).toBeNull();

		const dates = {
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedAt: "2026-01-02T00:00:00.000Z",
		};
		expect(
			rowRecommendation({
				id: "recommendation-1",
				runId: "run-1",
				taskId: "task-1",
				repositoryId: "repo-1",
				level: "required",
				defaultAction: "require_review",
				reasonsJson: "invalid",
				...dates,
			} as never),
		).toMatchObject({ reasons: [], createdAt: "2026-01-01T00:00:00.000Z" });

		expect(
			rowSession({
				id: "session-1",
				runId: "run-1",
				taskId: "task-1",
				repositoryId: "repo-1",
				status: "in_progress",
				recommendationId: null,
				startedAt: null,
				completedAt: undefined,
				finalAction: null,
				finalNote: null,
				createdAt: null,
				updatedAt: null,
			} as never),
		).toMatchObject({ startedAt: null, completedAt: null });
	});

	it("maps artifact, finding, suggestion, and handoff array fallbacks", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
		const base = {
			id: "row-1",
			reviewSessionId: "session-1",
			runId: "run-1",
			taskId: "task-1",
			createdAt: null,
			updatedAt: null,
		};
		expect(
			rowArtifact({
				...base,
				kind: "findings",
				status: "done",
				artifactJson: { ok: true },
				sourceEvidenceRefsJson: null,
			} as never),
		).toMatchObject({
			sourceEvidenceRefs: [],
			createdAt: "2026-04-01T00:00:00.000Z",
		});
		expect(
			rowFinding({
				...base,
				severity: "warning",
				title: "Finding",
				body: null,
				disposition: null,
				dispositionStatus: "unresolved",
				dispositionNote: null,
				evidenceRefsJson: {},
				createdGoalId: null,
				createdTaskProposalId: null,
				contextStillCandidateId: null,
			} as never),
		).toMatchObject({ evidenceRefs: [] });
		expect(
			rowPromptSuggestion({
				...base,
				findingId: "finding-1",
				repositoryId: "repo-1",
				title: "Prompt",
				prompt: "Fix",
				expectedOutcome: "Fixed",
				acceptanceCriteria: "Verified",
				verificationHint: "Test",
				evidenceRefsJson: "bad",
				status: "draft",
				useCount: 0,
				lastUsedAt: new Date("2026-03-01T00:00:00Z"),
				dismissedAt: null,
				createdMessageId: null,
			} as never),
		).toMatchObject({
			evidenceRefs: [],
			lastUsedAt: "2026-03-01T00:00:00.000Z",
			dismissedAt: null,
		});
		expect(
			rowSecurityHandoff({
				...base,
				findingId: "finding-1",
				repositoryId: "repo-1",
				title: "Handoff",
				summary: "Review",
				requestedIntegration: null,
				status: "needs_configuration",
				changedPathsJson: null,
				evidenceRefsJson: null,
				handoffArtifactJson: undefined,
			} as never),
		).toMatchObject({
			changedPaths: [],
			evidenceRefs: [],
			handoffArtifact: null,
		});
		vi.useRealTimers();
	});

	it("preserves row arrays and explicit timestamps", () => {
		const evidence = [{ kind: "changed_file", path: "src/a.ts" }];
		const base = {
			id: "row-1",
			reviewSessionId: "session-1",
			runId: "run-1",
			taskId: "task-1",
			createdAt: "2026-01-01",
			updatedAt: "2026-01-02",
		};
		expect(
			rowArtifact({
				...base,
				kind: "findings",
				status: "done",
				artifactJson: {},
				sourceEvidenceRefsJson: evidence,
			} as never).sourceEvidenceRefs,
		).toEqual(evidence);
		expect(
			rowFinding({
				...base,
				severity: "info",
				title: "Info",
				body: "Body",
				disposition: "ignored",
				dispositionStatus: "dismissed",
				dispositionNote: "note",
				evidenceRefsJson: evidence,
				createdGoalId: null,
				createdTaskProposalId: null,
				contextStillCandidateId: null,
			} as never).evidenceRefs,
		).toEqual(evidence);
		expect(
			rowSecurityHandoff({
				...base,
				findingId: "finding",
				repositoryId: "repo",
				title: "H",
				summary: "S",
				requestedIntegration: "tool",
				status: "requested",
				changedPathsJson: ["a.ts"],
				evidenceRefsJson: evidence,
				handoffArtifactJson: { version: 1 },
			} as never),
		).toMatchObject({
			changedPaths: ["a.ts"],
			evidenceRefs: evidence,
			handoffArtifact: { version: 1 },
		});
	});

	it("plans sections for omitted, ordinary, and sensitive recommendations", () => {
		const none = rowRecommendation({
			id: "r-none",
			runId: "run",
			taskId: "task",
			repositoryId: "repo",
			level: "none",
			defaultAction: "skip",
			reasonsJson: [],
			createdAt: "now",
			updatedAt: "now",
		} as never)!;
		expect(planSections(none).map((section) => section.requirement)).toEqual([
			"omitted",
			"omitted",
			"omitted",
		]);

		const ordinary = rowRecommendation({
			id: "r",
			runId: "run",
			taskId: "task",
			repositoryId: "repo",
			level: "optional",
			defaultAction: "offer_review",
			reasonsJson: [
				{
					code: "large_diff",
					severity: "warning",
					label: "large",
					evidenceRefs: [],
				},
			],
			createdAt: "now",
			updatedAt: "now",
		} as never)!;
		expect(planSections(ordinary)[0]).toMatchObject({
			requirement: "optional",
			reason: "No security-sensitive change was detected.",
		});

		for (const code of [
			"security_sensitive_change",
			"schema_or_migration_change",
			"public_contract_change",
		]) {
			const sensitive = {
				...ordinary,
				reasons: [
					{ code, severity: "blocking", label: code, evidenceRefs: [] },
				],
			} as never;
			expect(planSections(sensitive)[0].reason).toContain("Sensitive");
		}
	});

	it("counts each finding severity and ignores unknown values", () => {
		expect(
			countFindings([
				{ severity: "blocking" },
				{ severity: "blocking" },
				{ severity: "warning" },
				{ severity: "info" },
				{ severity: "unknown" },
			]),
		).toEqual({ blocking: 2, warning: 1, info: 1 });
	});
});
