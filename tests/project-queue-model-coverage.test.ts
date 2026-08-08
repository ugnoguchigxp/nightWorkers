import { describe, expect, it } from "vitest";
import {
	buildProjectQueueTasks,
	compareProjectQueuePriority,
	getProjectQueueLaneOrder,
	getProjectQueuePriorityLabel,
	getProjectQueueStatusLabel,
	groupProjectQueueTasks,
	projectQueueTimestamp,
	sortProjectQueueTasksForTable,
} from "../src/modules/queue/projectQueueModel";

const project = { id: "p1", name: "Project" };
const otherProject = { id: "p2", name: "Other" };

function task(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		repositoryId: "p1",
		title: id,
		status: "ready",
		updatedAt: "2026-08-08T00:00:00.000Z",
		...overrides,
	};
}

function entry(
	id: string,
	status: string,
	overrides: Record<string, unknown> = {},
) {
	const source = task(
		id,
		overrides.task as Record<string, unknown> | undefined,
	);
	return {
		id: `entry-${id}`,
		taskId: id,
		repositoryId: source.repositoryId,
		status,
		queuePosition: null,
		processorSlot: null,
		activeRunId: null,
		statusReason: null,
		updatedAt: source.updatedAt,
		executionType: null,
		task: source,
		repository: project,
		...overrides,
	};
}

function dashboard(overrides: Record<string, unknown> = {}) {
	return {
		settings: { processorCount: 2 },
		processors: [],
		queued: [],
		completed: [],
		notQueued: [],
		...overrides,
	};
}

