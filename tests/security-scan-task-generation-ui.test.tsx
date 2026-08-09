import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SecurityScanRunDetail } from "../shared/schemas/security-scan.schema";
import { SecurityScanFindingsSection } from "../src/modules/securityScan/SecurityScanFindingsSection";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { count?: number }) =>
			values?.count === undefined ? key : `${key}:${values.count}`,
	}),
}));

function scan(status: SecurityScanRunDetail["status"]): SecurityScanRunDetail {
	return {
		scanRunRef: "33333333-3333-4333-8333-333333333333",
		status,
		outcome: "findings_present",
		presetId: "standard",
		profileRef: "standard-profile",
		target: {
			kind: "working_tree",
			digest: "a".repeat(64),
			sourceRevision: "abc123",
		},
		progress: { completedSteps: 1, totalSteps: 1, currentStep: null },
		summary: {
			findingCount: 1,
			severityCounts: {
				critical: 0,
				high: 1,
				medium: 0,
				low: 0,
				info: 0,
				unknown: 0,
			},
			coverage: { completed: 1, skipped: 0, failed: 0, gaps: [] },
		},
		lastEventSeq: 1,
		createdAt: "2026-08-06T00:00:00.000Z",
		startedAt: "2026-08-06T00:00:00.000Z",
		completedAt: status === "completed" ? "2026-08-06T00:01:00.000Z" : null,
		error: null,
	};
}

const findings = [
	{
		ref: "finding-1",
		severity: "high" as const,
		title: "Unsafe dependency",
		category: "dependency",
		tool: "osv",
		ruleId: "CVE-TEST",
		location: { path: "package.json", startLine: 1, endLine: 1 },
		description: "Known vulnerability",
		evidence: null,
		recommendation: "Upgrade",
		references: [],
	},
];

describe("security scan task generation UI", () => {
	it("shows an enabled generation button for selected completed findings", () => {
		const markup = renderToStaticMarkup(
			<SecurityScanFindingsSection
				findings={findings}
				activeScan={scan("completed")}
				selectedFindingRefs={["finding-1"]}
				generating={false}
				onSelectAll={() => undefined}
				onClearSelection={() => undefined}
				onToggleFinding={() => undefined}
				onGenerate={() => undefined}
			/>,
		);
		expect(markup).toContain("securityScan.generateTasksFromFindings:1");
		expect(markup).toContain("securityScan.findingSelectionLimit:25");
		expect(markup).toContain('type="checkbox"');
		expect(markup).toContain("checked");
		expect(markup).not.toMatch(/<button[^>]*\sdisabled(?:=|>)/);
	});

	it("disables generation before the scan is completed", () => {
		const markup = renderToStaticMarkup(
			<SecurityScanFindingsSection
				findings={findings}
				activeScan={scan("running")}
				selectedFindingRefs={["finding-1"]}
				generating={false}
				onSelectAll={() => undefined}
				onClearSelection={() => undefined}
				onToggleFinding={() => undefined}
				onGenerate={() => undefined}
			/>,
		);
		expect(markup).toMatch(/<button[^>]*\sdisabled(?:=|>)/);
	});
});
