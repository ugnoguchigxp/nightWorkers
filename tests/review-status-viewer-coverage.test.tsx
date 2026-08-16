import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let setters: Array<ReturnType<typeof vi.fn>> = [];
let effects: Array<() => undefined | (() => void)> = [];

function component(name: string) {
	return Object.defineProperty(() => null, "name", { value: name });
}

function setup(state: unknown[] = [null, null, null]) {
	const values = [...state];
	setters = [];
	effects = [];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useEffect: (callback: () => undefined | (() => void)) =>
				effects.push(callback),
			useState: <T,>(initial: T) => {
				const value = values.length ? (values.shift() as T) : initial;
				const setter = vi.fn();
				setters.push(setter);
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({
			t: (key: string, options?: { defaultValue?: string }) =>
				options?.defaultValue ?? key,
		}),
	}));
	vi.doMock("../src/modules/review/components/ReviewPromptActions", () => ({
		ReviewPromptActions: component("ReviewPromptActions"),
	}));
	vi.doMock("../src/modules/review/components/ReviewRunResultPanel", () => ({
		ReviewRunResultPanel: component("ReviewRunResultPanel"),
	}));
}

function reviewRun(
	status = "running",
	overrides: Record<string, unknown> = {},
) {
	return {
		version: 1,
		kind: "review_run",
		runId: "implementation-run",
		reviewRunId: "review-run",
		taskId: "task-1",
		repositoryId: "repo-1",
		options: {
			codeReview: true,
			securityReview: true,
			applyFixes: true,
			commitChanges: false,
		},
		status,
		target: {
			targetFiles: [{ path: "a.ts", status: "M" }],
			excludedDirtyFiles: ["ignored.ts"],
		},
		todos: [{ seq: 1, title: "Review", taskType: "review", procedureId: null }],
		findings: [
			{ severity: "warning", title: "Run finding", body: "Body", path: "a.ts" },
		],
		warnings: [{ code: "WARN", severity: "warning", message: "Warning" }],
		...overrides,
	};
}

function artifact(
	id: string,
	kind: string,
	value: unknown,
	updatedAt = "2026-08-08T00:00:00Z",
) {
	return {
		id,
		reviewSessionId: "session-1",
		runId: "implementation-run",
		taskId: "task-1",
		kind,
		status: "done",
		artifact: value,
		sourceEvidenceRefs: [],
		createdAt: updatedAt,
		updatedAt,
	};
}

function detail(overrides: Record<string, unknown> = {}) {
	return {
		session: {
			id: "session-1",
			runId: "implementation-run",
			taskId: "task-1",
			repositoryId: "repo-1",
			status: "in_progress",
			recommendationId: "recommendation-1",
			startedAt: null,
			completedAt: null,
			finalAction: null,
			finalNote: null,
			createdAt: "2026-08-08",
			updatedAt: "2026-08-08",
		},
		recommendation: {},
		statusArtifact: {
			recommendation: { level: "required" },
		},
		artifacts: [
			artifact("old", "review_run", reviewRun("failed"), "invalid"),
			artifact("latest", "review_run", reviewRun(), "2026-08-09T00:00:00Z"),
			artifact("security", "security_review", { result: "safe" }),
		],
		findings: [],
		promptSuggestions: [],
		securityHandoffs: [
			{
				id: "handoff-1",
				title: "Security",
				summary: "Scan it",
				status: "requested",
				changedPaths: ["a.ts"],
			},
		],
		...overrides,
	};
}

function elements(node: ReactNode): ReactElement[] {
	if (
		node == null ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...elements(element.props?.children)];
}

function named(root: ReactNode, name: string) {
	return elements(root).filter(
		(element) =>
			typeof element.type === "function" && element.type.name === name,
	);
}

function archiveButton(root: ReactNode) {
	return elements(root).find(
		(element) => element.props["data-review-task-archive-action"],
	);
}

