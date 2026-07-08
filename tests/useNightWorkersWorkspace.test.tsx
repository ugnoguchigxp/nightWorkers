import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useNightWorkersWorkspace } from "../src/modules/nightworkers/hooks/useNightWorkersWorkspace";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// WebSocket Mock
global.WebSocket = class MockWebSocket {
	send = vi.fn();
	close = vi.fn();
} as any;

// API Mocks
vi.mock("../src/lib/api", () => ({
	client: {
		get: vi.fn().mockImplementation((url: string) => {
			if (url === "/api/repositories") {
				return Promise.resolve({ data: [{ id: "repo-1", name: "NightWorkers" }] });
			}
			if (url.startsWith("/api/tasks")) {
				return Promise.resolve({ data: [] });
			}
			return Promise.resolve({ data: {} });
		}),
	},
}));

vi.mock("../src/modules/specification", () => ({
	fetchPlanModeWorkspace: vi.fn().mockResolvedValue(null),
}));

vi.mock("../src/modules/nightworkers/nightWorkersCommands", () => ({
	fetchBackgroundProcessesForTask: vi.fn().mockResolvedValue([]),
	fetchImplementationQueue: vi.fn().mockResolvedValue(null),
	fetchLatestTaskReviewSession: vi.fn().mockResolvedValue(null),
	fetchRunGitCloseout: vi.fn().mockResolvedValue(null),
	fetchTaskActivityEvents: vi.fn().mockResolvedValue([]),
	fetchTaskLlmUsage: vi.fn().mockResolvedValue(null),
	fetchTaskMessages: vi.fn().mockResolvedValue([]),
}));

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
		},
	},
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
	<QueryClientProvider client={queryClient}>
		{children}
	</QueryClientProvider>
);

describe("useNightWorkersWorkspace hook", () => {
	beforeEach(() => {
		queryClient.clear();
	});

	it("initializes with default state values", () => {
		const { result } = renderHook(() => useNightWorkersWorkspace(), { wrapper });

		expect(result.current.projects).toBeDefined();
		expect(result.current.sessions).toEqual([]);
		expect(result.current.activeSessionId).toBeNull();
		expect(result.current.isRealtimeConnected).toBe(false);
	});
});
