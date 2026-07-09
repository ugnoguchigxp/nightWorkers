import { describe, expect, it } from "vitest";
import type {
	ReviewPlanSpec,
	ReviewTarget,
} from "../api/modules/nightworkers/nightworkers.review-mode.model";
import {
	buildReviewRunTodos,
	normalizeReviewRunOptions,
} from "../api/modules/nightworkers/nightworkers.review-run.service";
import { parseReviewRunFindings } from "../api/modules/nightworkers/nightworkers.review-run-finalize.service";

describe("Review Run workflow", () => {
	it("defaults apply fixes on when review run options are omitted", () => {
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
			"review.apply_fixes",
			"review.verify_after_fixes",
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
			"review.apply_fixes",
			"review.verify_after_fixes",
			"review.commit_changes",
		]);
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
