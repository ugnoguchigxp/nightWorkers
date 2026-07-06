import { describe, expect, it } from "vitest";
import { getAgentEditSummary } from "../../src/modules/nightworkers/components/ThreadTimelineAgentCards";

describe("ThreadTimeline edit summaries", () => {
	it("builds a replace_content summary from a tool result event with arguments", () => {
		const summary = getAgentEditSummary({
			id: "event-replace-content-finished",
			message: "[Worker Tool Result] Tool replace_content execution SUCCESS.",
			payloadJson: {
				iteration: 2,
				ok: true,
				toolName: "replace_content",
				arguments: {
					filePath: "src/greeting.txt",
					needle: "hello",
					replacement: "hello world",
				},
				payload: {
					applied: true,
					occurrences: 2,
					filePath: "src/greeting.txt",
				},
			},
		} as never);

		expect(summary).toEqual({
			toolName: "replace_content",
			sections: [
				{
					path: "src/greeting.txt",
					added: 2,
					deleted: 2,
					detail: "2 occurrences",
				},
			],
			codeBlocks: [
				{
					code: [
						"--- src/greeting.txt",
						"+++ src/greeting.txt",
						"# occurrences: 2",
						"- hello",
						"+ hello world",
					].join("\n"),
					filename: "src/greeting.txt.replace.diff",
					language: "diff",
				},
			],
		});
	});

	it("builds an apply_patch summary from the persisted tool result run event shape", () => {
		const patchContent = [
			"*** Begin Patch",
			"*** Add File: src/new-file.txt",
			"+created",
			"*** End Patch",
		].join("\n");

		const summary = getAgentEditSummary({
			id: "event-apply-patch-run-event",
			message: "[Worker Tool Result] Tool apply_patch execution SUCCESS.",
			payloadJson: {
				runEvent: {
					type: "tool.call_finished",
					data: {
						toolName: "apply_patch",
						arguments: { patchContent },
						result: {
							ok: true,
							toolName: "apply_patch",
							payload: { applied: true, changedFiles: ["src/new-file.txt"] },
						},
					},
				},
			},
		} as never);

		expect(summary).toEqual({
			toolName: "apply_patch",
			sections: [{ path: "src/new-file.txt", added: 1, deleted: 0 }],
			codeBlocks: [
				{
					code: patchContent,
					filename: "apply_patch.patch",
					language: "diff",
				},
			],
		});
	});
});
