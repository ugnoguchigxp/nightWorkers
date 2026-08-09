import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
	stateValues: [] as unknown[],
	setters: [] as Array<ReturnType<typeof vi.fn>>,
	tasks: [] as Array<Record<string, unknown>>,
	lanes: {
		unclassified: [],
		planned: [],
		executing: [],
		complete: [],
	} as Record<string, Array<Record<string, unknown>>>,
	dndProps: null as Record<string, unknown> | null,
	closestCollisions: [] as Array<{ id: string }>,
	pointerCollisions: [] as Array<{ id: string }>,
	reorderUpdates: [] as Array<{ entryId: string; queuePosition: number }>,
	attentionMove: false,
	buildTasks: vi.fn(),
	groupTasks: vi.fn(),
	closestCenter: vi.fn(),
	pointerWithin: vi.fn(),
	buildReorder: vi.fn(),
	isAttentionMove: vi.fn(),
	handleAnchor: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useMemo: <T,>(factory: () => T) => factory(),
		useState: <T,>(initial: T | (() => T)) => {
			const value =
				controls.stateValues.length > 0
					? (controls.stateValues.shift() as T)
					: typeof initial === "function"
						? (initial as () => T)()
						: initial;
			const setter = vi.fn((next: T | ((previous: T) => T)) => {
				if (typeof next === "function") {
					return (next as (previous: T) => T)(value);
				}
				return next;
			});
			controls.setters.push(setter);
			return [value, setter] as const;
		},
	};
});

vi.mock("@dnd-kit/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@dnd-kit/core")>();
	return {
		...actual,
		closestCenter: controls.closestCenter,
		pointerWithin: controls.pointerWithin,
		DndContext: (props: Record<string, unknown>) => {
			controls.dndProps = props;
			return <mock-dnd-context>{props.children as never}</mock-dnd-context>;
		},
		DragOverlay: ({ children }: { children: unknown }) => (
			<mock-drag-overlay>{children as never}</mock-drag-overlay>
		),
		KeyboardSensor: "keyboard-sensor",
		PointerSensor: "pointer-sensor",
		useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
		useSensors: (...sensors: unknown[]) => sensors,
	};
});

vi.mock("@dnd-kit/sortable", () => ({
	sortableKeyboardCoordinates: vi.fn(),
}));

vi.mock("lucide-react", () => ({
	Rows3: () => <mock-rows-icon />,
	Table2: () => <mock-table-icon />,
}));

vi.mock("../src/modules/nightworkers/routing/workbench-link-click", () => ({
	handleWorkbenchAnchorClick: controls.handleAnchor,
}));

vi.mock("../src/modules/nightworkers/routing/workbench-route-state", () => ({
	serializeWorkbenchRoute: (route: Record<string, unknown>) =>
		`/${String(route.projectId)}/${String(route.view)}`,
}));

vi.mock("../src/modules/queue/ProjectQueueBoard", () => ({
	ProjectQueueBoard: ({
		activeTask,
		lanes,
	}: {
		activeTask: Record<string, unknown> | null;
		lanes: Record<string, unknown[]>;
	}) => (
		<mock-board
			data-active={String(activeTask?.id ?? "none")}
			data-executing={String(lanes.executing.length)}
		/>
	),
}));

vi.mock("../src/modules/queue/ProjectQueueTable", () => ({
	ProjectQueueTable: ({ tasks }: { tasks: unknown[] }) => (
		<mock-table data-count={String(tasks.length)} />
	),
}));

vi.mock("../src/modules/queue/ProjectQueueTaskCard", () => ({
	ProjectQueueTaskCardPreview: ({
		task,
	}: {
		task: Record<string, unknown>;
	}) => <mock-preview>{String(task.title)}</mock-preview>,
}));

vi.mock("../src/modules/queue/projectQueueDnd", () => ({
	buildPlannedReorderUpdates: controls.buildReorder,
	isAttentionToPlannedMove: controls.isAttentionMove,
	isProjectQueueLaneDomId: (id: string) => id.startsWith("lane-"),
}));

vi.mock("../src/modules/queue/projectQueueModel", () => ({
	buildProjectQueueTasks: controls.buildTasks,
	groupProjectQueueTasks: controls.groupTasks,
}));

import { ProjectQueueScreen } from "../src/modules/queue/ProjectQueueScreen";

function task(
	id: string,
	status: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		sessionId: `session-${id}`,
		projectId: "project-1",
		title: `Task ${id}`,
		status,
		phase: status,
		...overrides,
	};
}

function props(overrides: Record<string, unknown> = {}) {
	return {
		project: { id: "project-1", name: "Project One" },
		sessions: [],
		sessionViews: [],
		implementationQueue: null,
		isLoading: false,
		viewMode: "board",
		onViewModeChange: vi.fn(),
		onOpenSession: vi.fn(),
		onRequeueEntry: vi.fn(async () => undefined),
		onQueueSession: vi.fn(async () => undefined),
		onUpdateQueueEntry: vi.fn(async () => undefined),
		...overrides,
	} as never;
}

