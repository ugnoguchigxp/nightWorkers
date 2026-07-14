import { describe, expect, it } from "vitest";
import type {
	ReviewPlanSpec,
	ReviewTarget,
} from "../api/modules/review/review-mode.model";
import {
	buildReviewRunPrompt,
	buildReviewRunTodos,
	normalizeReviewRunOptions,
} from "../api/modules/review/review-run.service";
import { parseReviewRunFindings } from "../api/modules/review/review-run-finalize.service";

describe("Review Run workflow", () => {
	it("defaults code review and records correction/closeout permissions", () => {
		const todos = buildReviewRunTodos({
			options: normalizeReviewRunOptions({}),
			target: reviewTarget(),
			planSpec: reviewPlanSpec(),
		});

		expect(todos.map((todo) => todo.procedureId)).toEqual([
			"review.read_plan_spec",
			"review.inspect_targets",
			"review.code_findings",
			"review.consolidate_findings",
			"review.correction_request",
			"review.correction_closeout_permission",
		]);
	});

	it("generates selected review todos and gates fixes and commits by option", () => {
		const base = buildReviewRunTodos({
			options: normalizeReviewRunOptions({
				codeReview: true,
				securityReview: false,
				applyFixes: false,
				commitChanges: false,
			}),
			target: reviewTarget(),
			planSpec: reviewPlanSpec(),
		});
		expect(base.map((todo) => todo.procedureId)).toEqual([
			"review.read_plan_spec",
			"review.inspect_targets",
			"review.code_findings",
			"review.consolidate_findings",
		]);

		const full = buildReviewRunTodos({
			options: normalizeReviewRunOptions({
				securityReview: true,
				applyFixes: true,
				commitChanges: true,
			}),
			target: reviewTarget(),
			planSpec: reviewPlanSpec(),
		});
		expect(full.map((todo) => todo.procedureId)).toEqual([
			"review.read_plan_spec",
			"review.inspect_targets",
			"review.code_findings",
			"review.security_vulnworkbench",
			"review.consolidate_findings",
			"review.correction_request",
			"review.correction_closeout_permission",
		]);
		expect(full[3]?.title).toBe(
			"vulnWorkbench CLI のセキュリティ診断結果を確認する",
		);
	});

	it("limits security-only runs to precomputed evidence and consolidation", () => {
		const todos = buildReviewRunTodos({
			options: normalizeReviewRunOptions({
				codeReview: false,
				securityReview: true,
				applyFixes: false,
				commitChanges: false,
			}),
			target: reviewTarget(),
			planSpec: reviewPlanSpec(),
		});

		expect(todos.map((todo) => todo.procedureId)).toEqual([
			"review.security_vulnworkbench",
			"review.consolidate_findings",
		]);
		expect(todos[0]?.dependsOn).toBeUndefined();
		expect(todos[1]?.dependsOn).toEqual([1]);
		expect(todos.map((todo) => todo.procedureId)).not.toContain(
			"review.inspect_targets",
		);
	});

	it("keeps fixes finding-scoped when code review is disabled", () => {
		const todos = buildReviewRunTodos({
			options: normalizeReviewRunOptions({
				codeReview: false,
				securityReview: true,
				applyFixes: true,
				commitChanges: false,
			}),
			target: reviewTarget(),
			planSpec: reviewPlanSpec(),
		});

		expect(todos.map((todo) => todo.procedureId)).toEqual([
			"review.security_vulnworkbench",
			"review.consolidate_findings",
			"review.correction_request",
		]);
		expect(todos.map((todo) => todo.procedureId)).not.toContain(
			"review.inspect_targets",
		);
	});

	it("injects precomputed vulnWorkbench findings as text and forbids CLI reruns", () => {
		const prompt = buildReviewRunPrompt({
			session: {
				id: "session-1",
				runId: "run-1",
				taskId: "task-1",
				repositoryId: "repo-1",
				recommendationId: null,
				status: "in_progress",
				startedAt: new Date(),
				completedAt: null,
				finalAction: null,
				finalNote: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			options: normalizeReviewRunOptions({
				codeReview: false,
				securityReview: true,
				applyFixes: false,
				commitChanges: false,
			}),
			target: reviewTarget(),
			planSpec: reviewPlanSpec(),
			todos: buildReviewRunTodos({
				options: normalizeReviewRunOptions({
					codeReview: false,
					securityReview: true,
					applyFixes: false,
					commitChanges: false,
				}),
				target: reviewTarget(),
				planSpec: reviewPlanSpec(),
			}),
			initialFindings: [
				{
					severity: "warning",
					title:
						"vulnWorkbench security diagnostic reported scanner-backed findings",
					body: [
						"対応が必要な検出:",
						"1. [high] Container runs as root",
						"   場所: Dockerfile:18",
						"   根拠: semgrep / dockerfile.security.missing-user",
						"   対応: non-root USER を設定してください。",
					].join("\n"),
				},
			],
		});

		expect(prompt).toContain("NightWorkers が事前取得した Review evidence");
		expect(prompt).toContain("Container runs as root");
		expect(prompt).toContain("Dockerfile:18");
		expect(prompt).toContain("non-root USER を設定してください");
		expect(prompt).toContain("vulnWorkbench を検索・再実行しない");
		expect(prompt).toContain(
			"(codeReview=false のため、コードレビュー用 Plan 本文は省略)",
		);
		expect(prompt).toContain("Review target boundary (metadata only)");
		expect(prompt).toContain("git diff を取得せず");
		expect(prompt).toContain(
			"source / test / schema / migration の内容を個別に読まない",
		);
		expect(prompt).not.toContain("# Feature Plan");
	});

	it("requires structured JSON only for Mission Pilot reviews", () => {
		const common = {
			session: {
				id: "session-1",
				runId: "run-1",
				taskId: "task-1",
				repositoryId: "repo-1",
				recommendationId: null,
				status: "in_progress",
				startedAt: new Date(),
				completedAt: null,
				finalAction: null,
				finalNote: null,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			options: normalizeReviewRunOptions(),
			target: reviewTarget(),
			planSpec: reviewPlanSpec(),
			todos: [],
			initialFindings: [],
		};
		expect(buildReviewRunPrompt(common)).not.toContain(
			"Mission Pilot Review の最終回答",
		);
		expect(buildReviewRunPrompt({ ...common, missionPilot: true })).toContain(
			"Mission Pilot Review の最終回答",
		);
	});

	it("keeps missing plan as a review todo instead of crashing code review setup", () => {
		const todos = buildReviewRunTodos({
			options: normalizeReviewRunOptions({ codeReview: true }),
			target: reviewTarget(),
			planSpec: { ...reviewPlanSpec(), body: "", sourceMessageId: null },
		});
		expect(todos[0]?.description).toContain("Plan 仕様書が見つからない");
		expect(todos.map((todo) => todo.procedureId)).toContain(
			"review.code_findings",
		);
	});

	it("parses structured findings from review final reports", () => {
		expect(
			parseReviewRunFindings(
				'```json\n{"findings":[{"severity":"blocking","title":"Bug","body":"Details","path":"src/app.ts"}]}\n```',
			),
		).toEqual([
			{
				severity: "blocking",
				title: "Bug",
				body: "Details",
				path: "src/app.ts",
			},
		]);
		expect(
			parseReviewRunFindings("- [warning] Missing test (src/app.ts)"),
		).toEqual([
			{
				severity: "warning",
				title: "Missing test",
				body: null,
				path: "src/app.ts",
			},
		]);
	});
});

function reviewTarget(): ReviewTarget {
	return {
		runId: "run-1",
		taskId: "task-1",
		repositoryId: "repo-1",
		repoRoot: "/tmp/repo",
		planArtifact: {
			messageId: "message-1",
			title: "Feature Plan",
			source: "plan_artifact",
		},
		targetFiles: [
			{
				path: "src/app.ts",
				status: "modified",
				sources: ["codex_file_change", "current_git_diff"],
				eventIds: ["event-1"],
				diff: "diff --git a/src/app.ts b/src/app.ts",
				diffBytes: 36,
			},
		],
		excludedDirtyFiles: [],
		signalOnlyFiles: [],
		diffOnlyFiles: [],
		warnings: [],
	};
}

function reviewPlanSpec(): ReviewPlanSpec {
	return {
		sourceMessageId: "message-1",
		title: "Feature Plan",
		body: "# Feature Plan\n\n## Acceptance Criteria\n- Works",
		acceptanceCriteria: ["Works"],
		verificationHints: ["bun test"],
		securityNotes: [],
		implementationScopeHints: ["src/app.ts"],
	};
}
