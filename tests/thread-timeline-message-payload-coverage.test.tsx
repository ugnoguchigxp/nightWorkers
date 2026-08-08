import type { ReactElement, ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
	TaskMessage,
	WorkbenchArtifactRef,
} from "../src/modules/nightworkers/types";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			options && "count" in options ? `${key}:${options.count}` : key,
	}),
}));

let MessagePayload: typeof import("../src/modules/nightworkers/components/ThreadTimelineMessagePayload").MessagePayload;

beforeAll(async () => {
	({ MessagePayload } = await import(
		"../src/modules/nightworkers/components/ThreadTimelineMessagePayload"
	));
});

function message(overrides: Partial<TaskMessage> = {}): TaskMessage {
	return {
		id: "message-1",
		taskId: "task-1",
		runId: "run-1",
		role: "assistant",
		content: "fallback content",
		messageType: "text",
		metadataJson: {},
		createdAt: "2026-08-08T00:00:00Z",
		...overrides,
	};
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (
		node == null ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<Record<string, unknown>>;
	return [element, ...elements(element.props.children as ReactNode)];
}

function renderMessage(
	overrides: Partial<TaskMessage>,
	onOpenArtifact = vi.fn<(artifact: WorkbenchArtifactRef) => void>(),
) {
	return {
		node: MessagePayload({ message: message(overrides), onOpenArtifact }),
		onOpenArtifact,
	};
}

function clickFirstButton(node: ReactNode) {
	const button = elements(node).find((element) => element.type === "button");
	if (!button || typeof button.props.onClick !== "function") {
		throw new Error("Expected a clickable button");
	}
	(button.props.onClick as () => void)();
}

describe("timeline message payload coverage", () => {
	it("hides workspace-only messages and renders artifact references", () => {
		expect(
			renderMessage({ metadataJson: { intent: "feature_plan" } }).node,
		).toBeNull();
		const withKind = renderMessage({
			role: "user",
			content: "please use it",
			metadataJson: {
				artifactContext: { title: "Plan", kind: "feature_plan" },
			},
		}).node;
		const withoutKind = renderMessage({
			role: "user",
			metadataJson: { artifactContext: { artifactId: "artifact-1" } },
		}).node;
		expect(
			elements(withKind).some(
				(element) => element.props.children === "feature_plan",
			),
		).toBe(true);
		expect(elements(withoutKind)).not.toHaveLength(0);
	});

	it("renders tool diffs with explicit and fallback code block fields", () => {
		const explicit = renderMessage({
			role: "user",
			metadataJson: {
				intent: "tool_diff",
				toolName: "apply_patch",
				codeBlock: { code: "+new", filename: "a.diff", language: "diff" },
			},
		}).node;
		const fallback = renderMessage({
			role: "user",
			content: "raw diff",
			metadataJson: {
				intent: "tool_diff",
				codeBlock: { code: 1, filename: 2, language: null },
			},
		}).node;
		expect(
			elements(explicit).some((element) => element.props.filename === "a.diff"),
		).toBe(true);
		expect(
			elements(fallback).some(
				(element) => element.props.filename === "tool-output.diff",
			),
		).toBe(true);
	});

	it("builds blueprint artifacts from rich and fallback metadata", () => {
		const opened = vi.fn<(artifact: WorkbenchArtifactRef) => void>();
		const rich = renderMessage(
			{
				messageType: "markdown_document",
				metadataJson: {
					appBlueprint: {
						name: "Console",
						description: "Description",
						screens: [
							{ sections: [{ name: "Hero" }, { id: "table" }, {}, null] },
							{ sections: null },
							null,
						],
					},
					display: { summary: "Summary" },
					validation: { issues: [{}, {}] },
					artifactRef: { artifactId: "artifact-1" },
				},
			},
			opened,
		);
		clickFirstButton(rich.node);
		expect(opened).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "app_blueprint",
				source: { type: "artifact_row", artifactId: "artifact-1" },
			}),
		);

		const fallbackOpened = vi.fn<(artifact: WorkbenchArtifactRef) => void>();
		const fallback = renderMessage(
			{
				messageType: "markdown_document",
				runId: null,
				content: "Fallback card content",
				metadataJson: {
					mockBlueprint: {},
					display: {},
					validation: { issues: null },
					artifactRef: {},
				},
			},
			fallbackOpened,
		);
		clickFirstButton(fallback.node);
		expect(fallbackOpened).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: undefined,
				source: { type: "task_message", messageId: "message-1" },
			}),
		);
	});

	it("builds component design artifacts and fallback labels", () => {
		const opened = vi.fn<(artifact: WorkbenchArtifactRef) => void>();
		const rich = renderMessage(
			{
				messageType: "markdown_document",
				metadataJson: {
					componentDesign: {
						componentName: "Button",
						summary: "Button summary",
						variants: [{}, {}],
						tokenChanges: [{}],
					},
					title: "Meta title",
				},
			},
			opened,
		);
		clickFirstButton(rich.node);
		expect(opened).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "component_design",
				title: "Component: Button",
			}),
		);

		const fallback = renderMessage({
			messageType: "markdown_document",
			content: "Design body",
			metadataJson: { componentDesign: { variants: null, tokenChanges: null } },
		}).node;
		expect(elements(fallback)).not.toHaveLength(0);
	});

	it("renders chart, browser, flow, and Playwright payloads", () => {
		for (const [messageType, metadataJson] of [
			["chart", { chartData: { series: [1] } }],
			["browser", { browserFrameData: { url: "https://example.test" } }],
			["flow", { flowData: { nodes: [] } }],
			["playwright", { playwrightResult: { passed: true } }],
		] as const) {
			expect(
				elements(renderMessage({ messageType, metadataJson }).node),
			).not.toHaveLength(0);
		}
	});

	it("builds API contract workspace links with and without summaries", () => {
		const opened = vi.fn<(artifact: WorkbenchArtifactRef) => void>();
		const rich = renderMessage(
			{
				messageType: "api_contract",
				metadataJson: {
					artifactKind: "plan_mode_api_contract",
					apiContract: {
						title: "Orders",
						summary: "Endpoints",
						openapi: {
							paths: {
								"/orders": { GET: {}, post: {}, trace: {} },
								"/empty": null,
							},
						},
					},
				},
			},
			opened,
		);
		clickFirstButton(rich.node);
		expect(opened).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "plan_mode_workspace",
				metadata: expect.objectContaining({ initialTab: "api-io-contract" }),
			}),
		);

		const fallback = renderMessage({
			messageType: "api_contract",
			runId: null,
			metadataJson: {
				artifactKind: "plan_mode_api_contract",
				artifactPayload: {},
			},
		}).node;
		expect(elements(fallback).some((element) => element.type === "p")).toBe(
			false,
		);
	});

	it("builds Zod workspace links and falls back to metadata", () => {
		const opened = vi.fn<(artifact: WorkbenchArtifactRef) => void>();
		const rich = renderMessage(
			{
				messageType: "zod_schema",
				metadataJson: {
					artifactKind: "plan_mode_zod_schema",
					zodSchema: {
						title: "Order",
						schemaName: "OrderSchema",
						summary: "Fields",
						fields: [{}, {}],
					},
				},
			},
			opened,
		);
		clickFirstButton(rich.node);
		expect(opened).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ initialTab: "zod-schema-design" }),
			}),
		);
		const fallback = renderMessage({
			messageType: "zod_schema",
			metadataJson: {
				artifactKind: "plan_mode_zod_schema",
				title: "Meta",
				fields: null,
			},
		}).node;
		expect(elements(fallback).some((element) => element.type === "p")).toBe(
			false,
		);
	});

	it("renders markdown documents, assistant markdown, and plain user text", () => {
		expect(
			elements(
				renderMessage({
					messageType: "markdown_document",
					metadataJson: { markdownDocumentData: { content: "# Doc" } },
				}).node,
			),
		).not.toHaveLength(0);
		expect(
			elements(
				renderMessage({ role: "assistant", content: "**Assistant**" }).node,
			),
		).not.toHaveLength(0);
		const user = renderMessage({ role: "user", content: "plain" })
			.node as ReactElement;
		expect(user.props.children).toBe("plain");
	});
});
