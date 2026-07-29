import { describe, expect, it } from "vitest";
import { sliceUtf8ContentPage } from "../api/modules/agentsShare";
import {
	missionPilotDigest,
	sliceMissionPilotUtf8Page,
} from "../api/modules/missionPilot/agent/mission-pilot-content-page";
import { boundMissionPilotCompactionInput } from "../api/modules/missionPilot/agent/mission-pilot-context-envelope";
import { boundMissionPilotProviderConversation } from "../api/modules/missionPilot/agent/mission-pilot-conversation-query.repository";
import { missionPilotToolDefinitions } from "../api/modules/missionPilot/agent/mission-pilot-tools";
import { projectTaskOperatorHead } from "../api/modules/taskOperator/projections/task-operator-head.projection";
import type { ProviderToolMessage } from "../api/services/structured-llm/public";
import {
	TASK_OPERATOR_HEAD_TOKEN_BUDGET,
	taskOperatorProjectionV1Schema,
} from "../shared/modules/taskOperator";

function historyFixture() {
	return {
		messages: Array.from({ length: 1_000 }, (_, index) => ({
			id: `message-${index}`,
			content: `Task message ${index}:${"本文".repeat(2_000)}`,
		})),
		artifacts: Array.from({ length: 100 }, (_, index) => ({
			id: `artifact-${index}`,
			kind: `kind-${index % 32}`,
			revision: index + 1,
			digest: `sha256:artifact-${index}`,
			status: "ready",
			content: "設計".repeat(10_000),
		})),
		terminalRuns: Array.from({ length: 100 }, (_, index) => ({
			id: `run-${index}`,
			revision: index + 1,
			status: "completed",
			outcome: "検証結果".repeat(5_000),
		})),
		questionnaireRevisions: Array.from({ length: 20 }, (_, index) => ({
			revision: index + 1,
			answers: "回答".repeat(2_000),
		})),
		toolResults: Array.from({ length: 1_000 }, (_, index) => ({
			role: "tool" as const,
			toolCallId: `tool-${index}`,
			content: JSON.stringify({ index, output: "出力".repeat(2_000) }),
		})),
		unreadEvents: Array.from(
			{ length: 1_000 },
			(_, index) => `task.event.${index}`,
		),
	};
}

describe("Task Operator token regression", () => {
	it("keeps the head projection independent from full history body volume", () => {
		const fixture = historyFixture();
		const latestByKind = Array.from(
			new Map(
				fixture.artifacts.map((artifact) => [artifact.kind, artifact]),
			).values(),
		).map(({ content: _content, ...artifact }) => artifact);
		const latestRun = fixture.terminalRuns.at(-1);
		if (!latestRun) throw new Error("terminal run fixture is missing");
		const projection = projectTaskOperatorHead({
			task: {
				id: "task-token-regression",
				revision: 1_000,
				status: "needs_review",
				title: "大量履歴でもboundedなTask Operator head",
				objective: "目的".repeat(10_000),
				acceptanceCriteria: "完了条件".repeat(10_000),
				repository: { id: "repository-1", revision: 9, state: "registered" },
			},
			questionnaire: {
				id: "questionnaire-1",
				revision: fixture.questionnaireRevisions.length,
				status: "accepted",
				decisionDigest: "sha256:questionnaire-current",
				blockingQuestionCount: 0,
			},
			artifactIndex: {
				revision: 100,
				totalCount: fixture.artifacts.length,
				nextCursor: 32,
				latestByKind,
			},
			queue: null,
			run: {
				active: null,
				terminal: {
					id: latestRun.id,
					revision: latestRun.revision,
					status: latestRun.status,
					outcomeDigest: "sha256:latest-terminal-outcome",
				},
			},
		});

		const parsed = taskOperatorProjectionV1Schema.parse(projection);
		const tokenEstimate = Math.ceil(
			Buffer.byteLength(JSON.stringify(parsed), "utf8") / 4,
		);
		expect(tokenEstimate).toBeLessThanOrEqual(TASK_OPERATOR_HEAD_TOKEN_BUDGET);
		expect(JSON.stringify(parsed)).not.toContain(fixture.messages[0]?.content);
		expect(JSON.stringify(parsed)).not.toContain(latestRun.outcome);
		expect(parsed.artifactIndex.totalCount).toBe(100);
		expect(parsed.artifactIndex.latestByKind).toHaveLength(32);
	});

	it("bounds 1,000 tool results and compaction input while retaining digests", () => {
		const fixture = historyFixture();
		const providerMessages: ProviderToolMessage[] = [
			{ role: "system", content: "Mission Pilot system context" },
			{ role: "user", content: fixture.messages[0]?.content ?? "" },
			...fixture.toolResults,
		];
		const conversation =
			boundMissionPilotProviderConversation(providerMessages);
		const compaction = boundMissionPilotCompactionInput(providerMessages);
		expect(
			Buffer.byteLength(JSON.stringify(conversation), "utf8"),
		).toBeLessThanOrEqual(48_000);
		expect(
			Buffer.byteLength(JSON.stringify(compaction), "utf8"),
		).toBeLessThanOrEqual(64_000);
		expect(JSON.stringify(compaction)).toContain("canonicalDigest");
		expect(conversation.length).toBeLessThan(providerMessages.length);
	});

	it("keeps the generic tool surface constant and pages requested detail", () => {
		const fixture = historyFixture();
		const tools = missionPilotToolDefinitions();
		expect(tools).toHaveLength(7);
		expect(tools.map((tool) => tool.name)).toEqual([
			"read_task_operator_view",
			"read_task_resource",
			"list_available_task_actions",
			"read_task_action_contract",
			"execute_task_action",
			"agent.wait_for_event",
			"agent.finish",
		]);

		const detail = fixture.messages
			.map((message) => message.content)
			.join("\n");
		const firstPage = sliceMissionPilotUtf8Page(detail, {
			maxBytes: 12_000,
			maxChars: 12_000,
		});
		expect(Buffer.byteLength(firstPage.content, "utf8")).toBeLessThanOrEqual(
			12_000,
		);
		expect(firstPage.page.truncated).toBe(true);
		expect(firstPage.page.nextCursor).not.toBeNull();
		expect(missionPilotDigest(detail)).toMatch(/^sha256:/);
	});

	it("bounds multibyte Task Operator pages by UTF-8 bytes", () => {
		const detail = "重要設計😀".repeat(5_000);
		const firstPage = sliceUtf8ContentPage(detail, {
			maxBytes: 12_000,
			maxChars: 12_000,
		});
		expect(Buffer.byteLength(firstPage.content, "utf8")).toBeLessThanOrEqual(
			12_000,
		);
		expect(
			Math.ceil(
				Buffer.byteLength(JSON.stringify({ json: firstPage.content }), "utf8") /
					4,
			),
		).toBeLessThanOrEqual(4_000);
		expect(firstPage.page.nextCursor).not.toBeNull();
		const secondPage = sliceUtf8ContentPage(detail, {
			cursor: firstPage.page.nextCursor ?? 0,
			maxBytes: 12_000,
			maxChars: 12_000,
		});
		expect(firstPage.content + secondPage.content).toBe(
			detail.slice(0, secondPage.page.nextCursor ?? detail.length),
		);
	});
});
