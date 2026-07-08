import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	emptyHookForm,
	formFromAgentHook,
	hookFormToInput,
} from "../src/modules/hooks/agentHookSettingsForms";
import { useAgentHooks } from "../src/modules/hooks/useAgentHooks";
import {
	emptyMcpForm,
	formFromMcpServer,
	mcpFormToInput,
} from "../src/modules/mcp/mcpSettingsForms";
import { useMcpSettings } from "../src/modules/mcp/useMcpSettings";
import { useImplementationQueue } from "../src/modules/queue/useImplementationQueue";
import { useLlmSettings } from "../src/modules/settings/useLlmSettings";
import { useTodoWorkflowSettings } from "../src/modules/todo/useTodoWorkflowSettings";

function renderHookSnapshot(snapshot: () => unknown) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	let captured: unknown;
	function SnapshotComponent() {
		captured = snapshot();
		return <pre>{JSON.stringify(captured)}</pre>;
	}
	const markup = renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<SnapshotComponent />
		</QueryClientProvider>,
	);
	queryClient.clear();
	return { markup, captured };
}

function captureImplementationQueueHook() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	let captured!: ReturnType<typeof useImplementationQueue>;
	function Capture() {
		captured = useImplementationQueue();
		return null;
	}
	renderToStaticMarkup(
		<QueryClientProvider client={queryClient}>
			<Capture />
		</QueryClientProvider>,
	);
	return { queryClient, queue: captured };
}

function stubQueueFetch() {
	const fetchMock = vi.fn<typeof fetch>(async () => {
		return new Response(JSON.stringify({ ok: true }), {
			headers: { "content-type": "application/json" },
		});
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

describe("frontend hook snapshots and settings form transforms", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders initial React Query hook states without fetching during SSR", () => {
		const { markup } = renderHookSnapshot(() => ({
			mcp: useMcpSettings().mcpServers,
			hooks: useAgentHooks().agentHooks,
			llmProvider: useLlmSettings().activeProvider,
			todo: useTodoWorkflowSettings().todoWorkflowSettings,
			queue: useImplementationQueue().implementationQueue,
		}));

		expect(markup).toContain("llmProvider");
		expect(markup).toContain("azure");
		expect(markup).toContain("queue");
	});

	it("converts MCP server forms to editable forms and API inputs", () => {
		const form = formFromMcpServer({
			id: "mcp-1",
			name: "Docs",
			enabled: true,
			transport: "stdio",
			command: "node",
			args: ["server.js", "--stdio"],
			cwd: "/tmp/docs",
			env: { DOCS_ROOT: "/tmp/docs", MODE: "test" },
			toolPrefix: "docs",
			createdAt: "2026-07-08T00:00:00Z",
			updatedAt: "2026-07-08T00:00:00Z",
		});

		expect(form.argsText).toBe("server.js --stdio");
		expect(form.envText).toContain("DOCS_ROOT=/tmp/docs");
		expect(
			mcpFormToInput({
				...form,
				name: " Docs ",
				argsText: "server.js   --stdio",
				envText: "DOCS_ROOT=/tmp/docs\nIGNORED_LINE\nMODE=test",
			}),
		).toEqual({
			name: "Docs",
			enabled: true,
			transport: "stdio",
			command: "node",
			args: ["server.js", "--stdio"],
			url: undefined,
			cwd: "/tmp/docs",
			env: { DOCS_ROOT: "/tmp/docs", IGNORED_LINE: "", MODE: "test" },
			toolPrefix: "docs",
		});
		expect(
			mcpFormToInput({ ...emptyMcpForm, transport: "streamable_http" }),
		).toMatchObject({
			transport: "streamable_http",
			command: undefined,
			args: [],
			url: undefined,
		});
	});

	it("converts command and HTTP Agent Hook forms to API inputs", () => {
		const commandForm = formFromAgentHook({
			id: "hook-1",
			name: "Format",
			enabled: true,
			event: "PreToolUse",
			matcher: "apply_patch",
			handler: {
				type: "command",
				command: "bun",
				args: ["format"],
				cwd: "/tmp/nightworkers",
				env: { CI: "1" },
				timeoutSeconds: 10,
				failClosed: true,
			},
			createdAt: "2026-07-08T00:00:00Z",
			updatedAt: "2026-07-08T00:00:00Z",
		});
		const httpForm = formFromAgentHook({
			id: "hook-2",
			name: "Notify",
			enabled: false,
			event: "SessionEnd",
			handler: {
				type: "http",
				url: "https://hooks.example.test",
				headers: { "X-Test": "1" },
				timeoutSeconds: 20,
				failClosed: false,
			},
			createdAt: "2026-07-08T00:00:00Z",
			updatedAt: "2026-07-08T00:00:00Z",
		});

		expect(commandForm.handlerType).toBe("command");
		expect(commandForm.argsText).toBe("format");
		expect(hookFormToInput(commandForm)).toMatchObject({
			name: "Format",
			enabled: true,
			event: "PreToolUse",
			matcher: "apply_patch",
			handler: {
				type: "command",
				command: "bun",
				args: ["format"],
				cwd: "/tmp/nightworkers",
				env: { CI: "1" },
				timeoutSeconds: 10,
				failClosed: true,
			},
		});
		expect(hookFormToInput(httpForm)).toMatchObject({
			name: "Notify",
			enabled: false,
			event: "SessionEnd",
			matcher: undefined,
			handler: {
				type: "http",
				url: "https://hooks.example.test",
				headers: { "X-Test": "1" },
				timeoutSeconds: 20,
				failClosed: false,
			},
		});
		expect(hookFormToInput(emptyHookForm)).toMatchObject({
			event: "PreToolUse",
			matcher: "*",
			handler: { type: "command", args: [] },
		});
	});

	it("runs implementation queue mutation helpers through stable endpoints", async () => {
		const fetchMock = stubQueueFetch();
		const { queryClient, queue } = captureImplementationQueueHook();

		await queue.createImplementationQueueEntry("task-1", {
			approveMissionProposal: true,
		});
		await queue.archiveImplementationQueueEntry("entry-1");
		await queue.removeImplementationQueueEntry("entry-2");
		await queue.requeueImplementationQueueEntry("entry-3", "try again");
		await queue.updateImplementationQueueEntry("entry-4", {
			queuePosition: 2,
			priority: 7,
		});
		await queue.updateImplementationQueueProcessorCount(3);
		await queue.recoverImplementationQueueEntry(
			"entry-5",
			"mark_needs_human",
			"blocked",
		);

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/implementation-queue/entries",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					taskId: "task-1",
					approveMissionProposal: true,
				}),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/implementation-queue/entries/entry-1/archive",
			{ method: "POST" },
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"/api/implementation-queue/entries/entry-2",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ action: "cancel" }),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			4,
			"/api/implementation-queue/entries/entry-2/archive",
			{ method: "POST" },
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			7,
			"/api/implementation-queue/settings",
			expect.objectContaining({
				method: "PATCH",
				body: JSON.stringify({ processorCount: 3 }),
			}),
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			8,
			"/api/implementation-queue/entries/entry-5/recover",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					action: "mark_needs_human",
					note: "blocked",
				}),
			}),
		);
		queryClient.clear();
	});
});
