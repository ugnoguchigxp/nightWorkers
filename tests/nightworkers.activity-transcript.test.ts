import { describe, expect, it } from "vitest";
import {
	buildTranscriptItems,
	dedupeAndSortActivityEvents,
} from "../src/modules/nightworkers/activityTranscript";
import type { ActivityEvent } from "../src/modules/nightworkers/types";

function event(
	input: Partial<ActivityEvent> & Pick<ActivityEvent, "id" | "kind" | "seq">,
): ActivityEvent {
	return {
		taskId: "00000000-0000-4000-8000-000000000001",
		source: "system",
		visibility: "visible",
		createdAt: new Date(0).toISOString(),
		...input,
	};
}

describe("activity transcript reducer", () => {
	it("dedupes by id and sorts by task seq", () => {
		const first = event({ id: "a", kind: "system.info", seq: 2, text: "old" });
		const replacement = event({
			id: "a",
			kind: "system.info",
			seq: 2,
			text: "new",
		});
		const sorted = dedupeAndSortActivityEvents([
			first,
			event({ id: "b", kind: "user.message", seq: 1, text: "hello" }),
			replacement,
		]);

		expect(sorted.map((item) => item.id)).toEqual(["b", "a"]);
		expect(sorted[1]?.text).toBe("new");
	});

	it("keeps pause and resume inside one assistant turn", () => {
		const items = buildTranscriptItems({
			events: [
				event({
					id: "d1",
					kind: "assistant.delta",
					seq: 1,
					turnId: "turn-a",
					text: "first ",
				}),
				event({ id: "p1", kind: "assistant.pause", seq: 2, turnId: "turn-a" }),
				event({ id: "r1", kind: "assistant.resume", seq: 3, turnId: "turn-a" }),
				event({
					id: "d2",
					kind: "assistant.delta",
					seq: 4,
					turnId: "turn-a",
					text: "second",
				}),
			],
		});

		expect(items).toHaveLength(1);
		expect(items[0]?.kind).toBe("assistant_turn");
		if (items[0]?.kind !== "assistant_turn") return;
		expect(items[0].text).toBe("first second");
		expect(items[0].children.map((child) => child.kind)).toEqual([
			"status",
			"status",
		]);
	});

	it("keeps tool and diff events as assistant children", () => {
		const items = buildTranscriptItems({
			events: [
				event({
					id: "d1",
					kind: "assistant.delta",
					seq: 1,
					turnId: "turn-a",
					text: "working",
				}),
				event({
					id: "t1",
					kind: "tool.call",
					seq: 2,
					turnId: "turn-a",
					text: "apply_patch",
				}),
				event({
					id: "f1",
					kind: "file.patch",
					seq: 3,
					turnId: "turn-a",
					artifactId: "art-1",
				}),
				event({
					id: "j1",
					kind: "llm.decision_json",
					seq: 4,
					turnId: "turn-a",
				}),
			],
			artifacts: [
				{
					id: "art-1",
					taskId: "00000000-0000-4000-8000-000000000001",
					kind: "patch",
					contentText: "diff --git a/a b/a",
					createdAt: new Date(0).toISOString(),
				},
			],
		});

		expect(items).toHaveLength(1);
		expect(items[0]?.kind).toBe("assistant_turn");
		if (items[0]?.kind !== "assistant_turn") return;
		expect(items[0].children.map((child) => child.kind)).toEqual([
			"tool",
			"diff",
			"json",
		]);
		const diffChild = items[0].children[1];
		expect(diffChild?.kind).toBe("diff");
		if (diffChild?.kind === "diff")
			expect(diffChild.artifact?.id).toBe("art-1");
	});

	it("keeps schema-first raw output, parsed JSON, tools, and final answer in task sequence order", () => {
		const items = buildTranscriptItems({
			events: [
				event({
					id: "raw-1",
					kind: "assistant.raw_output",
					seq: 1,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: '{"toolCall":{"name":"list_dir","arguments":{}}}',
				}),
				event({
					id: "parsed-1",
					kind: "llm.schema_result",
					seq: 2,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: '{"toolCall":{"name":"list_dir","arguments":{}}}',
				}),
				event({
					id: "tool-1",
					kind: "tool.call",
					seq: 3,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: "list_dir started",
				}),
				event({
					id: "final-1",
					kind: "assistant.message",
					seq: 4,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: "完了しました。",
				}),
			],
		});

		expect(items).toHaveLength(4);
		expect(items.map((item) => item.kind)).toEqual([
			"activity",
			"activity",
			"activity",
			"assistant_turn",
		]);
		expect(items[0]?.kind === "activity" ? items[0].event.kind : "").toBe(
			"assistant.raw_output",
		);
		expect(items[1]?.kind === "activity" ? items[1].event.kind : "").toBe(
			"llm.schema_result",
		);
		expect(items[2]?.kind === "activity" ? items[2].event.kind : "").toBe(
			"tool.call",
		);
		expect(items[3]?.kind).toBe("assistant_turn");
		if (items[3]?.kind !== "assistant_turn") return;
		expect(items[3].text).toBe("完了しました。");
	});

	it("suppresses runtime finalize assistant messages when a saved assistant message exists", () => {
		const items = buildTranscriptItems({
			events: [
				event({
					id: "raw-final",
					kind: "assistant.raw_output",
					seq: 1,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: '{"toolCall":{"name":"finalize_answer","arguments":{"message":"完了しました。"}}}',
				}),
				event({
					id: "parsed-final",
					kind: "llm.schema_result",
					seq: 2,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: '{"toolCall":{"name":"finalize_answer","arguments":{"message":"完了しました。"}}}',
				}),
				event({
					id: "runtime-final",
					kind: "assistant.message",
					seq: 3,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: "完了しました。",
					payloadJson: { agentEventType: "finalize.received" },
				}),
				event({
					id: "saved-final",
					kind: "assistant.message",
					seq: 4,
					turnId: "task-message-final",
					runId: "run-1",
					text: "完了しました。",
					payloadJson: { source: "task_message" },
				}),
			],
		});

		expect(items.map((item) => item.kind)).toEqual([
			"activity",
			"activity",
			"assistant_turn",
		]);
		expect(items[2]?.kind).toBe("assistant_turn");
		if (items[2]?.kind !== "assistant_turn") return;
		expect(items[2].events.map((item) => item.id)).toEqual(["saved-final"]);
		expect(items[2].text).toBe("完了しました。");
	});

	it("does not move a patch turn after a later finalize turn", () => {
		const items = buildTranscriptItems({
			events: [
				event({
					id: "raw-1",
					kind: "assistant.raw_output",
					seq: 1,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: '{"toolCall":{"name":"apply_patch","arguments":{}}}',
				}),
				event({
					id: "patch-msg",
					kind: "assistant.message",
					seq: 2,
					turnId: "patch-turn",
					runId: "run-1",
					text: "*** Begin Patch",
				}),
				event({
					id: "patch-1",
					kind: "file.patch",
					seq: 3,
					turnId: "patch-turn",
					runId: "run-1",
					artifactId: "art-1",
				}),
				event({
					id: "final-raw",
					kind: "assistant.raw_output",
					seq: 4,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: '{"toolCall":{"name":"finalize_answer","arguments":{}}}',
				}),
				event({
					id: "final-1",
					kind: "assistant.message",
					seq: 5,
					turnId: "assistant:run-1",
					runId: "run-1",
					text: "完了しました。",
				}),
			],
			artifacts: [
				{
					id: "art-1",
					taskId: "00000000-0000-4000-8000-000000000001",
					kind: "patch",
					contentText: "*** Begin Patch",
					createdAt: new Date(0).toISOString(),
				},
			],
		});

		expect(items.map((item) => item.kind)).toEqual([
			"activity",
			"assistant_turn",
			"activity",
			"assistant_turn",
		]);
		expect(items[1]?.kind).toBe("assistant_turn");
		if (items[1]?.kind !== "assistant_turn") return;
		expect(items[1].children.map((child) => child.kind)).toEqual(["diff"]);
		expect(items[3]?.kind).toBe("assistant_turn");
		if (items[3]?.kind !== "assistant_turn") return;
		expect(items[3].text).toBe("完了しました。");
	});

	it("renders unknown activity instead of dropping it", () => {
		const items = buildTranscriptItems({
			events: [
				event({
					id: "u1",
					kind: "unknown.activity",
					seq: 1,
					ingestError: "unsupported",
				}),
			],
		});

		expect(items).toHaveLength(1);
		expect(items[0]?.kind).toBe("unknown");
	});
});
