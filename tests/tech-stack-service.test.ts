import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.doUnmock("../api/modules/nightworkers/nightworkers.repository");
	vi.doUnmock("../api/modules/techStack/project-code-size.service");
	vi.doUnmock("../api/modules/techStack/tech-stack.repository");
	vi.resetModules();
});

describe("Tech Stack measurement service", () => {
	it("shares one in-flight measurement for duplicate repository requests", async () => {
		let releaseMeasurement:
			| ((value: { totals: { totalFiles: number } }) => void)
			| null = null;
		const pendingMeasurement = new Promise<{ totals: { totalFiles: number } }>(
			(resolve) => {
				releaseMeasurement = resolve;
			},
		);
		const measureProjectCodeSize = vi.fn(() => pendingMeasurement);
		const upsertProjectCodeSizeSnapshot = vi.fn(async () => ({
			id: "snapshot-1",
			repositoryId: "repo-1",
		}));

		vi.doMock("../api/modules/nightworkers/nightworkers.repository", () => ({
			getRepository: vi.fn(async () => ({
				id: "repo-1",
				localPath: "/tmp/project",
			})),
		}));
		vi.doMock("../api/modules/techStack/project-code-size.service", () => ({
			measureProjectCodeSize,
		}));
		vi.doMock("../api/modules/techStack/tech-stack.repository", () => ({
			getProjectCodeSizeSnapshot: vi.fn(),
			upsertProjectCodeSizeSnapshot,
		}));

		const { measureAndSaveProjectCodeSize } = await import(
			"../api/modules/techStack/tech-stack.service"
		);
		const first = measureAndSaveProjectCodeSize("repo-1");
		const second = measureAndSaveProjectCodeSize("repo-1");
		await vi.waitFor(() =>
			expect(measureProjectCodeSize).toHaveBeenCalledTimes(1),
		);
		expect(upsertProjectCodeSizeSnapshot).not.toHaveBeenCalled();

		releaseMeasurement?.({ totals: { totalFiles: 1 } });
		const [firstResult, secondResult] = await Promise.all([first, second]);
		expect(firstResult).toEqual(secondResult);
		expect(upsertProjectCodeSizeSnapshot).toHaveBeenCalledTimes(1);
	});
});
