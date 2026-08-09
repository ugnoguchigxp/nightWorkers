import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/modules/nightworkers/components/ThreadTimeline", () => ({
	asRecord: (value: unknown) =>
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {},
	asString: (value: unknown) => (typeof value === "string" ? value : ""),
	getToolArguments: (payload: unknown) =>
		(payload as Record<string, unknown>)?.arguments,
	getToolName: (payload: unknown) =>
		(payload as Record<string, unknown>)?.toolName,
	getToolResult: (payload: unknown) =>
		(payload as Record<string, unknown>)?.result,
}));

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineMarkdown",
	() => ({
		ChatMarkdown: ({ content }: { content: string }) => (
			<mock-markdown>{content}</mock-markdown>
		),
		NightWorkersCodeBlock: ({
			code,
			filename,
		}: {
			code: string;
			filename: string;
		}) => <mock-code data-filename={filename}>{code}</mock-code>,
	}),
);

import {
	ContextStillToolCard,
	getContextStillToolCardModel,
	hasContextStillToolCard,
	NormalContextStillToolCard,
} from "../src/modules/nightworkers/components/ThreadTimelineContextStillCards";

function toolEvent(
	toolName: string,
	lifecycle: "started" | "result" | "progress" | "other",
	argumentsValue: unknown = {},
	result: unknown = {},
	overrides: Record<string, unknown> = {},
) {
	const kind =
		lifecycle === "result"
			? "tool.result"
			: lifecycle === "started" || lifecycle === "progress"
				? "tool.call"
				: "custom";
	const type =
		lifecycle === "result"
			? "tool.call_finished"
			: lifecycle === "started"
				? "tool.call_started"
				: lifecycle === "progress"
					? "tool.call_progress"
					: "custom";
	return {
		kind,
		payloadJson: {
			toolName,
			arguments: argumentsValue,
			result,
			runEvent: { type },
		},
		...overrides,
	};
}