describe("review status viewer coverage", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.stubGlobal("window", { confirm: vi.fn(() => true) });
	});

	it("renders loading, report, prompt, and archive controls without detail", async () => {
		setup();
		const { ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		);
		const onComplete = vi.fn(async () => undefined);
		const root = ReviewStatusViewer({
			detail: null,
			loading: true,
			activeTaskId: "task-1",
			activeTaskStatus: "completed",
			implementationCompletionReport: "  completed report  ",
			onCompleteAndArchiveTask: onComplete,
			onSubmitReviewPrompt: vi.fn(async () => true),
		});
		expect(named(root, "ReviewPromptActions")[0].props.disabled).toBe(false);
		const button = archiveButton(root);
		if (!button) throw new Error("Archive button was not rendered.");
		expect(button.props["data-review-task-archive-action"]).toBe("archive");
		await button.props.onClick();
		expect(window.confirm).toHaveBeenCalledTimes(1);
		expect(onComplete).toHaveBeenCalledWith("task-1", {
			discardPendingCloseouts: true,
		});
		expect(setters[0]).toHaveBeenNthCalledWith(1, "task_archive");
		expect(setters[0]).toHaveBeenLastCalledWith(null);
	});

	it("does not archive when confirmation is declined", async () => {
		vi.mocked(window.confirm).mockReturnValue(false);
		setup();
		const { ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		);
		const onComplete = vi.fn();
		const root = ReviewStatusViewer({
			detail: null,
			activeTaskId: "task-1",
			onCompleteAndArchiveTask: onComplete,
		});
		await archiveButton(root)?.props.onClick();
		expect(onComplete).not.toHaveBeenCalled();
	});

	it("uses pending closeout wording and reports archive Error and string failures", async () => {
		setup();
		let { ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		);
		let root = ReviewStatusViewer({
			detail: null,
			activeTaskId: "task-1",
			gitCloseout: { commitRecord: { status: "pending" } } as never,
			onCompleteAndArchiveTask: vi.fn(async () => {
				throw new Error("archive failed");
			}),
		});
		await archiveButton(root)?.props.onClick();
		expect(setters[1]).toHaveBeenCalledWith("archive failed");

		setup();
		({ ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		));
		root = ReviewStatusViewer({
			detail: null,
			activeTaskId: "task-1",
			onCompleteAndArchiveTask: vi.fn(async () => {
				throw "bad";
			}),
		});
		await archiveButton(root)?.props.onClick();
		expect(setters[1]).toHaveBeenCalledWith(
			"Task status could not be updated.",
		);
	});

	it("restores archived tasks and disables unavailable actions", async () => {
		setup();
		let { ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		);
		const restore = vi.fn(async () => undefined);
		let root = ReviewStatusViewer({
			detail: null,
			activeTaskId: "task-1",
			activeTaskStatus: "archived",
			onRestoreArchivedTask: restore,
		});
		expect(archiveButton(root)?.props["data-review-task-archive-action"]).toBe(
			"restore",
		);
		await archiveButton(root)?.props.onClick();
		expect(restore).toHaveBeenCalledWith("task-1");

		setup(["task_archive", null, null]);
		({ ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		));
		root = ReviewStatusViewer({
			detail: null,
			activeTaskId: "task-1",
			activeTaskStatus: "archived",
		});
		expect(archiveButton(root)?.props.disabled).toBe(true);
		expect(
			named(root, "ReviewPromptActions")[0].props.disabledStatusMessage,
		).toContain("別の操作");
	});

	it("renders the latest valid review and security artifacts", async () => {
		setup();
		const { ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		);
		const root = ReviewStatusViewer({
			detail: detail() as never,
			onSubmitReviewPrompt: vi.fn(),
		});
		const result = named(root, "ReviewRunResultPanel")[0];
		expect(result.props.reviewRun).toMatchObject({ status: "running" });
		expect(result.props.visibleFindings).toMatchObject([
			{ title: "Run finding", filePath: "a.ts" },
		]);
		expect(result.props.securityArtifact).toMatchObject({ id: "security" });
		expect(
			elements(root).some(
				(element) => element.props["data-review-section"] === "review-run",
			),
		).toBe(true);
	});

	it("prefers persisted findings and handles malformed review artifacts", async () => {
		setup();
		let { ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		);
		let root = ReviewStatusViewer({
			detail: detail({
				findings: [
					{
						id: "finding-1",
						severity: "blocking",
						title: "Persisted",
						body: null,
					},
				],
				artifacts: [
					artifact("bad", "review_run", []),
					artifact("wrong", "review_run", { kind: "other" }),
				],
				securityHandoffs: [],
			}) as never,
		});
		expect(named(root, "ReviewRunResultPanel")[0].props.reviewRun).toBeNull();
		expect(
			named(root, "ReviewRunResultPanel")[0].props.visibleFindings[0].title,
		).toBe("Persisted");

		setup();
		({ ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		));
		root = ReviewStatusViewer({ detail: detail({ artifacts: [] }) as never });
		expect(
			named(root, "ReviewRunResultPanel")[0].props.visibleFindings,
		).toEqual([]);
	});

	it("resolves running review status from every terminal task-run group", async () => {
		for (const [runStatus, expectedCompleted] of [
			["completed", true],
			["needs_review", true],
			["needs_human", false],
			["blocked", false],
			["failed", false],
			["timed_out", false],
			["cancelled", false],
			["running", false],
		] as const) {
			setup();
			const { ReviewStatusViewer } = await import(
				"../src/modules/review/components/ReviewStatusViewer"
			);
			const root = ReviewStatusViewer({
				detail: detail() as never,
				latestRun: {
					id: "review-run",
					taskId: "task-1",
					status: runStatus,
				} as never,
			});
			const hasLevel = elements(root).some(
				(element) =>
					typeof element.props.className === "string" &&
					element.props.className.includes("border-red-500"),
			);
			expect(hasLevel).toBe(!expectedCompleted);
		}
	});

	it("covers recommendation classes, approved completion, prompt guards, and waiting reset", async () => {
		for (const level of ["recommended", "optional"] as const) {
			setup();
			const { ReviewStatusViewer } = await import(
				"../src/modules/review/components/ReviewStatusViewer"
			);
			const root = ReviewStatusViewer({
				detail: detail({
					statusArtifact: { recommendation: { level } },
				}) as never,
			});
			expect(
				elements(root).some(
					(element) =>
						typeof element.props.className === "string" &&
						element.props.className.includes(
							level === "recommended" ? "amber" : "cyan",
						),
				),
			).toBe(true);
		}

		setup([null, null, { actionId: "code_review", phase: "waiting" }]);
		const { ReviewStatusViewer } = await import(
			"../src/modules/review/components/ReviewStatusViewer"
		);
		const root = ReviewStatusViewer({
			detail: detail({
				session: { ...detail().session, status: "approved" },
			}) as never,
			isReviewPromptDisabled: false,
			onSubmitReviewPrompt: vi.fn(),
		});
		effects[0]();
		expect(setters[2]).toHaveBeenCalledWith(null);
		expect(named(root, "ReviewPromptActions")[0].props.disabled).toBe(true);
	});
});
