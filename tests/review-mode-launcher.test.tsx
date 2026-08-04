import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { ArtifactModeNavigation } from "../src/modules/nightworkers/components/ArtifactModeNavigation";
import type {
	TaskMessage,
	TaskRunTodo,
} from "../src/modules/nightworkers/types";
import { buildWorkbenchArtifactRefs } from "../src/modules/nightworkers/workbenchArtifactSelectors";
import { ReviewStatusViewer } from "../src/modules/review";
import { ReviewPromptActions } from "../src/modules/review/components/ReviewPromptActions";
import {
	buildInteractiveReviewContinuationArtifact,
	buildPostImplementationReviewArtifact,
	REVIEW_MODE_PROMPT_ACTIONS,
	resolveReviewImplementationCompletionReport,
} from "../src/modules/review/reviewModeLauncher";
import { resolveReviewModeArtifactAutoFocus } from "../src/modules/review/useReviewModeArtifactAutoFocus";
import { buildTask, buildTaskRun } from "./helpers/nightworkers-fixtures";

function collectButtons(node: unknown): Array<{
	props: { onClick?: () => unknown; [key: string]: unknown };
}> {
	if (!node || typeof node !== "object") return [];
	if (Array.isArray(node)) return node.flatMap(collectButtons);
	const element = node as {
		type?: unknown;
		props?: { children?: unknown; [key: string]: unknown };
	};
	const own = element.type === "button" && element.props ? [element] : [];
	return [...own, ...collectButtons(element.props?.children)];
}

function todo(overrides: Partial<TaskRunTodo> = {}): TaskRunTodo {
	return {
		id: "todo-1",
		runId: "33333333-3333-4333-8333-333333333333",
		seq: 1,
		title: "実装を完了する",
		nextAction: "完了を報告する",
		acceptanceCriteriaJson: ["実装が完了している"],
		taskType: "code_change",
		status: "passed",
		attemptCount: 1,
		systemContextVersion: 1,
		createdBy: "agent",
		revision: 1,
		createdAt: "2026-07-18T00:00:00.000Z",
		updatedAt: "2026-07-18T00:01:00.000Z",
		...overrides,
	};
}

const completedImplementationRun = buildTaskRun({
	status: "completed",
	contextSnapshot: { executionMode: "implementation" },
	finalReport: "実装と検証が完了しました。",
	finishedAt: "2026-07-18T00:01:00.000Z",
	updatedAt: "2026-07-18T00:01:00.000Z",
});

