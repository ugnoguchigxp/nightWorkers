import {
	Fragment,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dockControls = vi.hoisted(() => ({
	summary: null as unknown,
	executionTraceState: null as unknown,
	setExecutionTraceState: vi.fn(),
	effects: [] as Array<() => undefined | (() => void)>,
	fetchTrace: vi.fn(),
	controlTaskIds: [] as string[],
}));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useEffect: (effect: () => undefined | (() => void)) => {
			dockControls.effects.push(effect);
		},
		useMemo: <T,>(factory: () => T) => factory(),
		useState: () => [
			dockControls.executionTraceState,
			dockControls.setExecutionTraceState,
		],
	};
});

vi.mock("lucide-react", () => ({
	BrainCircuit: () => <span data-icon="brain" />,
	MessageCircleMore: () => <span data-icon="message" />,
	X: () => <span data-icon="close" />,
}));

vi.mock("../packages/mission-pilot/src/frontend/missionPilotQueries", () => ({
	useMissionPilotControl: (taskId: string) => {
		dockControls.controlTaskIds.push(taskId);
		return { summary: dockControls.summary };
	},
}));

vi.mock("../packages/mission-pilot/src/frontend/missionPilotCommands", () => ({
	fetchMissionPilotExecutionTrace: (...args: unknown[]) =>
		dockControls.fetchTrace(...args),
}));

vi.mock("../packages/mission-pilot/src/frontend/host", () => ({
	getMissionPilotFrontendHost: () => ({
		AgentDebugEventCard: ({
			event,
			timestamp,
			variant,
		}: {
			event: { id: string; message: string };
			timestamp: string;
			variant: string;
		}) => (
			<article
				data-event-id={event.id}
				data-timestamp={timestamp}
				data-variant={variant}
			>
				{event.message}
			</article>
		),
		formatRelativeTimestamp: (value: unknown) => `relative:${String(value)}`,
	}),
}));

import type { MissionPilotControlSummary } from "../packages/mission-pilot/src/contracts";
import {
	comparePilotThoughtItems,
	isMissionPilotActivityEvent,
	isMissionPilotTaskMessage,
	type MissionPilotExecutionTrace,
	type MissionPilotStoredEvent,
	mergeMissionPilotExecutionTrace,
	missionPilotStopThoughtItem,
	missionPilotTraceItems,
	PilotThoughtDock,
	type PilotThoughtItem,
} from "../packages/mission-pilot/src/frontend/components/PilotThoughtDock";
import type {
	MissionPilotActivityEvent,
	MissionPilotTask,
	MissionPilotTaskMessage,
} from "../packages/mission-pilot/src/frontend/host";

type HostElement = ReactElement<Record<string, unknown>, string>;

function collectHostElements(node: ReactNode, result: HostElement[] = []) {
	if (node === null || node === undefined || typeof node === "boolean")
		return result;
	if (Array.isArray(node)) {
		for (const child of node) collectHostElements(child, result);
		return result;
	}
	if (!isValidElement<Record<string, unknown>>(node)) return result;
	if (typeof node.type === "function") {
		return collectHostElements(node.type(node.props), result);
	}
	if (node.type === Fragment) {
		return collectHostElements(node.props.children as ReactNode, result);
	}
	if (typeof node.type === "string") {
		result.push(node as HostElement);
		collectHostElements(node.props.children as ReactNode, result);
	}
	return result;
}

function activity(
	id: string,
	overrides: Partial<MissionPilotActivityEvent> = {},
): MissionPilotActivityEvent {
	return {
		id,
		taskId: "task-1",
		runId: null,
		seq: 1,
		kind: "runtime.state",
		source: "mission_pilot",
		text: null,
		payloadJson: undefined,
		traceOwner: "mission_pilot",
		traceChannel: "pilot_thought",
		createdAt: "2026-08-09T00:00:00Z",
		...overrides,
	};
}

