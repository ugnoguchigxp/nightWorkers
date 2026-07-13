import { describe, expect, it } from "vitest";
import {
	findUnprojectedUserMessages,
	mergeUnprojectedMessagesChronologically,
	sliceTimelineWindow,
} from "../src/modules/nightworkers/components/ThreadTimeline";
import { isUserVisibleChatMessage } from "../src/modules/nightworkers/messageVisibility";

describe("ThreadTimeline bounded history window", () => {
	it.each([
		500, 2_000, 10_000,
	])("mounts a fixed latest window for %i canonical items", (total) => {
		const items = Array.from({ length: total }, (_, seq) => ({ seq }));
		const window = sliceTimelineWindow(items);
		expect(window.items).toHaveLength(100);
		expect(window.items[0]?.seq).toBe(total - 100);
		expect(window.items.at(-1)?.seq).toBe(total - 1);
		expect(window.total).toBe(total);
	});

	it("keeps a past-reading window stable while new items arrive", () => {
		const initial = Array.from({ length: 500 }, (_, seq) => seq);
		const past = sliceTimelineWindow(initial, { count: 200, end: 500 });
		const replayed = sliceTimelineWindow([...initial, 500, 501], {
			count: 200,
			end: past.end,
		});
		expect(replayed.items).toEqual(past.items);
	});

	it("clamps invalid window inputs without duplicate or missing sequence values", () => {
		const items = Array.from({ length: 20 }, (_, seq) => seq);
		expect(sliceTimelineWindow(items, { count: 50, end: 999 }).items).toEqual(
			items,
		);
		expect(sliceTimelineWindow(items, { count: 0, end: -1 }).items).toEqual([]);
	});

	it("keeps newly persisted user messages visible until activity projection catches up", () => {
		const messages = [
			{
				id: "message-1",
				taskId: "task-1",
				role: "user" as const,
				content: "already projected",
				createdAt: "2026-07-10T00:00:00.000Z",
			},
			{
				id: "message-2",
				taskId: "task-1",
				role: "user" as const,
				content: "fresh submit",
				createdAt: "2026-07-10T00:00:01.000Z",
			},
		];
		const transcriptItems = [
			{
				kind: "user_turn" as const,
				id: "user:turn-1",
				turnId: "turn-1",
				events: [],
				text: "already projected",
			},
		];

		expect(findUnprojectedUserMessages(messages, transcriptItems)).toEqual([
			messages[1],
		]);
	});

	it("shows the initial user prompt while preserving chat chronology", () => {
		const event = (id: string, createdAt: string) => ({
			id,
			taskId: "task-1",
			seq: Number(id.slice(-1)),
			kind: "assistant.message",
			source: "agent",
			visibility: "normal",
			createdAt,
		});
		const transcriptItems = [
			{
				kind: "assistant_turn" as const,
				id: "assistant:turn-1",
				turnId: "turn-1",
				events: [event("event-1", "2026-07-10T00:00:10.000Z")],
				text: "first response",
				children: [],
			},
			{
				kind: "assistant_turn" as const,
				id: "assistant:turn-2",
				turnId: "turn-2",
				events: [event("event-2", "2026-07-10T00:00:30.000Z")],
				text: "second response",
				children: [],
			},
		];
		const messages = [
			{
				id: "mission-pilot-prompt",
				taskId: "task-1",
				role: "user" as const,
				content: "pilot prompt",
				messageType: "mission_pilot_initial_prompt" as const,
				traceOwner: "user" as const,
				traceChannel: "chat" as const,
				createdAt: "2026-07-10T00:00:20.000Z",
			},
			{
				id: "original-user-prompt",
				taskId: "task-1",
				role: "user" as const,
				content: "original prompt",
				traceOwner: "user" as const,
				traceChannel: "chat" as const,
				createdAt: "2026-07-10T00:00:00.000Z",
			},
		];

		expect(
			mergeUnprojectedMessagesChronologically(
				transcriptItems,
				messages.filter(isUserVisibleChatMessage),
			).map((item) => item.id),
		).toEqual([
			"unprojected-original-user-prompt",
			"assistant:turn-1",
			"unprojected-mission-pilot-prompt",
			"assistant:turn-2",
		]);
	});
});
