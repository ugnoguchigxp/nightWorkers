import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callbackMocks = vi.hoisted(() => ({
	openArtifact: vi.fn(),
	openProjectFile: vi.fn(),
	openEvidence: vi.fn(),
	openReview: vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => `translated:${key}` }),
}));

vi.mock("../src/modules/nightworkers/utils/time", () => ({
	formatFinishedTime: (value?: unknown) =>
		value ? `finished:${String(value)}` : "no-time",
}));

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineStreaming",
	() => ({
		formatVisibleAssistantText: (value: string) =>
			value.startsWith("hidden:") ? "" : `visible:${value}`,
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineActivityModel",
	() => {
		const payload = (event: { payloadJson?: unknown }) =>
			(event.payloadJson && typeof event.payloadJson === "object"
				? event.payloadJson
				: {}) as Record<string, unknown>;
		return {
			activityCodeFilename: (event: { payloadJson?: unknown; kind: string }) =>
				String(payload(event).filename || `${event.kind}.txt`),
			activityCodeLanguage: (event: { payloadJson?: unknown }) =>
				String(payload(event).language || "text"),
			activityDisplaySummary: (event: { payloadJson?: unknown }) =>
				String(payload(event).summary || ""),
			activityDisplayTitle: (
				event: { payloadJson?: unknown },
				fallback: string,
			) => String(payload(event).displayTitle || fallback),
			childEventId: (child: {
				kind: string;
				event?: { id: string };
				events?: Array<{ id: string }>;
			}) =>
				child.kind === "tool"
					? (child.events || []).map((event) => event.id).join("-")
					: child.event?.id || "missing",
			fallbackEventText: (event?: { text?: string | null }) =>
				`fallback:${event?.text || "none"}`,
			formatLlmOutputJson: (event: { id: string }, value: unknown) =>
				`llm-json:${event.id}:${JSON.stringify(value)}`,
			getActivityCode: (event: { payloadJson?: unknown }) =>
				String(payload(event).code || ""),
			getActivityDiffCode: vi.fn(() => "diff-code"),
			getEditToolCall: vi.fn(() => null),
			getEditToolCallDiff: vi.fn(() => ""),
			isDiffActivity: (event: { kind: string }) =>
				event.kind === "file.diff" || event.kind === "file.patch",
			isHighVolumeActivity: (event: { payloadJson?: unknown }) =>
				payload(event).highVolume === true,
			isLlmOutputActivity: (event: { payloadJson?: unknown }) =>
				payload(event).llm === true,
			schemaFirstAgentEventType: vi.fn(() => ""),
		};
	},
);

vi.mock("../src/modules/nightworkers/components/LazyDetails", () => ({
	LazyDetails: ({
		children,
		className,
		defaultOpen,
		summary,
	}: {
		children: ReactNode;
		className: string;
		defaultOpen: boolean;
		summary: ReactNode;
	}) => (
		<section className={className} data-default-open={String(defaultOpen)}>
			{summary}
			{children}
		</section>
	),
}));

vi.mock("../src/modules/nightworkers/components/ThreadMessage", () => ({
	ThreadMessage: ({
		children,
		messageRole,
		timestamp,
	}: {
		children: ReactNode;
		messageRole: string;
		timestamp: string;
	}) => (
		<article data-role={messageRole} data-timestamp={timestamp}>
			{children}
		</article>
	),
}));

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineMarkdown",
	() => ({
		ChatMarkdown: ({
			content,
			onOpenEvidenceCheckArtifact,
			onOpenProjectFile,
			onOpenReviewModeArtifact,
		}: {
			content: string;
			onOpenEvidenceCheckArtifact?: () => void;
			onOpenProjectFile?: (path: string) => void;
			onOpenReviewModeArtifact?: () => void;
		}) => {
			onOpenProjectFile?.("src/from-markdown.ts");
			onOpenEvidenceCheckArtifact?.();
			onOpenReviewModeArtifact?.();
			return <div data-chat-markdown={content}>{content}</div>;
		},
		NightWorkersCodeBlock: ({
			code,
			filename,
			language,
		}: {
			code: string;
			filename: string;
			language: string;
		}) => (
			<pre data-filename={filename} data-language={language}>
				{code}
			</pre>
		),
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineMessagePayload",
	() => ({
		MessagePayload: ({
			message,
			onOpenArtifact,
			onOpenEvidenceCheckArtifact,
			onOpenProjectFile,
			onOpenReviewModeArtifact,
		}: {
			message: { id: string };
			onOpenArtifact: (artifact: unknown) => void;
			onOpenEvidenceCheckArtifact?: () => void;
			onOpenProjectFile?: (path: string) => void;
			onOpenReviewModeArtifact?: () => void;
		}) => {
			onOpenArtifact({ id: "artifact-from-payload" });
			onOpenProjectFile?.("src/from-payload.ts");
			onOpenEvidenceCheckArtifact?.();
			onOpenReviewModeArtifact?.();
			return <div data-message-payload={message.id} />;
		},
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineDiffView",
	() => ({
		DiffCodeBlock: ({ code, label }: { code: string; label: string }) => (
			<pre data-diff-label={label}>{code}</pre>
		),
		parseDiffMetadata: vi.fn(),
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineImportProjectCard",
	() => ({
		hasImportProjectToolCard: (event: { kind: string }) =>
			event.kind === "tool.import",
		ImportProjectToolCard: ({ event }: { event: { id: string } }) => (
			<div data-special-card="import">{event.id}</div>
		),
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineContextStillCards",
	() => ({
		hasContextStillToolCard: (event: { kind: string }) =>
			event.kind === "tool.context",
		ContextStillToolCard: ({ event }: { event: { id: string } }) => (
			<div data-special-card="context">{event.id}</div>
		),
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineInspectionToolCard",
	() => ({
		hasInspectionToolCard: (event: { kind: string }) =>
			event.kind === "tool.inspection",
		InspectionToolCard: ({ event }: { event: { id: string } }) => (
			<div data-special-card="inspection">{event.id}</div>
		),
	}),
);

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineCodexToolCard",
	() => ({
		hasCodexToolCard: (event: { kind: string }) => event.kind === "tool.codex",
		CodexToolCard: ({ event }: { event: { id: string } }) => (
			<div data-special-card="codex">{event.id}</div>
		),
	}),
);

import type { TranscriptItem } from "../src/modules/nightworkers/activityTranscript";
import {
	findArtifactTaskMessage,
	TranscriptItemView,
} from "../src/modules/nightworkers/components/ThreadTimelineActivityTranscript";
import type { ActivityEvent } from "../src/modules/nightworkers/types";

function event(
	kind: string,
	overrides: Partial<ActivityEvent> = {},
): ActivityEvent {
	return {
		id: overrides.id || `event-${kind}`,
		taskId: "task-1",
		runId: "run-1",
		turnId: "turn-1",
		seq: 4,
		kind,
		source: "runtime",
		status: "completed",
		text: null,
		payloadJson: {},
		visibility: "normal",
		traceOwner: "coding_agent",
		traceChannel: "task",
		createdAt: "2026-08-09T01:02:00Z",
		...overrides,
	} as ActivityEvent;
}

function renderItem(item: TranscriptItem) {
	return renderToStaticMarkup(
		<TranscriptItemView
			item={item}
			onOpenArtifact={callbackMocks.openArtifact}
			onOpenProjectFile={callbackMocks.openProjectFile}
			onOpenEvidenceCheckArtifact={callbackMocks.openEvidence}
			onOpenReviewModeArtifact={callbackMocks.openReview}
		/>,
	);
}

beforeEach(() => {
	for (const callback of Object.values(callbackMocks)) callback.mockClear();
});

describe("ThreadTimelineActivityTranscript extra coverage", () => {
	it("finds every supported artifact metadata shape and rejects near misses", () => {
		const baseMessage = {
			id: "message-1",
			messageType: "markdown_document",
			content: "artifact",
		};
		const fromMessageMetadata = event("assistant.message", {
			payloadJson: {
				message: {
					...baseMessage,
					metadataJson: { artifactRef: { id: "artifact-1" } },
				},
			},
		});
		const fromPayloadMetadata = event("assistant.message", {
			payloadJson: {
				message: baseMessage,
				metadata: { appBlueprint: { title: "App" } },
			},
		});
		const mockBlueprint = event("assistant.message", {
			payloadJson: {
				message: baseMessage,
				metadata: { mockBlueprint: { title: "Mock" } },
			},
		});

		expect(
			findArtifactTaskMessage([fromMessageMetadata])?.metadataJson,
		).toEqual({ artifactRef: { id: "artifact-1" } });
		expect(
			findArtifactTaskMessage([fromPayloadMetadata])?.metadataJson,
		).toEqual({
			appBlueprint: { title: "App" },
		});
		expect(findArtifactTaskMessage([mockBlueprint])).not.toBeNull();
		expect(
			findArtifactTaskMessage([
				event("system.info", { payloadJson: "invalid" }),
				event("assistant.message", {
					payloadJson: {
						message: { ...baseMessage, messageType: "text" },
						metadata: { artifactRef: {} },
					},
				}),
			]),
		).toBeNull();
	});

	it("renders user and assistant turns with fallback, visible, empty, and artifact payloads", () => {
		let markup = renderItem({
			kind: "user_turn",
			id: "user-empty",
			turnId: "turn-user",
			events: [],
			text: "direct user text",
		});
		expect(markup).toContain('data-role="user"');
		expect(markup).toContain('data-timestamp="no-time"');
		expect(markup).toContain("direct user text");

		markup = renderItem({
			kind: "user_turn",
			id: "user-fallback",
			turnId: "turn-user",
			events: [event("user.message", { text: "event fallback" })],
			text: "",
		});
		expect(markup).toContain("fallback:event fallback");
		expect(markup).toContain("finished:2026-08-09T01:02:00Z");

		markup = renderItem({
			kind: "assistant_turn",
			id: "assistant-visible",
			turnId: "turn-1",
			events: [event("assistant.delta")],
			text: "answer",
			children: [],
		});
		expect(markup).toContain("visible:answer");

		markup = renderItem({
			kind: "assistant_turn",
			id: "assistant-empty",
			turnId: "turn-1",
			events: [],
			text: "hidden:internal",
			children: [],
		});
		expect(markup).not.toContain("data-chat-markdown");

		const artifactMessageEvent = event("assistant.message", {
			payloadJson: {
				message: {
					id: "artifact-message",
					messageType: "markdown_document",
					metadataJson: { artifactRef: { id: "artifact-1" } },
				},
			},
		});
		markup = renderItem({
			kind: "assistant_turn",
			id: "assistant-artifact",
			turnId: "turn-1",
			events: [artifactMessageEvent],
			text: "artifact text",
			children: [],
		});
		expect(markup).toContain('data-message-payload="artifact-message"');
		expect(callbackMocks.openArtifact).toHaveBeenCalledWith({
			id: "artifact-from-payload",
		});
		expect(callbackMocks.openProjectFile).toHaveBeenCalled();
		expect(callbackMocks.openEvidence).toHaveBeenCalled();
		expect(callbackMocks.openReview).toHaveBeenCalled();
	});

	it("renders every assistant child kind and all code/detail states", () => {
		const normalCode = event("tool.normal", {
			id: "normal-code",
			payloadJson: {
				code: "const value = 1",
				filename: "value.ts",
				language: "typescript",
				summary: "normal summary",
			},
		});
		const diffCode = event("file.patch", {
			id: "diff-code",
			payloadJson: { filename: "change.patch", language: "diff" },
		});
		const llm = event("llm.schema_result", {
			id: "llm-empty-code",
			payloadJson: { llm: true },
		});
		const highVolume = event("run.status", {
			id: "high-volume",
			status: null,
			payloadJson: { highVolume: true },
		});
		const markup = renderItem({
			kind: "assistant_turn",
			id: "assistant-children",
			turnId: "turn-1",
			events: [normalCode],
			text: "hidden:internal",
			children: [
				{ kind: "tool", events: [normalCode] },
				{ kind: "tool", events: [] },
				{
					kind: "diff",
					event: diffCode,
					artifact: { contentText: "--- old\n+++ new" } as never,
				},
				{ kind: "json", event: llm },
				{
					kind: "log",
					event: event("command.output", {
						id: "log-code",
						payloadJson: { code: "command output" },
					}),
				},
				{
					kind: "unknown",
					event: event("unknown.activity", {
						id: "unknown-child",
						payloadJson: { summary: "" },
					}),
					artifact: { contentText: null } as never,
				},
				{ kind: "status", event: highVolume },
			],
		});

		expect(markup).toContain("normal summary");
		expect(markup).toContain('data-language="typescript"');
		expect(markup).toContain('data-diff-label="change.patch"');
		expect(markup).toContain("llm-json:llm-empty-code");
		expect(markup).toContain("command output");
		expect(markup).toContain("nightworkers-chat-card-tone-warning");
		expect(markup).toContain('data-default-open="false"');
		expect(markup).toContain("translated:timeline.unknownActivity");
	});

	it("renders visible diffs, ordinary and unknown activities, and every special tool card", () => {
		const visibleDiff = renderItem({
			kind: "activity",
			id: "activity-diff",
			event: event("file.diff", {
				id: "visible-diff",
				payloadJson: {
					code: "--- old\n+++ new",
					filename: "activity.diff",
					language: "diff",
				},
			}),
		});
		expect(visibleDiff).toContain('data-role="assistant"');
		expect(visibleDiff).toContain('data-diff-label="activity.diff"');

		const emptyDiff = renderItem({
			kind: "activity",
			id: "activity-empty-diff",
			event: event("file.diff", { id: "empty-diff", payloadJson: {} }),
		});
		expect(emptyDiff).not.toContain("data-role");

		const ordinary = renderItem({
			kind: "activity",
			id: "activity-ordinary",
			event: event("system.info", {
				id: "ordinary",
				status: null,
				payloadJson: null,
			}),
		});
		expect(ordinary).toContain("system.info");
		expect(ordinary).toContain('data-default-open="true"');

		const unknown = renderItem({
			kind: "unknown",
			id: "unknown-root",
			event: event("unknown.activity", { id: "unknown-root-event" }),
			artifact: { contentText: "unknown artifact content" } as never,
		});
		expect(unknown).toContain("unknown artifact content");
		expect(unknown).toContain("nightworkers-chat-card-tone-warning");

		const specialKinds = [
			["tool.import", "import"],
			["tool.context", "context"],
			["tool.inspection", "inspection"],
			["tool.codex", "codex"],
		] as const;
		for (const [kind, card] of specialKinds) {
			const markup = renderItem({
				kind: "activity",
				id: `activity-${card}`,
				event: event(kind, { id: `${card}-event` }),
			});
			expect(markup).toContain(`data-special-card="${card}"`);
		}
	});
});
