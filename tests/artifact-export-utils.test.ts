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
	it("exports the same mapping and verify readiness to CSV and Markdown", () => {
		const snapshot: EvidenceCheckSnapshot = {
			version: 2,
			taskId: "11111111-1111-4111-8111-111111111111",
			runId: "33333333-3333-4333-8333-333333333333",
			verificationDocumentId: "22222222-2222-4222-8222-222222222222",
			specMessageId: null,
			specArtifactId: null,
			generatedAt: "2026-08-01T00:00:00.000Z",
			evaluatedAt: "2026-08-01T00:01:00.000Z",
			sourceStateHash: "current-source-hash",
			scope: {
				testScope: "unit",
				e2eAllowed: false,
				authorizedVerifyCommand: {
					id: "CMD-001",
					command: "bun run verify",
					cwd: null,
				},
			},
			mapping: {
				status: "matched",
				definitionDigest: "definition-hash",
				total: 1,
				matched: 1,
				items: [
					{
						id: "AC-001",
						text: "\t=SUM(A1:A2)",
						required: true,
						status: "matched",
						matches: [
							{
								caseKey: "case-1",
								name: "@passes current source",
								filePath: "tests/evidence.test.ts",
								runner: "vitest",
							},
						],
					},
				],
			},
			verify: {
				status: "passed",
				command: "bun run verify",
				cwd: null,
				exitCode: 0,
				sourceStateHash: "current-source-hash",
				finishedAt: "2026-08-01T00:00:50.000Z",
				logRefs: ["stdout", "stderr"],
			},
			confirmation: {
				status: "settled",
				initialEvidenceRunId: "44444444-4444-4444-8444-444444444444",
				confirmedAt: "2026-08-01T00:00:40.000Z",
			},
			assurance: {
				policyVersion: "strict_v1",
				status: "passed",
				verificationDocumentDigest: "sha256:document",
				receiptDigest: "sha256:receipt",
				reasonCodes: [],
				conditions: [
					{
						conditionId: "AC-001",
						text: "safe spreadsheet text",
						required: true,
						verificationKind: "automated_test",
						expectedEvidence: ["unit_test"],
						assuranceStatus: "safe_pass",
						reasonCode: null,
						evidenceRefs: [
							{
								evidenceRunId: "test-evidence-1",
								caseKey: "case-1",
								evidenceKind: "unit_test",
								sourceStateHash: "a".repeat(64),
							},
						],
						tests: [],
					},
				],
			},
			ready: true,
			suggestedAction: "write_final_report",
			readinessDigest: "sha256:ready",
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
		expect(csv).toContain('"matched"');
		expect(csv).toContain('"current-source-hash"');
		expect(csv).toContain('"22222222-2222-4222-8222-222222222222"');
		expect(markdown).toContain("Matched: 1/1");
		expect(markdown).toContain("current-source-hash");
		expect(markdown).toContain("Command: bun run verify");
		expect(markdown).toContain("Status: settled");
		expect(markdown).toContain("Policy: strict_v1");
		expect(markdown).toContain("Receipt digest: sha256:receipt");
		expect(csv).toContain('"strict_v1"');
		expect(csv).toContain('"settled"');
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
