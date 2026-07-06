import { beforeEach, vi } from "vitest";
import * as repo from "../../api/modules/nightworkers/nightworkers.repository";

vi.mock("../../api/modules/nightworkers/nightworkers.repository", () => ({
	listTaskRunTodosForRun: vi.fn(),
}));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(repo.listTaskRunTodosForRun).mockRejectedValue(
		new Error("todo db unavailable"),
	);
});

export { repo };
