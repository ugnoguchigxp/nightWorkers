import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
	sortable: {} as Record<string, unknown>,
	draggable: {} as Record<string, unknown>,
	useSortable: vi.fn(),
	useDraggable: vi.fn(),
	transformToString: vi.fn(),
	translateToString: vi.fn(),
}));

vi.mock("@dnd-kit/core", () => ({
	useDraggable: controls.useDraggable,
}));

vi.mock("@dnd-kit/sortable", () => ({
	useSortable: controls.useSortable,
}));

vi.mock("@dnd-kit/utilities", () => ({
	CSS: {
		Transform: { toString: controls.transformToString },
		Translate: { toString: controls.translateToString },
	},
}));

vi.mock("lucide-react", () => ({
	AlertTriangle: ({ className }: { className: string }) => (
		<mock-alert data-class={className} />
	),
	CheckCircle2: ({ className }: { className: string }) => (
		<mock-check data-class={className} />
	),
	GripVertical: ({ className }: { className: string }) => (
		<mock-grip data-class={className} />
	),
	Play: ({ className }: { className: string }) => (
		<mock-play data-class={className} />
	),
}));

vi.mock("../src/modules/queue/projectQueueModel", () => ({
	getProjectQueuePriorityLabel: (task: Record<string, unknown>) =>
		(task.priorityLabel as string | undefined) ?? "",
	getProjectQueueStatusLabel: (status: string) => `STATUS:${status}`,
}));

vi.mock("../src/modules/queue/queueTime", () => ({
	getRelativeTimestamp: (value: unknown) => `TIME:${String(value)}`,
}));

import {
	DraggableProjectQueueTaskCard,
	ProjectQueueTaskCardPreview,
	SortableProjectQueueTaskCard,
	StaticProjectQueueTaskCard,
} from "../src/modules/queue/ProjectQueueTaskCard";

function task(status: string, overrides: Record<string, unknown> = {}) {
	return {
		id: `task-${status}`,
		sessionId: `session-${status}`,
		projectId: "project-1",
		title: `Title ${status}`,
		status,
		phase: `Phase ${status}`,
		updatedAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	} as never;
}

function invokeFrame(element: ReactElement) {
	return (element.type as (props: Record<string, unknown>) => ReactElement)(
		element.props as Record<string, unknown>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	controls.sortable = {
		attributes: { "aria-describedby": "sortable-description" },
		listeners: { onPointerDown: vi.fn() },
		setNodeRef: vi.fn(),
		transform: { x: 1, y: 2, scaleX: 1, scaleY: 1 },
		transition: "transform 100ms",
		isDragging: true,
	};
	controls.draggable = {
		attributes: { "aria-roledescription": "draggable" },
		listeners: { onPointerDown: vi.fn() },
		setNodeRef: vi.fn(),
		transform: { x: 3, y: 4 },
		isDragging: false,
	};
	controls.useSortable.mockImplementation(() => controls.sortable);
	controls.useDraggable.mockImplementation(() => controls.draggable);
	controls.transformToString.mockImplementation(() => "matrix-sortable");
	controls.translateToString.mockImplementation(() => "translate-draggable");
});

