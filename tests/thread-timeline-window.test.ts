import { describe, expect, it } from "vitest";
import {
	findUnprojectedUserMessages,
	sliceTimelineWindow,
} from "../src/modules/nightworkers/components/ThreadTimeline";

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
});
