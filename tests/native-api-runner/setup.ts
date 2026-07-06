import { afterEach, beforeEach, vi } from "vitest";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";
import {
	defaultNativeApiRunnerSettings,
	installRuntimeLlmSettings,
} from "./helpers";

vi.mock("../../api/modules/nightworkers/nightworkers.repository", () => ({
	getTaskRun: vi.fn(),
	listTaskRunTodosForRun: vi.fn(),
	updateTaskRunTodo: vi.fn(),
	createTaskEvent: vi.fn(),
}));

vi.mock("../../api/services/mcp/mcp-client-manager", () => ({
	mcpClientManager: {
		listAvailableTools: vi.fn(async () => []),
		callTool: vi.fn(),
	},
}));

let restoreDefaultSettings: (() => void) | null = null;

beforeEach(() => {
	restoreDefaultSettings = installRuntimeLlmSettings(
		defaultNativeApiRunnerSettings(),
	);
	vi.clearAllMocks();
	vi.mocked(repo.getTaskRun).mockResolvedValue({
		id: "run-1",
		status: "running",
	} as never);
	vi.mocked(repo.listTaskRunTodosForRun).mockResolvedValue([]);
	vi.mocked(repo.updateTaskRunTodo).mockResolvedValue({} as never);
});

afterEach(() => {
	restoreDefaultSettings?.();
	restoreDefaultSettings = null;
});
