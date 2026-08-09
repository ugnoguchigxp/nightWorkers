import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	transcriptItems: [] as Array<Record<string, unknown>>,
	normalItems: null as Array<Record<string, unknown>> | null,
	streamingPreview: null as Record<string, unknown> | null,
	persistedPreview: null as Record<string, unknown> | null,
	transcriptAnchor: null as string | null,
	timelineAnchor: null as string | null,
	permission: {
		isOpen: false,
		path: null as string | null,
		isGranting: false,
		error: null as string | null,
		dismiss: vi.fn(),
		grant: vi.fn(),
	},
	permissionCallbacks: null as null | {
		onDismiss: () => void;
		onGrant: () => void;
	},
}));

vi.mock("../src/modules/codingAgent", () => ({
	isCodingAgentChatTrace: (event: { coding?: boolean }) =>
		event.coding !== false,
}));
vi.mock("../src/modules/nightworkers/activityTranscript", () => ({
	buildTranscriptItems: () => mocks.transcriptItems,
}));
vi.mock("../src/modules/nightworkers/artifactPerformance", () => ({
	measureArtifactPerf: (
		_name: string,
		callback: () => unknown,
		_metadata: unknown,
	) => callback(),
}));
vi.mock("../src/modules/nightworkers/messageVisibility", () => ({
	isUserVisibleChatMessage: (message: { visible?: boolean }) =>
		message.visible !== false,
}));
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelinePermission.controller",
	() => ({
		useExternalPathPermissionController: () => mocks.permission,
	}),
);
vi.mock("../src/modules/nightworkers/components/ThreadMessage", () => ({
	ThreadMessage: ({
		messageRole,
		timestamp,
		children,
	}: {
		messageRole: string;
		timestamp?: string;
		children: React.ReactNode;
	}) => (
		<div data-testid={`message-${messageRole}`} data-timestamp={timestamp}>
			{children}
		</div>
	),
}));
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineActivityTranscript",
	() => ({
		TranscriptItemView: ({ item }: { item: { id: string } }) => (
			<div data-testid={`transcript-${item.id}`} />
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineAgentCards",
	() => ({
		hasAgentEditSummary: (event: { edit?: boolean }) => Boolean(event.edit),
		isReviewerEvaluationEvent: (event: { reviewer?: boolean }) =>
			Boolean(event.reviewer),
		AgentDebugEventCard: ({ event }: { event: { id: string } }) => (
			<div data-testid={`debug-${event.id}`} />
		),
		AgentEditSummaryCard: ({ event }: { event: { id: string } }) => (
			<div data-testid={`edit-${event.id}`} />
		),
		ReviewerEvaluationCard: ({ event }: { event: { id: string } }) => (
			<div data-testid={`reviewer-${event.id}`} />
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineCodexToolCard",
	() => ({
		hasCodexToolCard: (event: { codex?: boolean }) => Boolean(event.codex),
		CodexToolCard: ({ event }: { event: { id: string } }) => (
			<div data-testid={`codex-${event.id}`} />
		),
		NormalCodexToolCard: ({ event }: { event: { id: string } }) => (
			<div data-testid={`normal-codex-${event.id}`} />
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineContextStillCards",
	() => ({
		hasContextStillToolCard: (event: { context?: boolean }) =>
			Boolean(event.context),
		NormalContextStillToolCard: ({ event }: { event: { id: string } }) => (
			<div data-testid={`context-${event.id}`} />
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineImportProjectCard",
	() => ({
		hasImportProjectToolCard: (event: { importProject?: boolean }) =>
			Boolean(event.importProject),
		NormalImportProjectToolCard: ({ event }: { event: { id: string } }) => (
			<div data-testid={`import-${event.id}`} />
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineInspectionToolCard",
	() => ({
		hasInspectionToolCard: (event: { inspection?: boolean }) =>
			Boolean(event.inspection),
		NormalInspectionToolCard: ({ event }: { event: { id: string } }) => (
			<div data-testid={`inspection-${event.id}`} />
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineMessagePayload",
	() => ({
		MessagePayload: ({ message }: { message: { id: string } }) => (
			<div data-testid={`payload-${message.id}`} />
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineNormalTranscript",
	() => ({
		buildNormalTranscriptItems: (items: Array<Record<string, unknown>>) =>
			mocks.normalItems ?? items,
		NormalTranscriptItemView: ({ item }: { item: { id: string } }) => (
			<div data-testid={`normal-transcript-${item.id}`} />
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelinePermissionDialog",
	() => ({
		ThreadTimelinePermissionDialog: ({
			path,
			onDismiss,
			onGrant,
		}: {
			path: string;
			onDismiss: () => void;
			onGrant: () => void;
		}) => {
			mocks.permissionCallbacks = { onDismiss, onGrant };
			return <div data-testid="permission-dialog">{path}</div>;
		},
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineEventModel",
	() => ({
		findRuntimePromptSnapshotTimelineAnchorId: () => mocks.timelineAnchor,
		findRuntimePromptSnapshotTranscriptAnchorId: () => mocks.transcriptAnchor,
		toMs: (value: unknown) => new Date(String(value)).getTime(),
		transcriptItemTimestamp: (item: { timestamp?: string }) =>
			new Date(item.timestamp ?? 0).getTime(),
		TimelineDebugFragment: ({
			insertRuntimeSnapshot,
			children,
		}: {
			insertRuntimeSnapshot: boolean;
			children: React.ReactNode;
		}) => (
			<div data-testid={insertRuntimeSnapshot ? "fragment-anchor" : "fragment"}>
				{children}
			</div>
		),
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineStreaming",
	() => ({
		buildStreamingResponsePreview: () => mocks.streamingPreview,
		buildPersistedStreamingResponsePreview: () => mocks.persistedPreview,
		StreamingResponsePreview: () => <div data-testid="streaming" />,
		PersistedStreamingResponse: () => <div data-testid="persisted" />,
		RuntimePromptSnapshotCard: () => <div data-testid="runtime-snapshot" />,
		ThinkingIndicator: () => <div data-testid="thinking" />,
		FinalReportCard: () => <div data-testid="final-report" />,
	}),
);
vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineVerificationEvidence",
	() => ({
		buildChatVerificationEvidenceHistory: () => new Map(),
	}),
);

import {
	findUnprojectedUserMessages,
	mergeUnprojectedMessagesChronologically,
	sliceTimelineWindow,
	ThreadTimeline,
} from "../src/modules/nightworkers/components/ThreadTimeline";

beforeEach(() => {
	mocks.transcriptItems = [];
	mocks.normalItems = null;
	mocks.streamingPreview = null;
	mocks.persistedPreview = null;
	mocks.transcriptAnchor = null;
	mocks.timelineAnchor = null;
	mocks.permissionCallbacks = null;
	mocks.permission = {
		isOpen: false,
		path: null,
		isGranting: false,
		error: null,
		dismiss: vi.fn(),
		grant: vi.fn(),
	};
});

describe("ThreadTimeline component extra coverage", () => {
	it("covers utility boundaries and stable chronological ordering", () => {
		expect(sliceTimelineWindow([1, 2, 3], { count: -1, end: 20 })).toEqual({
			items: [3],
			start: 2,
			end: 3,
			total: 3,
		});
		expect(sliceTimelineWindow([1, 2, 3], { end: -10 }).items).toEqual([]);

		const messages = [
			message("m1", "user", "same", "2026-01-01T00:00:00Z"),
			message("m2", "user", "same", "2026-01-01T00:00:00Z"),
			message("m3", "assistant", "ignored", "2026-01-01T00:00:00Z"),
			message("m4", "user", "new", "2026-01-01T00:00:01Z"),
		];
		const transcript = [
			{
				id: "t1",
				kind: "user_turn",
				text: "same",
				timestamp: "2026-01-01T00:00:00Z",
			},
			{ id: "t2", kind: "user_turn", text: "  ", timestamp: 0 },
			{ id: "t3", kind: "other", text: "new", timestamp: 0 },
		] as never;
		expect(findUnprojectedUserMessages(messages as never, transcript)).toEqual([
			messages[1],
			messages[3],
		]);
		expect(
			mergeUnprojectedMessagesChronologically(transcript, [
				messages[1],
			] as never).map((item) => item.id),
		).toEqual(["t2", "t3", "t1", "unprojected-m2"]);
	});

	it("renders non-transcript message roles and normal event cards", () => {
		mocks.persistedPreview = { text: "persisted" };
		const taskMessages = [
			message("assistant", "assistant", "a", "2026-01-01T00:00:01Z"),
			message("user", "user", "u", "2026-01-01T00:00:02Z"),
			message("system", "system", "s", "2026-01-01T00:00:03Z"),
			{
				...message("hidden", "user", "h", "2026-01-01T00:00:04Z"),
				visible: false,
			},
		];
		const events = [
			event("edit", { edit: true }),
			event("reviewer", { reviewer: true }),
			event("context", { context: true }),
			event("import", { importProject: true }),
			event("inspection", { inspection: true }),
			event("codex", { codex: true }),
			event("hidden"),
		];
		const markup = renderTimeline({ taskMessages, latestRunEvents: events });

		expect(
			markup.match(/data-testid="message-assistant"/g)?.length,
		).toBeGreaterThan(1);
		expect(markup).toContain('data-testid="message-user"');
		expect(markup).toContain('data-testid="message-system"');
		expect(markup).not.toContain("payload-hidden");
		expect(markup).toContain("edit-edit");
		expect(markup).toContain("reviewer-reviewer");
		expect(markup).toContain("context-context");
		expect(markup).toContain("import-import");
		expect(markup).toContain("inspection-inspection");
		expect(markup).toContain("normal-codex-codex");
		expect(markup).toContain('data-testid="persisted"');
		expect(markup).toContain('data-testid="final-report"');
	});

	it("renders live debug, streaming, anchor, and thinking states", () => {
		mocks.streamingPreview = { text: "streaming" };
		mocks.timelineAnchor = "evt-debug";
		const markup = renderTimeline({
			latestRunEvents: [event("debug", { timestamp: "" })],
			showDebugEvents: true,
			isAgentWorking: true,
			activeStreamingResponse: "active",
		});

		expect(markup).toContain("Live: event debug");
		expect(markup).toContain('data-testid="fragment-anchor"');
		expect(markup).toContain("codex-debug");
		expect(markup).toContain("debug-debug");
		expect(markup).toContain('data-testid="streaming"');
		expect(markup).toContain('data-testid="thinking"');
		expect(markup).toContain('data-testid="final-report"');
	});

	it("renders normal transcript and an unprojected user message", () => {
		mocks.transcriptItems = [transcript("one", "projected")];
		const markup = renderTimeline({
			taskMessages: [
				message("projected", "user", "projected", "2026-01-01T00:00:00Z"),
				message("unprojected", "user", "new", "2026-01-01T00:00:02Z"),
			],
			isAgentWorking: true,
		});

		expect(markup).toContain("normal-transcript-one");
		expect(markup).toContain("payload-unprojected");
		expect(markup).not.toContain('data-testid="streaming"');
		expect(markup).not.toContain('data-testid="final-report"');
		expect(markup).toContain('data-testid="thinking"');
	});

	it("renders debug transcript anchors and trailing runtime snapshots", () => {
		mocks.transcriptItems = [transcript("one", "projected")];
		mocks.transcriptAnchor = "one";
		const first = renderTimeline({
			latestRun: { id: "run", contextSnapshot: { ok: true } },
			showDebugEvents: true,
		});
		expect(first).toContain("transcript-one");
		expect(first).toContain('data-testid="fragment-anchor"');
		expect(first).not.toContain('data-testid="runtime-snapshot"');

		mocks.transcriptAnchor = null;
		const second = renderTimeline({
			latestRun: { id: "run", contextSnapshot: { ok: true } },
			showDebugEvents: true,
		});
		expect(second).toContain('data-testid="runtime-snapshot"');
	});

	it("opens permission controls and invokes their callbacks", () => {
		mocks.permission = {
			isOpen: true,
			path: "/outside",
			isGranting: true,
			error: "failed",
			dismiss: vi.fn(),
			grant: vi.fn(),
		};
		const markup = renderTimeline({ leadingContent: <div>lead</div> });
		expect(markup).toContain('data-testid="permission-dialog"');
		expect(markup).toContain("lead");
		mocks.permissionCallbacks?.onDismiss();
		mocks.permissionCallbacks?.onGrant();
		expect(mocks.permission.dismiss).toHaveBeenCalledOnce();
		expect(mocks.permission.grant).toHaveBeenCalledOnce();
	});

	it("pages backward and returns to the latest timeline window", () => {
		const taskMessages = Array.from({ length: 202 }, (_, index) =>
			message(
				`m${index}`,
				"user",
				`message ${index}`,
				new Date(index * 1_000).toISOString(),
			),
		);
		renderTimeline({ taskMessages });
		const markup = renderTimeline({ taskMessages });
		expect(markup).toContain('data-timeline-mounted-count="100"');
		expect(markup).toContain('data-timeline-total-count="202"');
		expect(markup).toContain("過去の履歴をさらに表示");
	});
});

function renderTimeline(overrides: Record<string, unknown> = {}) {
	return renderToStaticMarkup(
		<ThreadTimeline
			session={{ id: "task" } as never}
			runs={[]}
			taskMessages={[]}
			latestRunEvents={[]}
			activityEvents={[]}
			activityArtifacts={[]}
			activeStreamingResponse=""
			isAgentWorking={false}
			showDebugEvents={false}
			onOpenArtifact={vi.fn()}
			{...(overrides as never)}
		/>,
	);
}

function message(id: string, role: string, content: string, createdAt: string) {
	return { id, role, content, createdAt } as never;
}

function event(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		message: `event ${id}`,
		timestamp: `2026-01-01T00:01:${String(id.length).padStart(2, "0")}Z`,
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	} as never;
}

function transcript(id: string, text: string) {
	return {
		id,
		kind: "assistant_turn",
		text,
		timestamp: "2026-01-01T00:00:01Z",
	} as never;
}
