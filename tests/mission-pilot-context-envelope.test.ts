import { describe, expect, it } from "vitest";
import { sliceMissionPilotUtf8Page } from "../api/modules/missionPilot/agent/mission-pilot-content-page";
import {
	boundMissionPilotCompactionInput,
	estimateMissionPilotProviderRequestTokens,
	projectMissionPilotProviderMessages,
} from "../api/modules/missionPilot/agent/mission-pilot-context-envelope";
import { missionPilotToolDefinitions } from "../api/modules/missionPilot/agent/mission-pilot-tools";

describe("Mission Pilot context envelope", () => {
	it("projects a large tool result with digest and continuation metadata", () => {
		const projected = projectMissionPilotProviderMessages([
			{ role: "tool", toolCallId: "large", content: "x".repeat(100_000) },
		]);
		const content = JSON.parse(String(projected[0]?.content));
		expect(content).toMatchObject({
			truncated: true,
			originalChars: 100_000,
			originalBytes: 100_000,
		});
		expect(content.nextCursor).toBeLessThanOrEqual(24_000);
		expect(content.nextCursor).toBeGreaterThan(0);
		expect(content.digest).toMatch(/^sha256:/);
		expect(String(projected[0]?.content).length).toBeLessThan(26_000);
	});

	it("applies the projection limit in UTF-8 bytes for Japanese content", () => {
		const original = "界".repeat(20_000);
		const [message] = projectMissionPilotProviderMessages([
			{ role: "tool", toolCallId: "ja", content: original },
		]);
		const projected = JSON.parse(String(message?.content));
		expect(projected.originalBytes).toBe(60_000);
		expect(
			Buffer.byteLength(projected.contentPrefix, "utf8"),
		).toBeLessThanOrEqual(24_000);
		expect(projected.nextCursor).toBeLessThan(20_000);
	});

	it("bounds the compaction request and counts tools plus reserved output", () => {
		const messages = Array.from({ length: 20 }, (_, index) => ({
			role: "user" as const,
			content: `${index}:${"x".repeat(10_000)}`,
		}));
		const bounded = boundMissionPilotCompactionInput(messages, 30_000);
		expect(
			Buffer.byteLength(JSON.stringify(bounded), "utf8"),
		).toBeLessThanOrEqual(30_000);
		expect(bounded.at(-1)?.content).toContain("19:");
		expect(bounded[0]?.content).toContain("0:");
		expect(bounded[1]?.content).toContain("Context envelope notice:");
		expect(
			estimateMissionPilotProviderRequestTokens({
				systemContext: "system",
				messages: bounded,
				tools: [{ name: "tool", description: "description", inputSchema: {} }],
			}),
		).toBeGreaterThan(8_000);
	});

	it("clamps invalid cursors and always advances on a Unicode boundary", () => {
		const beyondEnd = sliceMissionPilotUtf8Page("abc", { cursor: 99 });
		expect(beyondEnd).toMatchObject({
			content: "",
			page: { cursor: 3, nextCursor: null, truncated: false },
		});

		const splitSurrogate = sliceMissionPilotUtf8Page("😀次", {
			cursor: 1,
			maxChars: 1,
			maxBytes: 1,
		});
		expect(splitSurrogate).toMatchObject({
			content: "😀",
			page: { cursor: 0, nextCursor: 2, bytes: 4, truncated: true },
		});
	});

	it("sanitizes non-finite paging limits", () => {
		const page = sliceMissionPilotUtf8Page("abcdef", {
			cursor: Number.NaN,
			maxChars: Number.POSITIVE_INFINITY,
			maxBytes: Number.NaN,
		});
		expect(page.content).toBe("abcdef");
		expect(page.page.nextCursor).toBeNull();
	});

	it("publishes paging arguments only on pageable read tools", () => {
		const tools = new Map(
			missionPilotToolDefinitions().map((tool) => [tool.name, tool]),
		);
		expect(tools.get("read_task_workspace")?.inputSchema).toMatchObject({
			properties: {},
		});
		expect(tools.get("read_current_specification")?.inputSchema).toMatchObject({
			properties: { cursor: { type: "integer" }, maxChars: { maximum: 24000 } },
		});
		expect(tools.get("read_plan_artifact")?.inputSchema).toMatchObject({
			required: ["artifactId"],
			properties: { cursor: { type: "integer" }, maxChars: { maximum: 24000 } },
		});
	});
});
