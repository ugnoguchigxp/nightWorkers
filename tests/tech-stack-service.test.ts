import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.doUnmock("../api/modules/nightworkers/nightworkers.repository");
	vi.doUnmock("../api/modules/techStack/project-code-size.service");
	vi.doUnmock("../api/modules/techStack/project-stack-detector");
	vi.doUnmock("../api/modules/techStack/dependency-audit.service");
	vi.doUnmock("../api/modules/techStack/tech-stack.repository");
	vi.resetModules();
});

describe("Tech Stack dependency audit service", () => {
	it("runs Bun audit in the registered repository root", async () => {
		const runBunDependencyAudit = vi.fn(async () => ({
			packageManager: "bun" as const,
			auditedAt: new Date("2026-07-13T00:00:00.000Z"),
			counts: { total: 0, low: 0, moderate: 0, high: 0, critical: 0 },
			findings: [],
		}));
		vi.doMock("../api/modules/nightworkers/nightworkers.repository", () => ({
			getRepository: vi.fn(async () => ({
				id: "repo-1",
				localPath: "/registered/project",
			})),
		}));
		vi.doMock("../api/modules/techStack/project-stack-detector", () => ({
			detectProjectStackProfile: vi.fn(() => ({
				packageManager: "bun@1.3.14",
			})),
		}));
		vi.doMock("../api/modules/techStack/dependency-audit.service", () => ({
			runBunDependencyAudit,
		}));
		vi.doMock("../api/modules/techStack/tech-stack.repository", () => ({}));

		const { runRepositoryDependencyAudit } = await import(
			"../api/modules/techStack/tech-stack.service"
		);
		await runRepositoryDependencyAudit("repo-1");

		expect(runBunDependencyAudit).toHaveBeenCalledWith("/registered/project");
	});

	it("does not run a Bun audit for a non-Bun project", async () => {
		const runBunDependencyAudit = vi.fn();
		vi.doMock("../api/modules/nightworkers/nightworkers.repository", () => ({
			getRepository: vi.fn(async () => ({
				id: "repo-1",
				localPath: "/registered/project",
			})),
		}));
		vi.doMock("../api/modules/techStack/project-stack-detector", () => ({
			detectProjectStackProfile: vi.fn(() => ({ packageManager: "npm" })),
		}));
		vi.doMock("../api/modules/techStack/dependency-audit.service", () => ({
			runBunDependencyAudit,
		}));
		vi.doMock("../api/modules/techStack/tech-stack.repository", () => ({}));

		const { runRepositoryDependencyAudit } = await import(
			"../api/modules/techStack/tech-stack.service"
		);
		await expect(runRepositoryDependencyAudit("repo-1")).rejects.toThrow(
			"supported only for Bun projects",
		);
		expect(runBunDependencyAudit).not.toHaveBeenCalled();
	});
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