function message(
	id: string,
	overrides: Partial<MissionPilotTaskMessage> = {},
): MissionPilotTaskMessage {
	return {
		id,
		content: `message:${id}`,
		role: "assistant",
		traceOwner: "mission_pilot",
		traceChannel: "pilot_thought",
		createdAt: "2026-08-09T00:00:00Z",
		...overrides,
	};
}

function storedEvent(
	id: string,
	overrides: Partial<MissionPilotStoredEvent> = {},
): MissionPilotStoredEvent {
	return {
		id,
		eventType: `event:${id}`,
		phase: "working",
		contextRevision: 2,
		sourceKind: "control",
		processStatus: "processed",
		attemptCount: 1,
		createdAt: "2026-08-09T00:00:00Z",
		...overrides,
	};
}

function summary(
	overrides: Partial<MissionPilotControlSummary> = {},
): MissionPilotControlSummary {
	return {
		taskId: "task-1",
		desiredState: "stopped",
		activityState: "idle",
		phase: "paused",
		authorizationVersion: 1,
		initialPromptState: "sent",
		initialPromptMessageId: null,
		activeRunId: null,
		nextWakeAt: null,
		version: 1,
		lastErrorCode: null,
		lastError: null,
		stoppedAt: null,
		updatedAt: "2026-08-09T03:00:00Z",
		...overrides,
	} as MissionPilotControlSummary;
}

function thoughtItem(
	id: string,
	overrides: Partial<PilotThoughtItem> = {},
): PilotThoughtItem {
	return {
		id,
		source: "activity_event",
		sourceId: id,
		sequence: 1,
		createdAt: "2026-08-09T00:00:00Z",
		event: { id, message: id, createdAt: "2026-08-09T00:00:00Z" },
		...overrides,
	};
}

function entry(id: string, sequence: number) {
	return {
		id,
		sessionId: "session-1",
		sequence,
		occurredAt: `2026-08-09T00:00:0${sequence}Z`,
		kind: "thought" as const,
		summary: `thought:${id}`,
		sourceRef: { kind: "conversation", id },
	};
}