describe("ProjectQueueTaskCard extra coverage", () => {
	it("wires sortable drag state, styles, ref, attributes, and open callback", () => {
		const onOpenSession = vi.fn();
		const cardTask = task("queued");
		const frame = SortableProjectQueueTaskCard({
			task: cardTask,
			onOpenSession,
		}) as ReactElement;
		expect(controls.useSortable).toHaveBeenCalledWith({
			id: "task-queued",
			data: { status: "queued" },
		});
		expect(frame.props).toMatchObject({
			isDragging: true,
			style: {
				transform: "matrix-sortable",
				transition: "transform 100ms",
			},
		});
		const button = invokeFrame(frame);
		expect(button.props.className).toContain("cursor-grab");
		expect(button.props.className).toContain("opacity-45");
		expect(button.props["aria-describedby"]).toBe("sortable-description");
		button.props.onClick();
		expect(onOpenSession).toHaveBeenCalledWith("session-queued");
		button.props.ref(null);
		expect(controls.sortable.setNodeRef).toHaveBeenCalledWith(null);
	});

	it("wires draggable translation and supports the absent open callback", () => {
		const cardTask = task("review_required");
		const frame = DraggableProjectQueueTaskCard({
			task: cardTask,
		}) as ReactElement;
		expect(controls.useDraggable).toHaveBeenCalledWith({
			id: "task-review_required",
			data: { status: "review_required" },
		});
		expect(frame.props).toMatchObject({
			isDragging: false,
			style: { transform: "translate-draggable" },
		});
		const button = invokeFrame(frame);
		expect(button.props.className).toContain("cursor-grab");
		expect(button.props.className).not.toContain("opacity-45");
		expect(() => button.props.onClick()).not.toThrow();
	});

	it("renders every status icon, tone, footer, and running fallback", () => {
		const cases = [
			["plan_mode", "Plan Mode before implementation", "text-violet-300"],
			["unclassified", "not in implementation queue", "text-slate-400"],
			[
				"ready_for_queue",
				"ready to enter the implementation queue",
				"text-emerald-300",
			],
			["queued", "queued for implementation", "text-emerald-300"],
			["running", "active run", "text-cyan-300"],
			["review_required", "review required", "text-amber-300"],
			["needs_human", "human input required", "text-amber-300"],
			["failed", "failed", "text-amber-300"],
			["cancelled", "cancelled", "text-amber-300"],
			["archived", "completed and archived", "text-slate-300"],
			["completed", "completed", "text-slate-400"],
		] as const;

		for (const [status, footer, iconClass] of cases) {
			const markup = renderToStaticMarkup(
				<StaticProjectQueueTaskCard task={task(status)} />,
			);
			expect(markup).toContain(footer);
			expect(markup).toContain(iconClass);
			expect(markup).toContain(`STATUS:${status}`);
			expect(markup).toContain(`TIME:2026-08-01T00:00:00.000Z`);
			if (
				["review_required", "needs_human", "failed", "cancelled"].includes(
					status,
				)
			) {
				expect(markup).toContain("mock-alert");
			} else if (status === "running") {
				expect(markup).toContain("mock-play");
			} else {
				expect(markup).toContain("mock-grip");
			}
		}

		const running = renderToStaticMarkup(
			<StaticProjectQueueTaskCard
				task={task("running", { activeRunId: "1234567890abcdef" })}
			/>,
		);
		expect(running).toContain("run 12345678");
	});

	it("prioritizes priority, processor, status reason, and execution display branches", () => {
		let markup = renderToStaticMarkup(
			<StaticProjectQueueTaskCard
				task={task("queued", {
					priorityLabel: "Priority P0",
					processorSlot: 4,
					statusReason: "Waiting for dependency",
					executionType: "exclusive",
				})}
			/>,
		);
		expect(markup).toContain("Priority P0");
		expect(markup).not.toContain("Processor 4");
		expect(markup).toContain("Waiting for dependency");
		expect(markup).toContain("exclusive");

		markup = renderToStaticMarkup(
			<StaticProjectQueueTaskCard
				task={task("running", {
					processorSlot: 2,
					executionType: "normal",
				})}
			/>,
		);
		expect(markup).toContain("Processor 2");
		expect(markup).not.toContain(">normal<");

		markup = renderToStaticMarkup(
			<StaticProjectQueueTaskCard
				task={task("completed", { processorSlot: 0 })}
			/>,
		);
		expect(markup).toContain("STATUS:completed");
	});

	it("renders the preview as dragging and covers static and preview ref fallbacks", () => {
		const preview = ProjectQueueTaskCardPreview({
			task: task("archived"),
		}) as ReactElement;
		const previewFrame = preview.props.children as ReactElement;
		const previewButton = invokeFrame(previewFrame);
		expect(previewButton.props.className).toContain("opacity-45");
		expect(previewButton.props.className).toContain("cursor-pointer");
		expect(() => previewButton.props.ref(null)).not.toThrow();

		const staticFrame = StaticProjectQueueTaskCard({
			task: task("unclassified"),
		}) as ReactElement;
		const staticButton = invokeFrame(staticFrame);
		expect(staticButton.props.className).toContain("cursor-pointer");
		expect(() => staticButton.props.ref(null)).not.toThrow();
	});
});
