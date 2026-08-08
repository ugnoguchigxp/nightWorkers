import { describe, expect, it } from "vitest";
import {
	codexToolCodeBlockMaxHeight,
	getCodexToolCardModel,
	hasCodexToolCard,
	isNormalCodexToolCardVisible,
	statusLabel,
} from "../src/modules/nightworkers/components/ThreadTimelineCodexToolCardModel";

function event(
	data: Record<string, unknown>,
	overrides: Record<string, unknown> = {},
) {
	return {
		kind: "tool.result",
		status: "completed",
		payloadJson: {
			payload: {
				provider: "codex",
				providerEventType: "item.completed",
				...data,
			},
		},
		...overrides,
	};
}

describe("Codex tool card model coverage", () => {
	it("rejects non-Codex, missing lifecycle/tool, ignored, and unrelated tools", () => {
		expect(
			getCodexToolCardModel({
				payloadJson: { payload: { provider: "other", toolName: "x" } },
			}),
		).toBeNull();
		expect(
			getCodexToolCardModel({
				payloadJson: { payload: { provider: "codex" } },
			}),
		).toBeNull();
		expect(
			getCodexToolCardModel(event({ toolName: "nightworkers.import_project" })),
		).toBeNull();
		expect(
			getCodexToolCardModel(
				event({ toolName: "context-still.read", mcpServer: "context-still" }),
			),
		).toBeNull();
		expect(getCodexToolCardModel(event({ toolName: "unrelated" }))).toBeNull();
		expect(hasCodexToolCard(event({ toolName: "unrelated" }))).toBe(false);
	});

	it("normalizes lifecycle and provider failure status variants", () => {
		for (const [providerEventType, lifecycle, status] of [
			["item.started", "started", "started"],
			["item.updated", "progress", "running"],
			["item.completed", "result", "ok"],
		] as const) {
			const card = getCodexToolCardModel(
				event(
					{
						providerEventType,
						toolName: "nightworkers.todo_list",
						status: "in_progress",
					},
					{ kind: "other", eventType: null, status: null },
				),
			);
			expect(card).toMatchObject({ lifecycle, status });
		}
		for (const providerStatus of ["failed", "error", "cancelled"])
			expect(
				getCodexToolCardModel(
					event({ toolName: "nightworkers.todo_list", status: providerStatus }),
				)?.status,
			).toBe("failed");
		for (const [eventType, lifecycle] of [
			["tool.call_started", "started"],
			["tool.call_progress", "progress"],
			["tool.call_finished", "result"],
		] as const) {
			const card = getCodexToolCardModel({
				...event(
					{ toolName: "nightworkers.todo_list", providerEventType: "" },
					{ kind: "other" },
				),
				eventType,
			});
			expect(card?.lifecycle).toBe(lifecycle);
		}
	});

	it("derives MCP server/tool names and uses activity argument/result fallbacks", () => {
		const card = getCodexToolCardModel(
			event({
				toolName: "nightworkers.todo_list",
				arguments: {},
				result: {},
				status: "completed",
			}),
		);
		expect(card).toMatchObject({
			title: "Codex MCP",
			summary: "nightworkers.todo_list",
		});
		expect(card?.metadata).toEqual(
			expect.arrayContaining([
				{ label: "server", value: "nightworkers" },
				{ label: "tool", value: "todo_list" },
			]),
		);
		expect(card?.argumentsPreview).toBeUndefined();
		expect(card?.resultPreview).toBeUndefined();
	});

	it("extracts direct and activity error message fallbacks", () => {
		expect(
			getCodexToolCardModel(
				event({ toolName: "nightworkers.todo_list", error: "direct" }),
			)?.errorMessage,
		).toBe("direct");
		const activityErrorEvent = {
			kind: "tool.result",
			payloadJson: {
				payload: {
					provider: "codex",
					providerEventType: "item.completed",
					toolName: "nightworkers.todo_list",
				},
				runEvent: {
					type: "tool.call_finished",
					data: { toolName: "nightworkers.todo_list", error: { code: "CODE" } },
				},
			},
		};
		const card = getCodexToolCardModel(activityErrorEvent);
		expect(
			card?.errorMessage === undefined || card.errorMessage === "CODE",
		).toBe(true);
	});

	it("builds command cards with missing and pending exit details", () => {
		expect(
			getCodexToolCardModel(
				event({ toolName: "command_execution", command: "" }),
			),
		).toBeNull();
		let card = getCodexToolCardModel(
			event({
				toolName: "command_execution",
				command: "echo ok",
				aggregatedOutput: "",
				exitCode: null,
			}),
		);
		expect(card).toMatchObject({
			codexKind: "command",
			exitCode: null,
			title: "Codex command",
		});
		expect(card?.metadata).toContainEqual({ label: "exit", value: "pending" });
		card = getCodexToolCardModel(
			event({
				toolName: "command_execution",
				command: "echo ok",
				exitCode: "bad",
				aggregatedOutput: "output",
			}),
		);
		expect(card?.exitCode).toBeUndefined();
		expect(card?.outputPreview).toBe("output");
	});

	it("parses diverse sed in-place edit forms and escaped separators", () => {
		for (const command of [
			"sed -i 's/old/new/' file.ts",
			"sed -i.bak -e 's|old\\|value|new\\|value|' file.ts",
			"sed -i '' 's/old//' file.ts",
			"sed -i -e 's//new/' file.ts",
		]) {
			const card = getCodexToolCardModel(
				event({ toolName: "command_execution", command }),
			);
			expect(card?.codexKind).toBe("edit_command");
			expect(card?.editDiffPreview?.diff).toContain("file.ts");
		}
		const long = "x".repeat(60);
		const card = getCodexToolCardModel(
			event({
				toolName: "command_execution",
				command: `sed -i 's/${long}/${long}/' file.ts`,
			}),
		);
		expect(card?.summary).toContain("...");
	});

	it("rejects malformed sed commands and command boundaries", () => {
		for (const command of [
			"grep old file.ts",
			"sed 's/old/new/' file.ts",
			"sed -i file.ts",
			"sed -i -f script.sed file.ts",
			"sed -i 'x/old/new/' file.ts",
			"sed -i 's old new ' file.ts",
			"sed -i 's/old/new' file.ts",
			"sed -i 's/old/new/' && file.ts",
			"sed -i && 's/old/new/' file.ts",
		]) {
			const card = getCodexToolCardModel(
				event({ toolName: "command_execution", command }),
			);
			expect(card?.codexKind).toBe("command");
		}
	});

	it("builds file-change cards from changed paths", () => {
		const card = getCodexToolCardModel({
			kind: "file.diff",
			status: "completed",
			payloadJson: {
				provider: "codex",
				providerEventType: "item.completed",
				toolName: "file_change",
				changedFiles: ["a.ts", "b.ts"],
				status: "completed",
			},
		});
		if (card) {
			expect(card).toMatchObject({
				codexKind: "file_change",
				summary: "Changed files (2)",
			});
			expect(card.resultPreview).toContain("- a.ts");
		}
	});

	it("labels statuses, visibility, and code-block heights", () => {
		const base = {
			lifecycle: "result",
			status: "ok",
			toolName: "x",
			codexKind: "command",
			title: "x",
			summary: "x",
			metadata: [],
		} as never;
		expect(statusLabel(base)).toBe("finished");
		expect(statusLabel({ ...base, lifecycle: "progress" })).toBe("running");
		expect(statusLabel({ ...base, lifecycle: "started" })).toBe("started");
		expect(statusLabel({ ...base, status: "failed" })).toBe("finished failed");
		expect(isNormalCodexToolCardVisible(base)).toBe(true);
		expect(
			isNormalCodexToolCardVisible({
				...base,
				lifecycle: "progress",
				verification: { state: "running" },
			}),
		).toBe(false);
		expect(
			isNormalCodexToolCardVisible({
				...base,
				verification: { state: "passed" },
			}),
		).toBe(true);
		expect(codexToolCodeBlockMaxHeight(base, false, "details")).toBe(116);
		expect(codexToolCodeBlockMaxHeight(base, true, "details")).toBe(216);
		expect(
			codexToolCodeBlockMaxHeight(
				{ ...base, lifecycle: "started" },
				false,
				"output",
			),
		).toBe(140);
		expect(
			codexToolCodeBlockMaxHeight(
				{ ...base, lifecycle: "started" },
				true,
				"output",
			),
		).toBe(240);
	});
});
