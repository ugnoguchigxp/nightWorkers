import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import "../src/i18n/setup";
import { ArtifactModeNavigation } from "../src/modules/nightworkers/components/ArtifactModeNavigation";
import type { TaskRunTodo } from "../src/modules/nightworkers/types";
import { buildWorkbenchArtifactRefs } from "../src/modules/nightworkers/workbenchArtifactSelectors";
import { ReviewStatusViewer } from "../src/modules/review";
import { ReviewGitIntegrationPanel } from "../src/modules/review/components/ReviewGitIntegrationPanel";
import { ReviewPromptActions } from "../src/modules/review/components/ReviewPromptActions";
import {
	buildPostImplementationReviewArtifact,
	REVIEW_MODE_PROMPT_ACTIONS,
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

function gitActionButton(markup: string, action: string) {
	return markup.match(
		new RegExp(`<button[^>]*data-review-git-action="${action}"[^>]*>`),
	)?.[0];
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

	it("does not replace an artifact route that is already selected", () => {
		const task = buildTask();
		const input = {
			activeSession: task,
			latestRun: completedImplementationRun,
			latestRunTodos: [todo()],
		};

		for (const artifact of [
			{ kind: "review_status" as const },
			{ kind: "todo" as const },
		]) {
			expect(
				resolveReviewModeArtifactAutoFocus({
					...input,
					routeState: { kind: "session", sessionId: task.id, artifact },
				}),
			).toBeNull();
		}
	});

	it("does not open Review Mode before closeout or while Mission Pilot owns the workflow", () => {
		const todos = [todo(), todo({ id: "todo-2", seq: 2, status: "running" })];
		expect(
			buildPostImplementationReviewArtifact({
				task: buildTask(),
				run: completedImplementationRun,
				todos,
			}),
		).toBeNull();

		expect(
			buildPostImplementationReviewArtifact({
				task: buildTask({
					missionPilot: {
						desiredState: "playing",
						phase: "testing",
					} as ReturnType<typeof buildTask>["missionPilot"],
				}),
				run: completedImplementationRun,
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

	it("renders four buttons backed by the requested automatic prompts", () => {
		const markup = renderToStaticMarkup(
			createElement(ReviewStatusViewer, {
				detail: null,
				onSubmitReviewPrompt: vi.fn(async () => true),
			}),
		);

		expect(REVIEW_MODE_PROMPT_ACTIONS.map((action) => action.prompt)).toEqual([
			"コードレビューをしてください。指摘事項があれば修正してください。",
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

	it("disables every action while a Coding Agent result is pending", () => {
		const markup = renderToStaticMarkup(
			createElement(ReviewStatusViewer, {
				detail: null,
				onSubmitReviewPrompt: vi.fn(async () => true),
				isReviewPromptDisabled: true,
			}),
		);

		expect(markup).toContain(
			"Coding Agentの結果が確定するまで操作できません。",
		);
		expect((markup.match(/ disabled=""/g) || []).length).toBe(4);
	});

	it("disables Git actions when closeout preconditions or the global lock fail", () => {
		const state = {
			runId: "run-1",
			repositoryId: "repo-1",
			canCommit: false,
			canPush: false,
			state: "review_required",
			blockingCode: "REQUIRED_REVIEW_NOT_DONE",
			commitRecord: null,
			mergeRecord: null,
			requiredReview: { complete: false },
			evidence: {},
			git: { branch: "feature/review", upstream: null },
		} as Parameters<typeof ReviewGitIntegrationPanel>[0]["gitCloseout"];
		const renderPanel = (disabled: boolean) =>
			renderToStaticMarkup(
				createElement(ReviewGitIntegrationPanel, {
					gitCloseout: disabled
						? { ...state, canCommit: true, canPush: true }
						: state,
					onCommitGitCloseout: vi.fn(async () => state),
					onPushGitCloseout: vi.fn(async () => state),
					onError: vi.fn(),
					disabled,
				}),
			);

		for (const markup of [renderPanel(false), renderPanel(true)]) {
			expect(gitActionButton(markup, "commit")).toContain('disabled=""');
			expect(gitActionButton(markup, "push")).toContain('disabled=""');
		}
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
					test: true,
					review: true,
				},
				onOpen: {
					project_files: noop,
					plan: noop,
					todo: noop,
					test: noop,
					review: noop,
				},
			}),
		);

		for (const kind of ["project_files", "plan", "todo", "test", "review"]) {
			expect(markup).toContain(`data-artifact-mode="${kind}"`);
		}
		expect(markup).toContain("nightworkers-scrollbar-hidden");
		expect(markup).toContain('data-artifact-mode="review" aria-pressed="true"');
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
