import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	buildPersistedStreamingResponsePreview,
	buildStreamingResponsePreview,
	FinalReportCard,
	formatVisibleAssistantText,
	PersistedStreamingResponse,
	RuntimePromptSnapshotCard,
	StreamingResponsePreview,
	ThinkingIndicator,
	tryParseJsonObject,
} from "../src/modules/nightworkers/components/ThreadTimelineStreaming";
import type {
	TaskEvent,
	TaskMessage,
	TaskRun,
} from "../src/modules/nightworkers/types";

// Mock i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

// Mock child elements
vi.mock("./ThreadMessage", () => ({
	ThreadMessage: ({ children }: { children?: ReactNode }) => (
		<div className="thread-message">{children}</div>
	),
}));

vi.mock("./ThreadTimelineMarkdown", () => ({
	ChatMarkdown: ({ content }: { content: string }) => (
		<div className="chat-markdown">{content}</div>
	),
	NightWorkersCodeBlock: ({ code }: { code: string }) => (
		<pre className="code-block">{code}</pre>
	),
}));

describe("ThreadTimelineStreaming module", () => {
	it("tryParseJsonObject parses valid json object or returns null", () => {
		expect(tryParseJsonObject('{"a": 1}')).toEqual({ a: 1 });
		expect(tryParseJsonObject("invalid")).toBeNull();
		expect(tryParseJsonObject("[]")).toBeNull();
	});

	it("formatVisibleAssistantText extracts message field appropriately", () => {
		// parsed direct message
		expect(formatVisibleAssistantText('{"message": "Hello"}')).toBe("Hello");
		// tool call message
		expect(
			formatVisibleAssistantText(
				'{"toolCall": {"arguments": {"message": "Hello from tool"}}}',
			),
		).toBe("Hello from tool");
		// normal raw text fallback
		expect(formatVisibleAssistantText("raw text")).toBe("raw text");
	});

	it("extracts latest partial json string values from unfinished json responses", () => {
		// Mock activeStreamingResponse with partial JSON
		const partialJson = '{"message": "Hello\\nWorld';
		const preview = buildStreamingResponsePreview({
			events: [],
			activeStreamingResponse: partialJson,
		});
		expect(preview?.visibleText).toBe("Hello\nWorld");
		expect(preview?.statusText).toBe("最終回答を生成しています。");
	});

	it("builds streaming preview from delta events", () => {
		const events: TaskEvent[] = [
			{
				id: "ev-1",
				message: "",
				payloadJson: {
					runEvent: {
						version: 1,
						id: "ev-1",
						runId: "run-1",
						timestamp: "2026-07-08T00:00:00Z",
						type: "model.response_delta",
						severity: "info",
						actor: "supervisor",
						message: "",
						data: { text: "Hello " },
					},
				},
			},
			{
				id: "ev-2",
				message: "",
				payloadJson: {
					runEvent: {
						version: 1,
						id: "ev-2",
						runId: "run-1",
						timestamp: "2026-07-08T00:00:01Z",
						type: "model.response_delta",
						severity: "info",
						actor: "supervisor",
						message: "",
						data: { text: "World" },
					},
				},
			},
		];
		const preview = buildStreamingResponsePreview({ events });
		expect(preview?.visibleText).toBe("Hello World");
	});

	it("builds persisted streaming response preview if not already persisted", () => {
		const events: TaskEvent[] = [
			{
				id: "ev-1",
				message: "",
				payloadJson: {
					runEvent: {
						version: 1,
						id: "ev-1",
						runId: "run-2",
						timestamp: "2026-07-08T00:00:00Z",
						type: "model.response_delta",
						severity: "info",
						actor: "supervisor",
						message: "",
						data: { text: "Hello" },
					},
				},
			},
		];
		const taskMessages: TaskMessage[] = [
			{
				id: "msg-1",
				taskId: "task-1",
				role: "assistant",
				runId: "run-1",
				content: "Already persisted text",
				createdAt: "2026-07-08T00:00:00Z",
			},
		];

		const preview = buildPersistedStreamingResponsePreview({
			events,
			taskMessages,
			runId: "run-2",
		});
		expect(preview).not.toBeNull();
		expect(preview?.visibleText).toBe("Hello");

		// Already persisted scenario
		const alreadyPersisted = buildPersistedStreamingResponsePreview({
			events,
			taskMessages: [
				{
					id: "msg-2",
					taskId: "task-1",
					role: "assistant",
					runId: "run-1",
					content: "Hello",
					createdAt: "2026-07-08T00:00:00Z",
				},
			],
			runId: "run-1",
		});
		expect(alreadyPersisted).toBeNull();
	});

	it("renders components without errors", () => {
		const baseRun: TaskRun = {
			id: "run-1",
			taskId: "task-1",
			status: "completed",
			workerKind: "supervisor",
			timeoutSeconds: 60,
			startedAt: "2026-07-08T00:00:00Z",
			createdAt: "2026-07-08T00:00:00Z",
			updatedAt: "2026-07-08T00:00:00Z",
		};
		// 1. RuntimePromptSnapshotCard
		const run: TaskRun = {
			...baseRun,
			contextSnapshot: {
				conversationContext: {
					stateCardText: "Captured prompt state",
				},
			},
		};
		const cardMarkup = renderToStaticMarkup(
			<RuntimePromptSnapshotCard latestRun={run} />,
		);
		expect(cardMarkup).toContain("Captured prompt state");

		// 2. FinalReportCard
		const runReport: TaskRun = {
			...baseRun,
			finalReport: "Finished work report",
			finishedAt: "2026-07-08T00:00:00Z",
		};
		const reportMarkup = renderToStaticMarkup(
			<FinalReportCard latestRun={runReport} />,
		);
		expect(reportMarkup).toContain("Finished work report");

		// 3. StreamingResponsePreview
		const preview = { visibleText: "Thinking", statusText: "Busy" };
		const previewMarkup = renderToStaticMarkup(
			<StreamingResponsePreview preview={preview} />,
		);
		expect(previewMarkup).toContain("Thinking");

		// 4. PersistedStreamingResponse
		const persistMarkup = renderToStaticMarkup(
			<PersistedStreamingResponse preview={preview} />,
		);
		expect(persistMarkup).toContain("Thinking");

		// 5. ThinkingIndicator
		const thinkingMarkup = renderToStaticMarkup(<ThinkingIndicator />);
		expect(thinkingMarkup).toContain("AIが返答を生成中です");
	});
});
