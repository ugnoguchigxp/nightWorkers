import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvidenceCheckSnapshot } from "../shared/modules/codingAgent";
import {
	buildEvidenceCheckExportCsv,
	buildEvidenceCheckExportMarkdown,
} from "../src/modules/codingAgent/EvidenceCheckArtifactModel";
import {
	buildMarkdownFromValue,
	downloadBlob,
	markdownCodeBlock,
	resolveArtifactImagePixelRatio,
} from "../src/modules/nightworkers/artifactExport";
import { copyText } from "../src/modules/nightworkers/components/ArtifactPaneVersions";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("artifact export utilities", () => {
	it("exports Evidence CSV and Markdown from the same assurance snapshot", () => {
		const snapshot: EvidenceCheckSnapshot = {
			taskId: "11111111-1111-4111-8111-111111111111",
			verificationDocumentId: "22222222-2222-4222-8222-222222222222",
			specMessageId: null,
			specArtifactId: null,
			generatedAt: "2026-08-01T00:00:00.000Z",
			evaluatedAt: "2026-08-01T00:01:00.000Z",
			sourceStateHash: "current-source-hash",
			conditions: [
				{
					id: "AC-001",
					text: "\t=SUM(A1:A2)",
					status: "passed",
					required: true,
					verificationKind: "automated_test",
					expectedEvidence: ["unit_test"],
					evidenceIds: ["evidence-1"],
					reason: null,
					lastCheckedAt: "2026-08-01T00:00:55.000Z",
					assuranceStatus: "safe_pass",
					assuranceReason: null,
					tests: [
						{
							caseKey: "case-1",
							name: "@passes current source",
							filePath: "tests/evidence.test.ts",
							runner: "vitest",
							mappingSource: "schema_evidence_set",
							execution: {
								status: "passed",
								evidenceRunId: "evidence-run-1",
								durationMs: 12,
								finishedAt: "2026-08-01T00:00:50.000Z",
							},
							guards: {
								currentSource: true,
								sourceStableDuringExecution: true,
								testExecutionObserved: true,
								fullVerifyPassed: true,
							},
						},
					],
				},
			],
			implementationPlanTraceability: null,
			summary: { total: 1, confirmed: 1, failed: 0, pending: 0 },
			assuranceSummary: {
				automated: 1,
				safePass: 1,
				failed: 0,
				attention: 0,
				fullVerifyStatus: "passed",
			},
		};
		const csv = buildEvidenceCheckExportCsv(snapshot);
		const markdown = buildEvidenceCheckExportMarkdown({
			title: "Evidence Check",
			model: null,
			snapshot,
		});

		expect(csv.startsWith("\uFEFF")).toBe(true);
		expect(csv).toContain('"\'\t=SUM(A1:A2)"');
		expect(csv).toContain('"\'@passes current source"');
		expect(csv).toContain('"safe_pass"');
		expect(csv).toContain('"current-source-hash"');
		expect(csv).toContain('"evidence-1"');
		expect(csv).toContain('"22222222-2222-4222-8222-222222222222"');
		expect(markdown).toContain("Safe Pass: 1/1");
		expect(markdown).toContain("current-source-hash");
		expect(markdown).toContain("currentSource=true");
		expect(markdown).toContain("Evidence refs: evidence-1");
		expect(markdown).toContain(
			"Verification Document: 22222222-2222-4222-8222-222222222222",
		);
	});

	it("uses a longer Markdown fence when exported content contains backticks", () => {
		const block = markdownCodeBlock(
			"before\n```ts\ninside\n```\nafter",
			"json",
		);
		expect(block).toMatch(/^````json\n/);
		expect(block).toMatch(/\n````$/);
		expect(
			buildMarkdownFromValue("Artifact", { note: "```nested```" }),
		).toContain("````json");
	});

	it("keeps PNG output within the conservative cross-webview limits", () => {
		expect(resolveArtifactImagePixelRatio(720, 10_000)).toBe(1.6);
		expect(() => resolveArtifactImagePixelRatio(720, 16_001)).toThrow(
			"artifact_image_too_large",
		);
	});

	it("attaches the download link before clicking and revokes its URL later", () => {
		vi.useFakeTimers();
		const click = vi.fn();
		const remove = vi.fn();
		const anchor = {
			href: "",
			download: "",
			style: { display: "" },
			click,
			remove,
		};
		const appendChild = vi.fn();
		const revokeObjectURL = vi.fn();
		vi.stubGlobal("document", {
			createElement: vi.fn(() => anchor),
			body: { appendChild },
		});
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn(() => "blob:artifact"),
			revokeObjectURL,
		});

		downloadBlob(new Blob(["artifact"]), "artifact.md");

		expect(appendChild).toHaveBeenCalledWith(anchor);
		expect(click).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledOnce();
		expect(revokeObjectURL).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1_000);
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:artifact");
	});

	it("reports a failed legacy clipboard copy instead of treating it as success", async () => {
		const textarea = {
			value: "",
			style: { position: "", left: "" },
			setAttribute: vi.fn(),
			select: vi.fn(),
			remove: vi.fn(),
		};
		vi.stubGlobal("navigator", {});
		vi.stubGlobal("document", {
			createElement: vi.fn(() => textarea),
			execCommand: vi.fn(() => false),
			body: { appendChild: vi.fn() },
		});

		await expect(copyText("artifact markdown")).rejects.toThrow(
			"clipboard_copy_failed",
		);
		expect(textarea.remove).toHaveBeenCalledOnce();
	});
});