function renderScreen(
	overrides: Record<string, unknown> = {},
	stateValues: unknown[] = [],
) {
	controls.stateValues = [...stateValues];
	controls.setters = [];
	controls.dndProps = null;
	const screenProps = props(overrides);
	const markup = renderToStaticMarkup(<ProjectQueueScreen {...screenProps} />);
	return {
		markup,
		screenProps,
		dnd: controls.dndProps as Record<string, unknown>,
	};
}

async function settleDrag() {
	await Promise.resolve();
	await Promise.resolve();
}

beforeEach(() => {
	controls.tasks = [];
	controls.lanes = {
		unclassified: [],
		planned: [],
		executing: [],
		complete: [],
	};
	controls.closestCollisions = [];
	controls.pointerCollisions = [];
	controls.reorderUpdates = [];
	controls.attentionMove = false;
	vi.clearAllMocks();
	controls.buildTasks.mockImplementation(() => controls.tasks);
	controls.groupTasks.mockImplementation(() => controls.lanes);
	controls.closestCenter.mockImplementation(() => controls.closestCollisions);
	controls.pointerWithin.mockImplementation(() => controls.pointerCollisions);
	controls.buildReorder.mockImplementation(() => controls.reorderUpdates);
	controls.isAttentionMove.mockImplementation(() => controls.attentionMove);
	controls.handleAnchor.mockImplementation(
		(_event: unknown, callback: () => void) => callback(),
	);
});