describe("Review Mode launcher", () => {
	it("creates and focuses Review Mode after the final Todo and final report complete", () => {
		const task = buildTask();
		const todos = [todo(), todo({ id: "todo-2", seq: 2 })];

		expect(
			buildPostImplementationReviewArtifact({
				task,
				run: completedImplementationRun,
				todos,
			}),
		).toMatchObject({
			id: `review-mode-${completedImplementationRun.id}`,
			kind: "review_status",
			metadata: { reviewModeLauncher: true },
		});
		expect(
			resolveReviewModeArtifactAutoFocus({
				activeSession: task,
				latestRun: completedImplementationRun,
				latestRunTodos: todos,
				routeState: { kind: "session", sessionId: task.id, artifact: null },
			}),
		).toBe(`${task.id}:${completedImplementationRun.id}:review-mode`);
	});

	it("opens Review Mode for the normal needs_review implementation handoff", () => {
		const task = buildTask({ status: "needs_review" });
		const run = {
			...completedImplementationRun,
			status: "needs_review",
		};

		expect(
			buildPostImplementationReviewArtifact({
				task,
				run,
				todos: [todo()],
			}),
		).toMatchObject({
			id: `review-mode-${run.id}`,
			kind: "review_status",
		});
	});

	it("focuses Review Mode from any other artifact route", () => {
		const task = buildTask();
		const input = {
			activeSession: task,
			latestRun: completedImplementationRun,
			latestRunTodos: [todo()],
		};

		expect(
			resolveReviewModeArtifactAutoFocus({
				...input,
				routeState: {
					kind: "session",
					sessionId: task.id,
					artifact: { kind: "todo" },
				},
			}),
		).toBe(`${task.id}:${completedImplementationRun.id}:review-mode`);
		expect(
			resolveReviewModeArtifactAutoFocus({
				...input,
				routeState: {
					kind: "session",
					sessionId: task.id,
					artifact: {
						kind: "specification",
						specificationId: "specification-1",
					},
				},
			}),
		).toBe(`${task.id}:${completedImplementationRun.id}:review-mode`);
		expect(
			resolveReviewModeArtifactAutoFocus({
				...input,
				routeState: {
					kind: "session",
					sessionId: task.id,
					artifact: { kind: "review_status" },
				},
			}),
		).toBeNull();
	});

	it("does not open Review Mode before closeout", () => {
		const todos = [todo(), todo({ id: "todo-2", seq: 2, status: "running" })];
		expect(
			buildPostImplementationReviewArtifact({
				task: buildTask(),
				run: completedImplementationRun,
				todos,
			}),
		).toBeNull();
	});

	it.each([
		"needs_human",
		"cancelled",
		"failed",
		"timed_out",
		"running",
	])("does not open Review Mode for a %s implementation Run", (status) => {
		expect(
			buildPostImplementationReviewArtifact({
				task: buildTask(),
				run: { ...completedImplementationRun, status },
				todos: [todo()],
			}),
		).toBeNull();
	});

	it("adds a synthetic Review Mode artifact when no persisted Review Session exists", () => {
		const refs = buildWorkbenchArtifactRefs({
			task: buildTask(),
			latestRun: completedImplementationRun,
			todos: [todo()],
		});

		expect(refs).toContainEqual(
			expect.objectContaining({
				id: `review-mode-${completedImplementationRun.id}`,
				kind: "review_status",
			}),
		);
	});

	it("restores the same Review Mode artifact after a Review Run becomes latest", () => {
		const task = buildTask();
		const reviewRun = buildTaskRun({
			taskId: task.id,
			id: "44444444-4444-4444-8444-444444444444",
			contextSnapshot: {
				executionMode: "review",
				reviewRuntime: {
					contextPolicy: "codex_default",
					reviewedRunId: completedImplementationRun.id,
				},
			},
			updatedAt: "2026-07-18T00:02:00.000Z",
		});

		expect(
			buildInteractiveReviewContinuationArtifact({ task, run: reviewRun }),
		).toMatchObject({
			id: `review-mode-${completedImplementationRun.id}`,
			runId: completedImplementationRun.id,
			source: {
				type: "run_field",
				runId: completedImplementationRun.id,
				field: "finalReport",
			},
			metadata: {
				reviewModeLauncher: true,
				reviewContinuationRunId: reviewRun.id,
			},
		});
		expect(
			buildWorkbenchArtifactRefs({
				task,
				latestRun: reviewRun,
				todos: [],
			}),
		).toContainEqual(
			expect.objectContaining({
				id: `review-mode-${completedImplementationRun.id}`,
				kind: "review_status",
			}),
		);
	});

	it("resolves and renders the completion report from the reviewed Implementation Run", () => {
		const task = buildTask();
		const artifact = buildPostImplementationReviewArtifact({
			task,
			run: completedImplementationRun,
			todos: [todo()],
		});
		const report = "対象Implementation Runの完了報告です。";
		const taskMessages = [
			{
				id: "implementation-progress-report",
				taskId: task.id,
				runId: completedImplementationRun.id,
				role: "assistant",
				content: "実装途中の報告です。",
				traceOwner: "coding_agent",
				traceChannel: "chat",
				createdAt: "invalid-timestamp",
			} as TaskMessage,
			{
				id: "implementation-final-report",
				taskId: task.id,
				runId: completedImplementationRun.id,
				role: "assistant",
				content: report,
				traceOwner: "coding_agent",
				traceChannel: "chat",
				createdAt: "invalid-timestamp",
			} as TaskMessage,
		];

		expect(
			resolveReviewImplementationCompletionReport({
				artifact,
				detail: null,
				latestRun: buildTaskRun({
					id: "44444444-4444-4444-8444-444444444444",
					contextSnapshot: { executionMode: "review" },
					finalReport: "Review Run report",
				}),
				taskMessages,
			}),
		).toBe(report);
		const markup = renderToStaticMarkup(
			createElement(ReviewStatusViewer, {
				detail: null,
				implementationCompletionReport: report,
			}),
		);
		expect(markup).toContain("data-review-completion-report");
		expect(markup).toContain("実装完了報告");
		expect(markup).toContain(report);
	});

	it("renders four buttons backed by the requested automatic prompts", () => {
		const markup = renderToStaticMarkup(
			createElement(ReviewStatusViewer, {
				detail: null,
				onSubmitReviewPrompt: vi.fn(async () => true),
			}),
		);

		expect(REVIEW_MODE_PROMPT_ACTIONS.map((action) => action.prompt)).toEqual([
			"現在のTask専用worktreeでgit statusとgit diffを自分で確認し、未追跡ファイルも含めてレビュー対象を判断してコードレビューをしてください。指摘事項があれば修正して検証してください。",
			"vulnWorkbenchでセキュリティスキャンをしてください。指摘結果があれば修正してください。",
			"コミットしてください。",
			"プッシュしてください。",
		]);
		for (const action of REVIEW_MODE_PROMPT_ACTIONS) {
			expect(markup).toContain(`data-review-prompt-action="${action.id}"`);
			expect(markup).toContain(action.label);
		}
		expect(markup).toContain("実行する");
	});

	it("submits the matching prompt from every Review Mode action button", async () => {
		const onSubmit = vi.fn(async () => undefined);
		const buttons = collectButtons(ReviewPromptActions({ onSubmit }));

		for (const button of buttons) await button.props.onClick?.();

		expect(onSubmit.mock.calls.map(([action]) => action)).toEqual(
			REVIEW_MODE_PROMPT_ACTIONS,
		);
	});

	it("disables every action while a Review Codex result is pending", () => {
		const markup = renderToStaticMarkup(
			createElement(ReviewStatusViewer, {
				detail: null,
				onSubmitReviewPrompt: vi.fn(async () => true),
				isReviewPromptDisabled: true,
			}),
		);

		expect(markup).toContain(
			"Review Codexの結果が確定するまで操作できません。",
		);
		expect((markup.match(/ disabled=""/g) || []).length).toBe(4);
	});

	it("offers the final archive action before a Review Session is persisted", () => {
		const markup = renderToStaticMarkup(
			createElement(ReviewStatusViewer, {
				detail: null,
				activeTaskId: "task-1",
				activeTaskStatus: "completed",
				gitCloseout: {
					state: "commit_ready",
					commitRecord: {
						status: "ready",
						verificationStatus: "partial",
					},
					mergeRecord: null,
					requiredReview: { complete: true },
					git: { branch: "feature/review", upstream: null },
					canCommit: true,
					canPush: false,
				} as never,
				onCompleteAndArchiveTask: vi.fn(async () => undefined),
			}),
		);

		expect(markup).toContain('data-review-task-archive-action="archive"');
		expect(markup).toContain("未コミット処理を破棄してアーカイブ");
		expect(markup).toContain("変更ファイルはWorktreeを削除するまで残ります");
	});

	it("renders all artifact destinations in the shared top navigation", () => {
		const noop = () => undefined;
		const markup = renderToStaticMarkup(
			createElement(ArtifactModeNavigation, {
				current: "review",
				available: {
					project_files: true,
					plan: true,
					todo: true,
					evidence: true,
					review: true,
				},
				onOpen: {
					project_files: noop,
					plan: noop,
					todo: noop,
					evidence: noop,
					review: noop,
				},
			}),
		);

		for (const kind of [
			"project_files",
			"plan",
			"todo",
			"evidence",
			"review",
		]) {
			expect(markup).toContain(`data-artifact-mode="${kind}"`);
		}
		expect(markup).toContain("nightworkers-scrollbar-hidden");
		expect(markup).toContain('data-artifact-mode="review" aria-pressed="true"');
	});

	it("removes Todo from the Review Codex artifact choices", () => {
		const noop = () => undefined;
		const markup = renderToStaticMarkup(
			createElement(ArtifactModeNavigation, {
				current: "review",
				hidden: { todo: true },
				available: {
					project_files: true,
					plan: true,
					todo: false,
					evidence: true,
					review: true,
				},
				onOpen: {
					project_files: noop,
					plan: noop,
					todo: noop,
					evidence: noop,
					review: noop,
				},
			}),
		);

		expect(markup).not.toContain('data-artifact-mode="todo"');
		expect(markup).toContain('data-artifact-mode="review"');
	});

	it("keeps Evidence clickable while a different artifact action is busy", () => {
		const noop = () => undefined;
		const markup = renderToStaticMarkup(
			createElement(ArtifactModeNavigation, {
				current: null,
				busyKind: "plan",
				available: {
					project_files: true,
					plan: true,
					todo: true,
					evidence: true,
					review: true,
				},
				onOpen: {
					project_files: noop,
					plan: noop,
					todo: noop,
					evidence: noop,
					review: noop,
				},
			}),
		);
		const planButton = markup.match(
			/<button[^>]*data-artifact-mode="plan"[^>]*>/,
		)?.[0];
		const evidenceButton = markup.match(
			/<button[^>]*data-artifact-mode="evidence"[^>]*>/,
		)?.[0];

		expect(planButton).toContain('disabled=""');
		expect(evidenceButton).not.toContain('disabled=""');
	});

	it("does not duplicate the shared artifact navigation inside the artifact pane", () => {
		const paneSource = readFileSync(
			"src/modules/nightworkers/components/ArtifactPane.tsx",
			"utf8",
		);
		const panelSource = readFileSync(
			"src/modules/nightworkers/components/NightWorkersShellThreadPanel.tsx",
			"utf8",
		);

		expect(paneSource).not.toContain("ArtifactModeNavigation");
		expect(panelSource).not.toContain("artifactNavigation={{");
	});
});
