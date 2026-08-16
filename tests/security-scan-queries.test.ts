import { describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const finding = {
	ref: "finding-1",
	severity: "high",
	title: "Finding",
	category: null,
	tool: "scanner",
	ruleId: null,
	location: { path: "src/a.ts", startLine: 1, endLine: 1 },
	description: null,
	evidence: null,
	recommendation: null,
	references: [],
};

async function loadQueries(
	fetchSecurityScanFindings = vi.fn(async () =>
		jsonResponse({ items: [], nextCursor: null }),
	),
) {
	vi.resetModules();
	vi.doMock("../src/modules/securityScan/securityScanCommands", () => ({
		fetchSecurityScanFindings,
		fetchSecurityScanProviderSettings: vi.fn(),
		fetchSecurityScanCapabilities: vi.fn(),
		fetchSecurityScanHistory: vi.fn(),
		fetchSecurityScan: vi.fn(),
		fetchSecurityScanReports: vi.fn(),
	}));
	return {
		...(await import("../src/modules/securityScan/security-scan-queries")),
		fetchSecurityScanFindings,
	};
}

describe("security scan query options", () => {
	it("uses repository/run identities and stops timer polling for terminal data", async () => {
		const queries = await loadQueries();
		const detail = queries.securityScanDetailQueryOptions("repo-1", "scan-1");
		const reports = queries.securityScanReportsQueryOptions(
			"repo-1",
			"scan-1",
			true,
		);
		expect(detail.queryKey).toEqual([
			"security-scan",
			"detail",
			"repo-1",
			"scan-1",
		]);
		expect(reports.queryKey).toEqual([
			"security-scan",
			"reports",
			"repo-1",
			"scan-1",
		]);
		expect(
			(detail.refetchInterval as (query: unknown) => unknown)({
				state: { data: { status: "completed" } },
			}),
		).toBe(false);
		expect(
			(detail.refetchInterval as (query: unknown) => unknown)({
				state: { data: { status: "running" } },
			}),
		).toBe(2_000);
		expect(
			(reports.refetchInterval as (query: unknown) => unknown)({
				state: { data: [{ status: "completed" }] },
			}),
		).toBe(false);
		expect(
			(reports.refetchInterval as (query: unknown) => unknown)({
				state: { data: [{ status: "running" }] },
			}),
		).toBe(2_000);
	});

	it("deduplicates paged findings, observes the cap, and rejects cursor cycles", async () => {
		const fetchPages = vi.fn(
			async (_repositoryId: string, _scanRunRef: string, cursor?: string) =>
				jsonResponse(
					cursor
						? { items: [{ ...finding, ref: "finding-2" }], nextCursor: null }
						: {
								items: [finding, { ...finding, title: "Updated" }],
								nextCursor: "next",
							},
				),
		);
		let queries = await loadQueries(fetchPages);
		await expect(
			queries.fetchSecurityScanFindingPages("repo-1", "scan-1"),
		).resolves.toEqual([
			expect.objectContaining({ ref: "finding-1", title: "Updated" }),
			expect.objectContaining({ ref: "finding-2" }),
		]);
		expect(fetchPages).toHaveBeenCalledTimes(2);

		const cyclicFetch = vi.fn(async () =>
			jsonResponse({ items: [finding], nextCursor: "same" }),
		);
		queries = await loadQueries(cyclicFetch);
		await expect(
			queries.fetchSecurityScanFindingPages("repo-1", "scan-1"),
		).rejects.toThrow("Findingページングが循環しています。");
		expect(cyclicFetch).toHaveBeenCalledTimes(2);
	});
});