describe("ProjectQueueScreen extra coverage", () => {
	it("renders empty, loading table, populated board, overlay, and persisting states", () => {
		let rendered = renderScreen();
		expect(rendered.markup).toContain("This project has no Sessions");
		expect(rendered.markup).toContain("0 global slots / 0 occupied");
		expect(rendered.markup).toContain("mock-table-icon");

		rendered = renderScreen({ isLoading: true, viewMode: "table" });
		expect(rendered.markup).toContain("Loading queue...");
		expect(rendered.markup).toContain('data-count="0"');
		expect(rendered.markup).toContain("mock-rows-icon");

		const running = task("running", "running");
		controls.tasks = [running];
		controls.lanes.executing = [running];
		rendered = renderScreen(
			{
				implementationQueue: {
					settings: { processorCount: 3 },
					processors: [{ entry: { id: "entry" } }, { entry: null }],
				},
			},
			["running", false],
		);
		expect(rendered.markup).toContain(
			"3 global slots / 1 occupied / 1 project executing",
		);
		expect(rendered.markup).toContain('data-active="running"');
		expect(rendered.markup).toContain("Task running");

		rendered = renderScreen({ viewMode: "table" }, [null, true]);
		expect(rendered.markup).toContain("Saving queue order...");
	});

	it("toggles board and table through the workbench link callback", () => {
		let rendered = renderScreen({ viewMode: "board" });
		let anchor = findElement(
			rendered.dnd.children,
			(node) => node.props?.["data-view-toggle"] === "project-queue",
		);
		expect(anchor?.props.href).toBe("/project-1/table");
		expect(anchor?.props.title).toBe("Switch to Table view");
		anchor?.props.onClick({ preventDefault: vi.fn() });
		expect(rendered.screenProps.onViewModeChange).toHaveBeenCalledWith("table");

		rendered = renderScreen({ viewMode: "table" });
		anchor = findElement(
			rendered.dnd.children,
			(node) => node.props?.["data-view-toggle"] === "project-queue",
		);
		expect(anchor?.props.href).toBe("/project-1/board");
		expect(anchor?.props.title).toBe("Switch to Queue view");
		anchor?.props.onClick({ preventDefault: vi.fn() });
		expect(rendered.screenProps.onViewModeChange).toHaveBeenCalledWith("board");
	});

	it("chooses queued and pointer collision fallbacks", () => {
		const rendered = renderScreen();
		const collisionDetection = rendered.dnd.collisionDetection as (
			args: Record<string, unknown>,
		) => Array<{ id: string }>;
		const args = (status?: string) => ({
			active: {
				id: "active",
				data: { current: status ? { status } : undefined },
			},
		});

		controls.closestCollisions = [
			{ id: "lane-planned" },
			{ id: "active" },
			{ id: "queued-target" },
		];
		expect(collisionDetection(args("queued"))).toEqual([
			{ id: "queued-target" },
		]);
		controls.closestCollisions = [{ id: "lane-planned" }, { id: "active" }];
		expect(collisionDetection(args("queued"))).toEqual(
			controls.closestCollisions,
		);

		controls.pointerCollisions = [
			{ id: "lane-complete" },
			{ id: "active" },
			{ id: "pointer-target" },
		];
		expect(collisionDetection(args("running"))).toEqual([
			{ id: "pointer-target" },
		]);
		controls.pointerCollisions = [{ id: "lane-complete" }];
		expect(collisionDetection(args())).toEqual(controls.pointerCollisions);
		controls.pointerCollisions = [];
		controls.closestCollisions = [{ id: "closest-fallback" }];
		expect(collisionDetection(args())).toEqual(controls.closestCollisions);
	});

	it("handles drag start, cancel, missing targets, no-op reorder, and persisted reorder", async () => {
		const queuedA = task("queued-a", "queued", {
			queueEntryId: "entry-a",
		});
		const queuedB = task("queued-b", "queued", {
			queueEntryId: "entry-b",
		});
		controls.tasks = [queuedA, queuedB];
		controls.lanes.planned = [queuedA, queuedB];
		const rendered = renderScreen();
		const onDragStart = rendered.dnd.onDragStart as (
			event: Record<string, unknown>,
		) => void;
		const onDragCancel = rendered.dnd.onDragCancel as () => void;
		const onDragEnd = rendered.dnd.onDragEnd as (
			event: Record<string, unknown>,
		) => void;

		onDragStart({ active: { id: 42 } });
		expect(controls.setters[0]).toHaveBeenCalledWith("42");
		onDragCancel();
		expect(controls.setters[0]).toHaveBeenCalledWith(null);

		onDragEnd({ active: { id: "missing" }, over: { id: "queued-b" } });
		onDragEnd({ active: { id: "queued-a" }, over: null });
		expect(controls.buildReorder).not.toHaveBeenCalled();

		onDragEnd({ active: { id: "queued-a" }, over: { id: "queued-b" } });
		await settleDrag();
		expect(controls.buildReorder).toHaveBeenCalled();
		expect(rendered.screenProps.onUpdateQueueEntry).not.toHaveBeenCalled();

		controls.reorderUpdates = [
			{ entryId: "entry-a", queuePosition: 2 },
			{ entryId: "entry-b", queuePosition: 1 },
		];
		onDragEnd({ active: { id: "queued-a" }, over: { id: "queued-b" } });
		await settleDrag();
		expect(rendered.screenProps.onUpdateQueueEntry).toHaveBeenCalledWith(
			"entry-a",
			{ queuePosition: 2 },
		);
		expect(rendered.screenProps.onUpdateQueueEntry).toHaveBeenCalledWith(
			"entry-b",
			{ queuePosition: 1 },
		);
		expect(controls.setters[1]).toHaveBeenCalledWith(true);
		expect(controls.setters[1]).toHaveBeenCalledWith(false);
	});

	it("moves attention tasks by queue entry or session and ignores other drops", async () => {
		const withEntry = task("attention-entry", "needs_human", {
			queueEntryId: "entry-attention",
		});
		const withoutEntry = task("attention-session", "failed");
		const queued = task("queued", "queued");
		controls.tasks = [withEntry, withoutEntry, queued];
		controls.lanes.complete = [withEntry, withoutEntry];
		controls.lanes.planned = [queued];
		controls.attentionMove = true;
		const rendered = renderScreen();
		const onDragEnd = rendered.dnd.onDragEnd as (
			event: Record<string, unknown>,
		) => void;

		onDragEnd({ active: { id: "attention-entry" }, over: { id: "queued" } });
		await settleDrag();
		expect(rendered.screenProps.onRequeueEntry).toHaveBeenCalledWith(
			"entry-attention",
			"Returned to Implementation Queue from Project Queue.",
		);

		onDragEnd({
			active: { id: "attention-session" },
			over: { id: "lane-planned" },
		});
		await settleDrag();
		expect(rendered.screenProps.onQueueSession).toHaveBeenCalledWith(
			"session-attention-session",
		);

		controls.attentionMove = false;
		onDragEnd({
			active: { id: "attention-session" },
			over: { id: "lane-complete" },
		});
		await settleDrag();
		expect(rendered.screenProps.onQueueSession).toHaveBeenCalledTimes(1);
	});

	it("uses a null active task when the selected task disappeared", () => {
		controls.tasks = [task("present", "queued")];
		controls.lanes.planned = controls.tasks;
		const rendered = renderScreen({}, ["missing", false]);
		expect(rendered.markup).toContain('data-active="none"');
		expect(rendered.markup).not.toContain("mock-preview");
		expect(controls.buildTasks).toHaveBeenCalled();
		expect(controls.groupTasks).toHaveBeenCalledWith(controls.tasks);
	});
});

type ElementLike = {
	props?: Record<string, unknown>;
};

function findElement(
	node: unknown,
	predicate: (node: ElementLike) => boolean,
): ElementLike | null {
	if (!node || typeof node !== "object") return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const match = findElement(child, predicate);
			if (match) return match;
		}
		return null;
	}
	const element = node as ElementLike;
	if (predicate(element)) return element;
	return findElement(element.props?.children, predicate);
}