async function settle() {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

beforeEach(() => {
	dockControls.summary = null;
	dockControls.executionTraceState = null;
	dockControls.setExecutionTraceState.mockClear();
	dockControls.effects = [];
	dockControls.fetchTrace.mockReset();
	dockControls.controlTaskIds = [];
});

describe("PilotThoughtDock extra coverage", () => {
	it("filters trace ownership and compares every ordering boundary", () => {
		expect(isMissionPilotActivityEvent(activity("valid"))).toBe(true);
		expect(
			isMissionPilotActivityEvent(
				activity("owner", { traceOwner: "coding_agent" }),
			),
		).toBe(false);
		expect(
			isMissionPilotActivityEvent(
				activity("channel", { traceChannel: "chat" }),
			),
		).toBe(false);
		expect(isMissionPilotTaskMessage(message("valid"))).toBe(true);
		expect(
			isMissionPilotTaskMessage(
				message("owner", { traceOwner: "coding_agent" }),
			),
		).toBe(false);
		expect(
			isMissionPilotTaskMessage(message("channel", { traceChannel: "chat" })),
		).toBe(false);

		expect(
			comparePilotThoughtItems(
				thoughtItem("later", { createdAt: "2026-08-09T00:00:01Z" }),
				thoughtItem("earlier"),
			),
		).toBeGreaterThan(0);
		expect(
			comparePilotThoughtItems(
				thoughtItem("invalid", {
					createdAt: "invalid",
					source: "task_message",
				}),
				thoughtItem("valid", { createdAt: null, source: "activity_event" }),
			),
		).toBeGreaterThan(0);
		expect(
			comparePilotThoughtItems(
				thoughtItem("sequence-2", { sequence: 2 }),
				thoughtItem("sequence-1", { sequence: 1 }),
			),
		).toBeGreaterThan(0);
		expect(
			comparePilotThoughtItems(
				thoughtItem("missing-sequence", { sequence: undefined }),
				thoughtItem("with-sequence", { sequence: 1 }),
			),
		).toBeGreaterThan(0);
		expect(
			comparePilotThoughtItems(
				thoughtItem("same-a", {
					source: "unified_entry",
					sourceId: "a",
					sequence: 1,
				}),
				thoughtItem("same-b", {
					source: "mission_pilot_event",
					sourceId: "b",
					sequence: 1,
				}),
			),
		).toBeLessThan(0);
	});

	it("projects unified and legacy traces with all optional payload shapes", () => {
		const unified = missionPilotTraceItems({
			activityEvents: [activity("ignored-activity")],
			entries: [
				{
					...entry("full", 2),
					status: "succeeded",
					details: { result: "done" },
				},
				entry("minimal", 1),
			],
		});
		expect(unified.map((item) => item.source)).toEqual([
			"unified_entry",
			"unified_entry",
		]);
		expect(unified[0]?.event.payloadJson).toMatchObject({
			status: "succeeded",
			result: "done",
		});
		expect(unified[1]?.event.payloadJson).toMatchObject({ status: null });
		expect(
			missionPilotTraceItems({
				activityEvents: [activity("ignored")],
				entries: [],
			}),
		).toEqual([]);

		const legacy = missionPilotTraceItems({
			events: [
				storedEvent("full", {
					cycle: 3,
					sourceId: "source-1",
					lastError: "failure",
					payloadJson: { custom: true },
				}),
				storedEvent("minimal"),
				storedEvent("filtered-run", { sourceKind: "task_run" }),
				storedEvent("full", { payloadJson: { custom: "new" } }),
			],
			activityEvents: [
				activity("activity-full", {
					runId: "run-1",
					seq: 5,
					text: "  decision  ",
					payloadJson: { tool: "inspect" },
				}),
				activity("activity-empty", {
					seq: 6,
					text: "   ",
					payloadJson: "invalid",
				}),
				activity("wrong-owner", { traceOwner: "coding_agent" }),
				activity("wrong-channel", { traceChannel: "chat" }),
			],
			messages: [
				message("message-full", {
					messageType: "markdown",
					metadataJson: { artifact: true },
				}),
				message("message-minimal"),
				message("wrong-owner", { traceOwner: "coding_agent" }),
				message("wrong-channel", { traceChannel: "chat" }),
			],
		});
		expect(legacy).toHaveLength(6);
		expect(
			legacy.find((item) => item.sourceId === "activity-full")?.event,
		).toMatchObject({ runId: "run-1", message: "decision" });
		expect(
			legacy.find((item) => item.sourceId === "activity-empty")?.event,
		).toMatchObject({ message: "runtime.state", payloadJson: undefined });
		expect(
			legacy.find((item) => item.sourceId === "minimal")?.event.payloadJson,
		).toMatchObject({ cycle: null, sourceId: null, lastError: null });
		expect(
			legacy.find((item) => item.sourceId === "message-minimal")?.event
				.payloadJson,
		).toEqual({ messageType: null, metadata: null });
		expect(missionPilotTraceItems(null)).toEqual([]);
	});

	it("merges snapshots across missing rows, overwrites ids, and sorts unified entries", () => {
		const incoming: MissionPilotExecutionTrace = {
			events: [storedEvent("event-1")],
			activityEvents: [activity("activity-1")],
			messages: [message("message-1")],
			entries: [entry("entry-2", 2)],
		};
		expect(mergeMissionPilotExecutionTrace(null, incoming)).toBe(incoming);

		const merged = mergeMissionPilotExecutionTrace(
			{
				events: undefined,
				activityEvents: [activity("activity-1", { text: "old" })],
				messages: undefined,
				entries: [entry("entry-3", 3), entry("entry-1", 1)],
			},
			{
				events: [storedEvent("event-1")],
				activityEvents: [
					activity("activity-1", { text: "new" }),
					activity("activity-2"),
				],
				messages: [message("message-1")],
				entries: [entry("entry-2", 2)],
			},
		);
		expect(merged.activityEvents).toHaveLength(2);
		expect(merged.activityEvents[0]?.text).toBe("new");
		expect(merged.entries?.map((item) => item.sequence)).toEqual([1, 2, 3]);

		const noEntries = mergeMissionPilotExecutionTrace(
			{ activityEvents: [], entries: undefined },
			{ activityEvents: [], entries: undefined },
		);
		expect(noEntries.entries).toBeUndefined();
	});

	it("derives all stopped-state reasons, timestamps, and attention states", () => {
		expect(missionPilotStopThoughtItem(undefined)).toBeNull();
		expect(
			missionPilotStopThoughtItem(summary({ desiredState: "running" })),
		).toBeNull();
		expect(
			missionPilotStopThoughtItem(summary({ phase: "created" })),
		).toBeNull();

		const paused = missionPilotStopThoughtItem(
			summary({ stoppedAt: "2026-08-09T02:00:00Z" }),
		);
		expect(paused?.sourceId).toContain("MISSION_PILOT_USER_STOPPED");
		expect(paused?.createdAt).toBe("2026-08-09T02:00:00Z");
		expect(paused?.event.message).toContain("ユーザーの停止操作");

		const archived = missionPilotStopThoughtItem(
			summary({ phase: "archived", lastError: "   " }),
		);
		expect(archived?.sourceId).toContain("MISSION_PILOT_COMPLETED");
		expect(archived?.event.message).toContain("アーカイブ処理が完了");

		const generic = missionPilotStopThoughtItem(
			summary({
				phase: "attention",
				activityState: "attention",
				lastErrorCode: "CUSTOM_STOP",
				lastError: " persisted reason ",
			}),
		);
		expect(generic?.event.eventType).toBe("runtime.attention");
		expect(generic?.event.message).toContain("自動再開されません");
		expect(generic?.event.message).toContain("persisted reason");
		expect(generic?.event.payloadJson).toMatchObject({
			lastErrorCode: "CUSTOM_STOP",
			stoppedAt: null,
		});

		const genericFallback = missionPilotStopThoughtItem(
			summary({ phase: "working", lastError: "" }),
		);
		expect(genericFallback?.sourceId).toContain("MISSION_PILOT_STOPPED");
		expect(genericFallback?.event.message).toContain("phase=working");
	});

	it("renders empty, populated, stopped, titled, and closeable dock states", () => {
		const onClose = vi.fn();
		let tree = PilotThoughtDock({ session: null, onClose });
		let markup = renderToStaticMarkup(tree);
		expect(markup).toContain("Mission Pilot");
		expect(markup).toContain("履歴はまだありません");
		expect(dockControls.controlTaskIds).toEqual([""]);
		const closeButton = collectHostElements(tree).find(
			(element) => element.props["aria-label"] === "Pilot thoughtを閉じる",
		);
		if (!closeButton) throw new Error("Expected close button");
		(closeButton.props.onClick as () => void)();
		expect(onClose).toHaveBeenCalledOnce();

		dockControls.effects = [];
		dockControls.summary = summary({ activityState: "attention" });
		dockControls.executionTraceState = {
			taskId: "session-1",
			trace: { activityEvents: [], entries: [entry("rendered", 1)] },
		};
		const session: MissionPilotTask = { id: "session-1", title: "Pilot task" };
		tree = PilotThoughtDock({ session, onClose });
		markup = renderToStaticMarkup(tree);
		expect(markup).toContain("Pilot task");
		expect(markup).toContain("現在のSQLite状態（履歴外）");
		expect(markup).toContain("thought:rendered");
		expect(markup).not.toContain("履歴はまだありません");

		dockControls.effects = [];
		dockControls.executionTraceState = {
			taskId: "another-session",
			trace: { activityEvents: [], entries: [entry("hidden", 1)] },
		};
		markup = renderToStaticMarkup(PilotThoughtDock({ session, onClose }));
		expect(markup).not.toContain("thought:hidden");
	});

	it("polls through success, non-ok, failure, disposal, and timer cleanup boundaries", async () => {
		const fakeWindow = {
			setTimeout: vi.fn(() => 44),
			clearTimeout: vi.fn(),
		};
		vi.stubGlobal("window", fakeWindow);
		const session: MissionPilotTask = { id: "session-1", title: "Pilot task" };

		PilotThoughtDock({ session: null, onClose: vi.fn() });
		const noSessionCleanup = dockControls.effects[0]?.();
		expect(noSessionCleanup).toBeUndefined();
		expect(dockControls.setExecutionTraceState).toHaveBeenCalledWith(null);

		dockControls.effects = [];
		dockControls.setExecutionTraceState.mockClear();
		dockControls.fetchTrace.mockResolvedValueOnce({ ok: false });
		PilotThoughtDock({ session, onClose: vi.fn() });
		const nonOkCleanup = dockControls.effects[0]?.();
		await settle();
		expect(dockControls.fetchTrace).toHaveBeenCalledWith("session-1");
		expect(fakeWindow.setTimeout).toHaveBeenCalled();
		const retainUpdater = dockControls.setExecutionTraceState.mock
			.calls[0]?.[0] as (current: unknown) => unknown;
		const sameState = { taskId: "session-1", trace: { activityEvents: [] } };
		expect(retainUpdater(sameState)).toBe(sameState);
		expect(
			retainUpdater({ taskId: "other", trace: { activityEvents: [] } }),
		).toBeNull();
		if (typeof nonOkCleanup !== "function")
			throw new Error("Expected polling cleanup");
		nonOkCleanup();
		expect(fakeWindow.clearTimeout).toHaveBeenCalledWith(44);

		dockControls.effects = [];
		dockControls.setExecutionTraceState.mockClear();
		dockControls.fetchTrace.mockResolvedValueOnce({
			ok: true,
			json: vi.fn(async () => ({
				activityEvents: [activity("fetched")],
			})),
		});
		PilotThoughtDock({ session, onClose: vi.fn() });
		const successCleanup = dockControls.effects[0]?.();
		await settle();
		expect(dockControls.setExecutionTraceState).toHaveBeenCalledTimes(2);
		const mergeUpdater = dockControls.setExecutionTraceState.mock
			.calls[1]?.[0] as (current: unknown) => {
			taskId: string;
			trace: MissionPilotExecutionTrace;
		};
		expect(mergeUpdater(null).trace.activityEvents).toHaveLength(1);
		expect(
			mergeUpdater({
				taskId: "session-1",
				trace: { activityEvents: [activity("existing")] },
			}).trace.activityEvents,
		).toHaveLength(2);
		if (typeof successCleanup === "function") successCleanup();

		dockControls.effects = [];
		dockControls.setExecutionTraceState.mockClear();
		dockControls.fetchTrace.mockRejectedValueOnce(new Error("offline"));
		PilotThoughtDock({ session, onClose: vi.fn() });
		const failureCleanup = dockControls.effects[0]?.();
		await settle();
		expect(fakeWindow.setTimeout).toHaveBeenCalled();
		if (typeof failureCleanup === "function") failureCleanup();

		let resolveFetch: ((value: unknown) => void) | undefined;
		dockControls.effects = [];
		dockControls.setExecutionTraceState.mockClear();
		dockControls.fetchTrace.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFetch = resolve;
			}),
		);
		PilotThoughtDock({ session, onClose: vi.fn() });
		const disposedCleanup = dockControls.effects[0]?.();
		if (typeof disposedCleanup !== "function")
			throw new Error("Expected disposed cleanup");
		disposedCleanup();
		resolveFetch?.({
			ok: true,
			json: vi.fn(async () => ({ activityEvents: [activity("late")] })),
		});
		await settle();
		expect(dockControls.setExecutionTraceState).toHaveBeenCalledTimes(1);
	});
});
