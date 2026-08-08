import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewRunResultPanel } from "../src/modules/review/components/ReviewRunResultPanel";

function securityArtifact(result: unknown) {
	return { artifact: { result } } as never;
}

describe("ReviewRunResultPanel coverage", () => {
	it("returns null without report, findings, or security diagnostics", () => {
		expect(
			ReviewRunResultPanel({
				reviewRun: null,
				visibleFindings: [],
				securityArtifact: undefined,
			}),
		).toBeNull();
		expect(
			ReviewRunResultPanel({
				reviewRun: {
					finalReport: "   ",
					options: { applyFixes: false },
				} as never,
				visibleFindings: [],
				securityArtifact: { artifact: [] } as never,
			}),
		).toBeNull();
	});

	it("renders and caps blocking, warning, and informational findings", () => {
		const findings = Array.from({ length: 10 }, (_, index) => ({
			id: `finding-${index}`,
			severity: index === 0 ? "blocking" : index === 1 ? "warning" : "info",
			title: `Finding ${index}`,
			body: index === 2 ? null : "b".repeat(600),
			filePath: index === 3 ? null : `src/file-${index}.ts`,
		}));
		const html = renderToStaticMarkup(
			<ReviewRunResultPanel
				reviewRun={
					{
						finalReport: "r".repeat(2300),
						options: { applyFixes: false },
						fixesApplied: false,
					} as never
				}
				visibleFindings={findings}
			/>,
		);
		expect(html).toContain("修正適用なし");
		expect(html).toContain("Finding 0");
		expect(html).toContain("Finding 7");
		expect(html).not.toContain("Finding 8");
		expect(html).toContain("...");
	});

	it("renders requested/applied fix status and an empty findings message", () => {
		const applied = renderToStaticMarkup(
			<ReviewRunResultPanel
				reviewRun={
					{
						finalReport: "Applied fixes",
						options: { applyFixes: true },
						fixesApplied: true,
					} as never
				}
				visibleFindings={[]}
			/>,
		);
		expect(applied).toContain("指摘事項と修正結果");
		expect(applied).toContain("修正済み");
		expect(applied).toContain("表示対象の指摘事項はありません");

		const pending = renderToStaticMarkup(
			<ReviewRunResultPanel
				reviewRun={
					{
						finalReport: "Pending fixes",
						options: { applyFixes: true },
						fixesApplied: false,
					} as never
				}
				visibleFindings={[]}
			/>,
		);
		expect(pending).toContain("修正適用あり");
	});

	it("normalizes a complete passing security diagnostic", () => {
		const html = renderToStaticMarkup(
			<ReviewRunResultPanel
				reviewRun={null}
				visibleFindings={[]}
				securityArtifact={securityArtifact({
					status: "completed",
					profile: "standard",
					scanRunId: "scan-1",
					findingCount: 0,
					highOrCriticalCount: 0,
					improvementRequest: null,
					topFindings: [],
					commandsRun: [],
					error: null,
				})}
			/>,
		);
		expect(html).toContain("vulnWorkbench 実行結果");
		expect(html).toContain("standard");
		expect(html).toContain("completed");
		expect(html).toContain("scan-1");
	});

	it("normalizes incomplete diagnostic shapes and rich finding evidence", () => {
		const topFindings = [
			{
				id: "finding-1",
				severity: "critical",
				tool: "semgrep",
				ruleId: "rule-1",
				title: "t".repeat(300),
				location: { path: "src/a.ts", line: 42 },
				recommendation: "Fix the input validation",
			},
			{
				id: null,
				severity: 123,
				tool: null,
				ruleId: null,
				title: null,
				location: { path: "src/b.ts", line: "bad" },
				recommendation: null,
			},
			{
				location: null,
			},
			...Array.from({ length: 9 }, (_, index) => ({
				id: `extra-${index}`,
				title: `Extra ${index}`,
			})),
		];
		const html = renderToStaticMarkup(
			<ReviewRunResultPanel
				reviewRun={null}
				visibleFindings={[]}
				securityArtifact={securityArtifact({
					ok: false,
					highOrCriticalCount: 2,
					profile: 123,
					scanRunId: null,
					findingCount: "bad",
					improvementRequest: "Address critical findings",
					topFindings,
					commandsRun: [
						{ command: "bun test", exitCode: 1, summary: "s".repeat(250) },
						{ command: null, exitCode: null, summary: null },
						"invalid",
					],
					error: "scanner failed",
				})}
			/>,
		);
		expect(html).toContain("security_action_required");
		expect(html).toContain("profile: unknown");
		expect(html).toContain("scanRunId: -");
		expect(html).toContain("scanner failed");
		expect(html).toContain("Address critical findings");
		expect(html).toContain("src/a.ts:42");
		expect(html).toContain("src/b.ts");
		expect(html).toContain("Untitled finding");
		expect(html).toContain("bun test");
		expect(html).not.toContain("Extra 8");
	});

	it("infers completed and runtime-error security states", () => {
		const completed = renderToStaticMarkup(
			<ReviewRunResultPanel
				reviewRun={null}
				visibleFindings={[]}
				securityArtifact={securityArtifact({ ok: true })}
			/>,
		);
		expect(completed).toContain("completed");

		const failed = renderToStaticMarkup(
			<ReviewRunResultPanel
				reviewRun={null}
				visibleFindings={[]}
				securityArtifact={securityArtifact({
					commandsRun: {},
					topFindings: {},
				})}
			/>,
		);
		expect(failed).toContain("runtime_error");
	});
});