describe("ThreadTimelineContextStillCards extra coverage", () => {
	it("rejects unrelated tools, unsupported lifecycles, and empty circular bodies", () => {
		expect(hasContextStillToolCard(toolEvent("read_file", "started"))).toBe(
			false,
		);
		expect(
			getContextStillToolCardModel(
				toolEvent("context-still.unknown", "started"),
			),
		).toBeNull();
		expect(
			getContextStillToolCardModel(
				toolEvent("context-still.context_compile", "progress"),
			),
		).toBeNull();
		expect(
			getContextStillToolCardModel(
				toolEvent("context-still.compile_eval", "result"),
			),
		).toBeNull();
		expect(
			getContextStillToolCardModel(
				toolEvent("context-still.register_candidates", "other"),
			),
		).toBeNull();

		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(
			getContextStillToolCardModel(
				toolEvent("context-still.context_compile", "started", circular),
			),
		).toBeNull();
		expect(
			getContextStillToolCardModel(
				toolEvent("context-still.initial_instructions", "result", {}, circular),
			),
		).toBeNull();
	});

	it("recognizes every lifecycle envelope", () => {
		const startedByKind = toolEvent(
			"context-still.context_compile",
			"started",
			{
				goal: "goal",
			},
		);
		expect(getContextStillToolCardModel(startedByKind)?.kind).toBe(
			"context_compile_input",
		);
		const startedByRunEvent = {
			...startedByKind,
			kind: "custom",
		};
		expect(getContextStillToolCardModel(startedByRunEvent)?.kind).toBe(
			"context_compile_input",
		);
		const resultByEventType = {
			...toolEvent(
				"context-still.context_compile",
				"other",
				{},
				{
					content: [{ text: "result" }],
				},
			),
			eventType: "tool_result",
		};
		expect(getContextStillToolCardModel(resultByEventType)?.kind).toBe(
			"context_compile_output",
		);
		const resultByRunEvent = {
			...resultByEventType,
			eventType: null,
			payloadJson: {
				...resultByEventType.payloadJson,
				runEvent: { type: "tool.call_finished" },
			},
		};
		expect(getContextStillToolCardModel(resultByRunEvent)?.kind).toBe(
			"context_compile_output",
		);
	});

	it("extracts result text from every supported result wrapper", () => {
		const wrappers = [
			{ content: [{ text: " direct " }, { text: "second" }, { image: "x" }] },
			{ payload: { content: [{ text: "payload" }] } },
			{ payload: { result: { content: [{ text: "payload result" }] } } },
			{ payload: { payload: { content: [{ text: "payload payload" }] } } },
			{ result: { content: [{ text: "result nested" }] } },
			{ structuredContent: { content: [{ text: "structured camel" }] } },
			{ structured_content: { content: [{ text: "structured snake" }] } },
			{
				payload: {
					structuredContent: { content: [{ text: "payload camel" }] },
				},
			},
			{
				payload: {
					structured_content: { content: [{ text: "payload snake" }] },
				},
			},
		];
		for (const wrapper of wrappers) {
			const card = getContextStillToolCardModel(
				toolEvent("context-still.initial_instructions", "result", {}, wrapper),
			);
			expect(card?.kind).toBe("initial_instructions_result");
			expect(card?.body.length).toBeGreaterThan(0);
		}
		expect(
			getContextStillToolCardModel(
				toolEvent("context-still.initial_instructions", "started"),
			),
		).toBeNull();
		expect(
			getContextStillToolCardModel(
				toolEvent("context-still.context_compile", "result", {}, { value: 1 }),
			)?.body,
		).toContain('"value": 1');
	});

	it("builds compile inputs with goal, title, outcome, and missing summaries", () => {
		const compile = getContextStillToolCardModel(
			toolEvent("context-still.context_compile", "started", {
				goal: "Compile goal",
				secret: "[REDACTED]",
			}),
		);
		expect(compile).toMatchObject({
			kind: "context_compile_input",
			summary: "Compile goal",
			format: "json",
		});
		expect(compile?.body).toContain("[REDACTED]");

		const title = getContextStillToolCardModel(
			toolEvent("context-still.compile_eval", "started", {
				title: "Eval title",
				outcome: "ignored outcome",
			}),
		);
		expect(title?.summary).toBe("Eval title");
		const outcome = getContextStillToolCardModel(
			toolEvent("context-still.compile_eval", "started", {
				title: 1,
				outcome: "Useful",
			}),
		);
		expect(outcome?.summary).toBe("Useful");
		const missing = getContextStillToolCardModel(
			toolEvent("context-still.compile_eval", "started", {}),
		);
		expect(missing?.summary).toBe("");
	});

	it("formats register candidate inputs, defaults, escaping, singular, and empty states", () => {
		const single = getContextStillToolCardModel(
			toolEvent("context-still.register_candidates", "started", {
				items: [
					{
						title: "Rule *one* [safe]",
						type: "rule",
						status: "pending",
					},
				],
			}),
		);
		expect(single?.summary).toBe("1 candidate");
		expect(single?.body).toContain("Rule \\*one\\* \\[safe\\]");
		expect(single?.body).toContain("pending / rule");

		const defaults = getContextStillToolCardModel(
			toolEvent("context-still.register_candidates", "started", {
				items: [{ title: "", type: null }, "invalid"],
			}),
		);
		expect(defaults?.summary).toBe("2 candidates");
		expect(defaults?.body).toContain("candidate 1");
		expect(defaults?.body).toContain("unknown");
		expect(defaults?.body).toContain("candidate 2");

		const empty = getContextStillToolCardModel(
			toolEvent("context-still.register_candidates", "started", {
				items: "invalid",
			}),
		);
		expect(empty?.summary).toBe("0 candidates");
		expect(empty?.body).toContain("登録候補はありません。");
	});

	it("parses structured and text register results with count fallbacks", () => {
		const structured = getContextStillToolCardModel(
			toolEvent(
				"context-still.register_candidates",
				"result",
				{ items: [{ title: "input", type: "rule" }] },
				{
					structured_content: {
						registeredCount: 3,
						failedCount: 1,
						items: [{ title: "structured", type: "procedure", status: "done" }],
					},
				},
			),
		);
		expect(structured?.summary).toBe("登録: 3 / 失敗: 1 / 候補: 1");
		expect(structured?.body).toContain("structured");

		const textResult = getContextStillToolCardModel(
			toolEvent(
				"context-still.register_candidates",
				"result",
				{},
				{
					content: [
						{ text: "" },
						{ text: "not json" },
						{
							text: JSON.stringify({
								registeredCount: Number.NaN,
								failedCount: Number.POSITIVE_INFINITY,
								items: [
									{
										title: "registered",
										type: "rule",
										status: "candidate_registered",
									},
									{ title: "failed", type: "rule", status: "failed" },
								],
							}),
						},
					],
				},
			),
		);
		expect(textResult?.summary).toBe("登録: 1 / 失敗: 0 / 候補: 2");

		const fallbackInput = getContextStillToolCardModel(
			toolEvent(
				"context-still.register_candidates",
				"result",
				{ items: [{ title: "input fallback", type: "rule" }] },
				{ content: [{ text: "tool error" }] },
			),
		);
		expect(fallbackInput?.summary).toBe("登録: 0 / 失敗: 0 / 候補: 1");
		expect(fallbackInput?.body).toContain("input fallback");
	});

	it("renders compact and normal cards across optional and format branches", () => {
		const markdownEvent = toolEvent(
			"context-still.initial_instructions",
			"result",
			{},
			{ content: [{ text: "# Instructions" }] },
			{ source: "worker", seq: 0 },
		);
		let markup = renderToStaticMarkup(
			<ContextStillToolCard event={markdownEvent} />,
		);
		expect(markup).toContain("ContextStill");
		expect(markup).toContain("worker");
		expect(markup).toContain("#0");
		expect(markup).toContain("mock-markdown");

		const jsonEvent = toolEvent("context-still.context_compile", "started", {
			goal: "goal",
		});
		markup = renderToStaticMarkup(<ContextStillToolCard event={jsonEvent} />);
		expect(markup).toContain("mock-code");
		expect(markup).toContain("context_compile input.json");
		expect(markup).not.toContain(">worker<");

		markup = renderToStaticMarkup(
			<NormalContextStillToolCard event={markdownEvent} />,
		);
		expect(markup).toContain("context-still.initial_instructions");
		expect(markup).toContain("mock-markdown");
		markup = renderToStaticMarkup(
			<NormalContextStillToolCard event={jsonEvent} />,
		);
		expect(markup).toContain("mock-code");
		expect(markup).toContain("goal");

		expect(
			renderToStaticMarkup(
				<ContextStillToolCard event={toolEvent("read_file", "started")} />,
			),
		).toBe("");
		expect(
			renderToStaticMarkup(
				<NormalContextStillToolCard
					event={toolEvent("read_file", "started")}
				/>,
			),
		).toBe("");
	});
});