describe("project queue model coverage", () => {
	it("maps every queue entry terminal status and requeue rule", () => {
		const statuses = [
			"queued",
			"claimed",
			"processing",
			"needs_human",
			"awaiting_commit_decision",
			"execution_completed",
			"failed",
			"cancelled",
			"execution_archived",
			"completed",
		];
		const completed = statuses.map((status) =>
			entry(status, status, {
				queuePosition: status === "queued" ? 4 : null,
				processorSlot: status === "processing" ? 2 : null,
				executionType: status === "failed" ? "retry" : null,
			}),
		);
		const tasks = buildProjectQueueTasks({
			project,
			sessions: [],
			sessionViews: [],
			implementationQueue: dashboard({ completed }),
		} as never);
		const byId = new Map(tasks.map((item) => [item.id, item]));
		expect(byId.get("queued")?.status).toBe("queued");
		expect(byId.get("claimed")?.status).toBe("running");
		expect(byId.get("processing")?.status).toBe("running");
		expect(byId.get("needs_human")).toMatchObject({
			status: "needs_human",
			canMoveToPlanned: true,
		});
		expect(byId.get("awaiting_commit_decision")).toMatchObject({
			status: "review_required",
			canMoveToPlanned: false,
		});
		expect(byId.get("execution_completed")?.status).toBe("review_required");
		expect(byId.get("failed")).toMatchObject({
			status: "failed",
			executionType: "retry",
			canMoveToPlanned: true,
		});
		expect(byId.get("cancelled")?.status).toBe("cancelled");
		expect(byId.get("execution_archived")?.status).toBe("archived");
		expect(byId.get("completed")?.status).toBe("completed");
		expect(
			tasks
				.filter((item) => item.status !== "queued")
				.every((item) => item.queuePosition === null),
		).toBe(true);
	});

	it("uses queue, not-queued, and processor precedence while filtering other projects", () => {
		const ready = task("ready");
		const processing = entry("running", "processing");
		const claimed = entry("claimed", "claimed");
		const other = entry("other", "processing", {
			repository: otherProject,
			task: task("other", { repositoryId: "p2" }),
		});
		const tasks = buildProjectQueueTasks({
			project,
			sessions: [ready, task("ignored", { repositoryId: "p2" })],
			sessionViews: [],
			implementationQueue: dashboard({
				notQueued: [
					{ task: ready, repository: project },
					{
						task: task("other-ready", { repositoryId: "p2" }),
						repository: otherProject,
					},
				],
				queued: [
					entry("wrong-status", "processing"),
					{ ...entry("other-queued", "queued"), repository: otherProject },
				],
				processors: [
					{ slot: 3, entry: processing },
					{ slot: 1, entry: claimed },
					{ slot: 2, entry: null },
					{ slot: 4, entry: other },
					{ slot: 5, entry: entry("done-processor", "completed") },
				],
			}),
		} as never);
		expect(tasks.find((item) => item.id === "ready")).toMatchObject({
			status: "ready_for_queue",
			phase: "Plan Complete",
			canMoveToPlanned: true,
		});
		expect(tasks.find((item) => item.id === "running")).toMatchObject({
			status: "running",
			processorSlot: 3,
		});
		expect(tasks.find((item) => item.id === "claimed")).toMatchObject({
			status: "running",
			processorSlot: 1,
		});
		expect(tasks.some((item) => item.projectId === "p2")).toBe(false);
	});

	it("projects attention views only when they are not superseded", () => {
		const views = [
			{ task: task("needs"), emailState: "needs_input", phase: "Waiting" },
			{
				task: task("failed-view", { status: "queued" }),
				emailState: "failed",
				phase: "Failed",
			},
			{ task: task("review"), emailState: "review_needed", phase: "Review" },
			{ task: task("ignored"), emailState: "working", phase: "Work" },
			{
				task: task("entry-wins"),
				emailState: "failed",
				phase: "Failed",
				queueEntry: { id: "present" },
			},
			{
				task: task("archived"),
				emailState: "failed",
				phase: "Failed",
				group: "archive",
			},
		];
		const tasks = buildProjectQueueTasks({
			project,
			sessions: [],
			sessionViews: views,
			implementationQueue: dashboard({
				notQueued: [{ task: task("needs"), repository: project }],
				completed: [entry("entry-wins", "failed")],
			}),
		} as never);
		expect(tasks.find((item) => item.id === "needs")).toMatchObject({
			status: "needs_human",
			canMoveToPlanned: true,
		});
		expect(tasks.find((item) => item.id === "failed-view")).toMatchObject({
			status: "failed",
			canMoveToPlanned: true,
		});
		expect(tasks.find((item) => item.id === "review")?.status).toBe(
			"review_required",
		);
		expect(tasks.find((item) => item.id === "ignored")?.status).toBe(
			"unclassified",
		);
		expect(
			tasks.find((item) => item.id === "entry-wins")?.queueEntryStatus,
		).toBe("failed");
		expect(tasks.find((item) => item.id === "archived")).toMatchObject({
			status: "archived",
			phase: "Completed + Archived",
		});
	});

	it("covers project-evaluation plan-state exceptions", () => {
		const states = [
			"plan_ready",
			"queued",
			"running",
			"done",
			"review_needed",
			"needs_input",
		];
		const sessions = states.map((state) =>
			task(state, { createdBy: "project-evaluation" }),
		);
		const sessionViews = states.map((state, index) => ({
			task: sessions[index],
			emailState: state,
			phase: "Phase",
		}));
		const tasks = buildProjectQueueTasks({
			project,
			sessions,
			sessionViews,
			implementationQueue: null,
		} as never);
		expect(tasks.find((item) => item.id === "needs_input")?.status).toBe(
			"needs_human",
		);
		expect(tasks.find((item) => item.id === "plan_ready")?.status).toBe(
			"ready_for_queue",
		);
		expect(tasks.find((item) => item.id === "done")?.status).toBe("completed");
		expect(tasks.some((item) => item.status === "plan_mode")).toBe(false);
	});

	it("groups and sorts every lane with missing and tied positions", () => {
		const rows = [
			{ ...task("u-old", { updatedAt: 1 }), status: "unclassified" },
			{ ...task("plan", { updatedAt: 2 }), status: "plan_mode" },
			{ ...task("ready", { updatedAt: 3 }), status: "ready_for_queue" },
			{ ...task("q2", { updatedAt: 4 }), status: "queued", queuePosition: 2 },
			{
				...task("q-none", { updatedAt: 5 }),
				status: "queued",
				queuePosition: null,
			},
			{
				...task("run2", { updatedAt: 6 }),
				status: "running",
				processorSlot: 2,
			},
			{
				...task("run-none", { updatedAt: 7 }),
				status: "running",
				processorSlot: null,
			},
			{ ...task("failed", { updatedAt: 8 }), status: "failed" },
			{ ...task("completed", { updatedAt: 9 }), status: "completed" },
			{ ...task("archived", { updatedAt: 10 }), status: "archived" },
		];
		const lanes = groupProjectQueueTasks(rows as never);
		expect(lanes.unclassified.map((row) => row.id)).toEqual(["plan", "u-old"]);
		expect(lanes.planned.map((row) => row.id)).toEqual([
			"q2",
			"q-none",
			"ready",
		]);
		expect(lanes.executing.map((row) => row.id)).toEqual(["run2", "run-none"]);
		expect(lanes.complete.map((row) => row.id)).toEqual([
			"failed",
			"completed",
			"archived",
		]);
		expect(sortProjectQueueTasksForTable(rows as never)[0].id).toBe("run2");
		expect(getProjectQueueLaneOrder()).toEqual([
			"unclassified",
			"planned",
			"executing",
			"complete",
		]);
	});

	it("labels every status and compares queue priority", () => {
		const statuses = [
			"unclassified",
			"plan_mode",
			"ready_for_queue",
			"queued",
			"running",
			"review_required",
			"needs_human",
			"archived",
			"failed",
			"cancelled",
			"completed",
		] as const;
		expect(statuses.map(getProjectQueueStatusLabel)).toEqual([
			"Unclassified",
			"Plan Mode",
			"Ready for Queue",
			"Implementation Queue",
			"Running",
			"Review Required",
			"Needs Human",
			"Archived",
			"Failed",
			"Cancelled",
			"Completed",
		]);
		const q1 = { status: "queued", queuePosition: 1 } as never;
		const q2 = { status: "queued", queuePosition: 2 } as never;
		const none = { status: "completed", queuePosition: 3 } as never;
		expect(getProjectQueuePriorityLabel(q1)).toBe("#1");
		expect(
			getProjectQueuePriorityLabel({
				status: "queued",
				queuePosition: null,
			} as never),
		).toBe("");
		expect(compareProjectQueuePriority(none, none)).toBe(0);
		expect(compareProjectQueuePriority(none, q1)).toBe(1);
		expect(compareProjectQueuePriority(q1, none)).toBe(-1);
		expect(compareProjectQueuePriority(q1, q2)).toBe(-1);
	});

	it("normalizes timestamps from all supported value types", () => {
		expect(
			projectQueueTimestamp(new Date("2026-08-08T00:00:00Z")),
		).toBeGreaterThan(0);
		expect(projectQueueTimestamp(42)).toBe(42);
		expect(projectQueueTimestamp(Number.NaN)).toBe(0);
		expect(projectQueueTimestamp("2026-08-08T00:00:00Z")).toBeGreaterThan(0);
		expect(projectQueueTimestamp("bad")).toBe(0);
		expect(projectQueueTimestamp(null)).toBe(0);
	});

	it("throws when neither a task nor queue entry is available", () => {
		expect(() =>
			buildProjectQueueTasks({
				project,
				sessions: [],
				sessionViews: [],
				implementationQueue: dashboard({
					notQueued: [{ task: undefined, repository: project }],
				}),
			} as never),
		).toThrow();
	});
});
