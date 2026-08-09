import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const diagnosticMock = vi.hoisted(() => vi.fn());
const capabilitiesMock = vi.hoisted(() => vi.fn());
const profilePlanMock = vi.hoisted(() => vi.fn());
const diffPreviewMock = vi.hoisted(() => vi.fn());

vi.mock("../api/services/vulnworkbench-cli-runtime", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("../api/services/vulnworkbench-cli-runtime")
		>();
	return { ...actual, isVulnWorkbenchCliConfigured: () => true };
});

vi.mock(
	"../api/modules/review/review-vulnworkbench.service",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("../api/modules/review/review-vulnworkbench.service")
			>();
		return {
			...actual,
			readVulnWorkbenchCliSettings: () => ({
				enabled: true,
				cwd: "/workspace/vulnWorkbench",
				timeoutSeconds: 600,
			}),
			runVulnWorkbenchSecurityDiagnostic: diagnosticMock,
		};
	},
);

vi.mock(
	"../api/modules/securityScan/security-scan-local-cli-command",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("../api/modules/securityScan/security-scan-local-cli-command")
			>();
		return {
			...actual,
			loadVulnWorkbenchCliCapabilities: capabilitiesMock,
			loadVulnWorkbenchCliProfilePlan: profilePlanMock,
			loadVulnWorkbenchCliDiffPreview: diffPreviewMock,
		};
	},
);

import {
	localCliCancel,
	localCliCapabilities,
	localCliFindings,
	localCliPreview,
	localCliReportContent,
	localCliReports,
	localCliScanDetail,
	localCliStartScan,
} from "../api/modules/securityScan/security-scan-local-cli.service";

let tempRoot: string | null = null;
let originalRuntimeDir: string | undefined;

beforeEach(async () => {
	originalRuntimeDir = process.env.NIGHTWORKERS_RUNTIME_DIR;
	tempRoot = await fs.mkdtemp(
		path.join(os.tmpdir(), "nightworkers-local-scan-"),
	);
	process.env.NIGHTWORKERS_RUNTIME_DIR = path.join(tempRoot, "runtime");
	await fs.mkdir(path.join(tempRoot, "project"));
	await fs.writeFile(
		path.join(tempRoot, "project", "package.json"),
		'{"name":"fixture"}\n',
	);
	diagnosticMock.mockReset();
	capabilitiesMock.mockReset();
	capabilitiesMock.mockResolvedValue(capabilitiesFixture());
	profilePlanMock.mockReset();
	profilePlanMock.mockImplementation(async (profileRef: string) =>
		profilePlan(profileRef),
	);
	diffPreviewMock.mockReset();
	diffPreviewMock.mockResolvedValue({
		ok: true,
		preview: true,
		profileId: "diff-basic-security",
		target: {
			kind: "working_tree",
			targetDigest: "b".repeat(64),
			baseSha: "a".repeat(40),
			changedFileCount: 2,
		},
		coverage: { unsupported: 0, tooLarge: 0 },
		tools: [
			{
				toolId: "semgrep",
				applicability: "applicable",
				reasonCode: null,
			},
		],
	});
});

afterEach(async () => {
	if (originalRuntimeDir === undefined) {
		delete process.env.NIGHTWORKERS_RUNTIME_DIR;
	} else {
		process.env.NIGHTWORKERS_RUNTIME_DIR = originalRuntimeDir;
	}
	if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
	tempRoot = null;
});

describe("security scan local CLI", () => {
	it("rejects scan references that cannot be local artifact names", async () => {
		await expect(localCliScanDetail("../../outside")).rejects.toMatchObject({
			code: "SECURITY_SCAN_NOT_FOUND",
		});
	});

	it("scans the registered Project folder and persists UI-compatible evidence", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const projectPath = path.join(tempRoot, "project");
		diagnosticMock.mockResolvedValue({
			ok: true,
			status: "security_action_required",
			projectId: "vw-project-1",
			projectPath,
			scanRunId: "vw-scan-1",
			profile: "agent-output",
			topFindings: [
				{
					id: "finding-1",
					fingerprint: "fingerprint-1",
					severity: "high",
					tool: "semgrep",
					ruleId: "rule-1",
					title: "Unsafe boundary",
					location: { path: "src/app.ts", line: 12 },
					recommendation: "Validate the boundary.",
				},
				{
					id: "finding-2",
					fingerprint: "fingerprint-2",
					severity: "medium",
					tool: "osv",
					ruleId: "rule-2",
					title: "x".repeat(2000),
					location: { path: "package.json", line: 1 },
					recommendation: "Upgrade the dependency.",
				},
			],
			findingsTruncated: false,
			blockingFingerprints: ["fingerprint-1"],
			commandsRun: [],
			findingCount: 2,
			highOrCriticalCount: 1,
			severityCounts: {
				critical: 0,
				high: 1,
				medium: 1,
				low: 0,
				info: 0,
				unknown: 0,
			},
			coverage: { completed: 3, skipped: 0, failed: 0, gaps: [] },
			reviewStatus: "completed",
			improvementRequest: "境界検証を追加してください。",
			error: null,
		});

		const capabilities = await localCliCapabilities(projectPath);
		expect(capabilities.project.displayName).toBe("project");
		expect(capabilities.presets.map((preset) => preset.id)).toEqual([
			"quick",
			"standard",
			"deep",
		]);

		const preview = await localCliPreview(
			projectPath,
			{ mode: "preset", presetId: "standard" },
			{ kind: "full" },
		);
		const started = await localCliStartScan(
			projectPath,
			{
				previewRef: preview.previewRef,
				selection: { mode: "preset", presetId: "standard" },
				target: { kind: "full" },
				expectedTargetDigest: preview.target.digest,
			},
			"11111111-1111-4111-8111-111111111111",
		);
		expect(started.status).toBe("queued");

		const detail = await waitForTerminal(started.scanRunRef);
		expect(detail, detail.error?.message).toMatchObject({
			status: "completed",
			outcome: "findings_present",
			summary: {
				findingCount: 2,
				severityCounts: { high: 1, medium: 1 },
				coverage: { completed: 3, skipped: 0, failed: 0, gaps: [] },
			},
		});
		expect(diagnosticMock).toHaveBeenCalledWith(
			expect.objectContaining({
				target: { repoRoot: projectPath, targetFiles: [] },
				profile: "basic-security",
				scanTarget: "full",
				findingLimit: 1_000,
			}),
		);

		const firstPage = await localCliFindings(
			started.scanRunRef,
			new URLSearchParams("limit=1"),
		);
		expect(firstPage.items[0]).toMatchObject({
			ref: "finding-1",
			severity: "high",
			location: { path: "src/app.ts", startLine: 12 },
		});
		expect(firstPage.nextCursor).toBe("1");
		const secondPage = await localCliFindings(
			started.scanRunRef,
			new URLSearchParams(`limit=1&cursor=${firstPage.nextCursor}`),
		);
		expect(secondPage.items[0]?.ref).toBe("finding-2");
		expect(secondPage.items[0]?.title).toHaveLength(1024);
		expect(secondPage.nextCursor).toBeNull();

		const reports = await localCliReports(started.scanRunRef);
		expect(reports.items).toHaveLength(1);
		const report = reports.items[0];
		if (!report) throw new Error("report was not generated");
		const content = await localCliReportContent(
			started.scanRunRef,
			report.reportRef,
		);
		expect(content.content).toContain("境界検証を追加してください");

		const replayed = await localCliStartScan(
			projectPath,
			{
				previewRef: preview.previewRef,
				selection: { mode: "preset", presetId: "standard" },
				target: { kind: "full" },
				expectedTargetDigest: preview.target.digest,
			},
			"11111111-1111-4111-8111-111111111111",
		);
		expect(replayed).toMatchObject({
			scanRunRef: started.scanRunRef,
			replayed: true,
		});

		const replacementPreview = await localCliPreview(
			projectPath,
			{ mode: "preset", presetId: "standard" },
			{ kind: "full" },
		);
		await expect(
			localCliStartScan(
				projectPath,
				{
					previewRef: replacementPreview.previewRef,
					selection: { mode: "preset", presetId: "standard" },
					target: { kind: "full" },
					expectedTargetDigest: replacementPreview.target.digest,
				},
				"11111111-1111-4111-8111-111111111111",
			),
		).rejects.toMatchObject({ code: "SECURITY_SCAN_IDEMPOTENCY_CONFLICT" });
	});

	it("supports quick, deep, and custom CLI profiles with their valid targets", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const projectPath = path.join(tempRoot, "project");
		diagnosticMock.mockResolvedValue(diagnosticResult(projectPath));
		const quick = await localCliPreview(
			projectPath,
			{ mode: "preset", presetId: "quick" },
			{ kind: "working_tree" },
		);
		expect(quick).toMatchObject({
			resolvedProfileRef: "diff-source-baseline",
			target: { kind: "working_tree", fileCount: 2 },
		});
		expect(quick.toolSteps.map((step) => step.id)).toContain("semgrep");

		const deep = await localCliPreview(
			projectPath,
			{ mode: "preset", presetId: "deep" },
			{ kind: "full" },
		);
		expect(deep).toMatchObject({
			resolvedProfileRef: "detailed-security",
			target: { kind: "full" },
			estimatedDurationSeconds: { max: 1_200 },
		});

		const custom = await localCliPreview(
			projectPath,
			{ mode: "custom", profileRef: "dependency-manifest" },
			{ kind: "full" },
		);
		expect(custom.resolvedProfileRef).toBe("dependency-manifest");
		expect(custom.toolSteps.map((step) => step.id)).toEqual(["osv"]);
		const started = await localCliStartScan(
			projectPath,
			{
				previewRef: custom.previewRef,
				selection: { mode: "custom", profileRef: "dependency-manifest" },
				target: { kind: "full" },
				expectedTargetDigest: custom.target.digest,
			},
			"66666666-6666-4666-8666-666666666666",
		);
		expect((await waitForTerminal(started.scanRunRef)).status).toBe(
			"completed",
		);
		expect(diagnosticMock).toHaveBeenCalledWith(
			expect.objectContaining({
				profile: "dependency-manifest",
				scanTarget: "full",
			}),
		);
	});

	it("requires the exact preview before starting a new scan", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const projectPath = path.join(tempRoot, "project");
		await expect(
			localCliStartScan(
				projectPath,
				{
					previewRef: "22222222-2222-4222-8222-222222222222",
					selection: { mode: "preset", presetId: "standard" },
					target: { kind: "full" },
					expectedTargetDigest: "a".repeat(64),
				},
				"22222222-2222-4222-8222-222222222223",
			),
		).rejects.toMatchObject({ code: "SECURITY_SCAN_PREVIEW_EXPIRED" });
		expect(diagnosticMock).not.toHaveBeenCalled();
	});

	it("rejects a scan when the Project changes after preview", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const projectPath = path.join(tempRoot, "project");
		const preview = await localCliPreview(
			projectPath,
			{ mode: "preset", presetId: "standard" },
			{ kind: "full" },
		);
		await fs.writeFile(path.join(projectPath, "changed.ts"), "export {};\n");
		await expect(
			localCliStartScan(
				projectPath,
				{
					previewRef: preview.previewRef,
					selection: { mode: "preset", presetId: "standard" },
					target: { kind: "full" },
					expectedTargetDigest: preview.target.digest,
				},
				"22222222-2222-4222-8222-222222222224",
			),
		).rejects.toMatchObject({ code: "SECURITY_SCAN_TARGET_CHANGED" });
		expect(diagnosticMock).not.toHaveBeenCalled();
	});

	it("does not publish a completed result when the Project changes during a scan", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const projectPath = path.join(tempRoot, "project");
		diagnosticMock.mockImplementation(async () => {
			await fs.writeFile(
				path.join(projectPath, "changed-during-scan.ts"),
				"export {};\n",
			);
			return diagnosticResult(projectPath);
		});
		const started = await previewAndStart(
			projectPath,
			"22222222-2222-4222-8222-222222222227",
		);
		const detail = await waitForTerminal(started.scanRunRef);
		expect(detail).toMatchObject({
			status: "failed",
			error: {
				code: "LOCAL_CLI_SCAN_FAILED",
				retryable: true,
			},
		});
		expect(detail.error?.message).toContain(
			"スキャン実行中にProjectの内容が変わった",
		);
	});

	it("deduplicates concurrent starts with the same idempotency key", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const projectPath = path.join(tempRoot, "project");
		diagnosticMock.mockResolvedValue(diagnosticResult(projectPath));
		const preview = await localCliPreview(
			projectPath,
			{ mode: "preset", presetId: "standard" },
			{ kind: "full" },
		);
		const input = {
			previewRef: preview.previewRef,
			selection: { mode: "preset", presetId: "standard" } as const,
			target: { kind: "full" } as const,
			expectedTargetDigest: preview.target.digest,
		};
		const [first, replay] = await Promise.all([
			localCliStartScan(
				projectPath,
				input,
				"22222222-2222-4222-8222-222222222225",
			),
			localCliStartScan(
				projectPath,
				input,
				"22222222-2222-4222-8222-222222222225",
			),
		]);
		expect(replay).toMatchObject({
			scanRunRef: first.scanRunRef,
			replayed: true,
		});
		await waitForTerminal(first.scanRunRef);
		expect(diagnosticMock).toHaveBeenCalledTimes(1);
	});

	it("surfaces an LLM review failure even when scanner findings are actionable", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const projectPath = path.join(tempRoot, "project");
		diagnosticMock.mockResolvedValue({
			...diagnosticResult(projectPath),
			status: "security_action_required",
			findingCount: 1,
			highOrCriticalCount: 1,
			severityCounts: {
				critical: 0,
				high: 1,
				medium: 0,
				low: 0,
				info: 0,
				unknown: 0,
			},
			topFindings: [
				{
					id: "finding-review-gap",
					fingerprint: "fingerprint-review-gap",
					severity: "high",
					tool: "semgrep",
					ruleId: "rule-review-gap",
					title: "Actionable finding",
					location: { path: "src/app.ts", line: 1 },
					recommendation: "Fix it.",
				},
			],
			reviewStatus: "failed",
			error: "LLM provider is unavailable.",
		});
		const started = await previewAndStart(
			projectPath,
			"22222222-2222-4222-8222-222222222226",
		);
		const detail = await waitForTerminal(started.scanRunRef);
		expect(detail).toMatchObject({
			status: "completed",
			outcome: "findings_present",
			summary: {
				coverage: {
					gaps: [
						{
							code: "llm_review_unavailable",
							message: "LLM provider is unavailable.",
						},
					],
				},
			},
		});
		const reports = await localCliReports(started.scanRunRef);
		const report = reports.items[0];
		if (!report) throw new Error("report was not generated");
		const content = await localCliReportContent(
			started.scanRunRef,
			report.reportRef,
		);
		expect(content.content).toContain("Status: failed");
	});

	it("scopes idempotency keys to the registered Project path", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const firstPath = path.join(tempRoot, "project");
		const secondPath = path.join(tempRoot, "second-project");
		await fs.mkdir(secondPath);
		await fs.writeFile(
			path.join(secondPath, "package.json"),
			'{"name":"two"}\n',
		);
		diagnosticMock.mockImplementation(
			async (input: { target: { repoRoot: string } }) =>
				diagnosticResult(input.target.repoRoot),
		);
		const key = "33333333-3333-4333-8333-333333333333";
		const first = await previewAndStart(firstPath, key);
		await waitForTerminal(first.scanRunRef);
		const second = await previewAndStart(secondPath, key);
		await waitForTerminal(second.scanRunRef);
		expect(second.scanRunRef).not.toBe(first.scanRunRef);
	});

	it("enforces one active local scan and preserves cancellation", async () => {
		if (!tempRoot) throw new Error("temp root was not created");
		const firstPath = path.join(tempRoot, "project");
		const secondPath = path.join(tempRoot, "second-project");
		await fs.mkdir(secondPath);
		await fs.writeFile(
			path.join(secondPath, "package.json"),
			'{"name":"two"}\n',
		);
		diagnosticMock.mockImplementation(
			(input: { target: { repoRoot: string }; signal?: AbortSignal }) =>
				new Promise((resolve) => {
					input.signal?.addEventListener(
						"abort",
						() => resolve(diagnosticResult(input.target.repoRoot)),
						{ once: true },
					);
				}),
		);
		const first = await previewAndStart(
			firstPath,
			"44444444-4444-4444-8444-444444444444",
		);
		await waitForDiagnosticCall();
		const secondPreview = await localCliPreview(
			secondPath,
			{ mode: "preset", presetId: "standard" },
			{ kind: "full" },
		);
		await expect(
			localCliStartScan(
				secondPath,
				{
					previewRef: secondPreview.previewRef,
					selection: { mode: "preset", presetId: "standard" },
					target: { kind: "full" },
					expectedTargetDigest: secondPreview.target.digest,
				},
				"55555555-5555-4555-8555-555555555555",
			),
		).rejects.toMatchObject({ code: "SECURITY_SCAN_LOCAL_CLI_BUSY" });

		const cancelled = await localCliCancel(first.scanRunRef);
		expect(cancelled.status).toBe("cancelled");
		expect((await waitForTerminal(first.scanRunRef)).status).toBe("cancelled");
	});
});

async function previewAndStart(projectPath: string, idempotencyKey: string) {
	const preview = await localCliPreview(
		projectPath,
		{ mode: "preset", presetId: "standard" },
		{ kind: "full" },
	);
	return await localCliStartScan(
		projectPath,
		{
			previewRef: preview.previewRef,
			selection: { mode: "preset", presetId: "standard" },
			target: { kind: "full" },
			expectedTargetDigest: preview.target.digest,
		},
		idempotencyKey,
	);
}

function diagnosticResult(projectPath: string) {
	return {
		ok: true,
		status: "completed",
		projectId: "vw-project",
		projectPath,
		scanRunId: "vw-scan",
		profile: "agent-output",
		topFindings: [],
		findingsTruncated: false,
		blockingFingerprints: [],
		commandsRun: [],
		findingCount: 0,
		highOrCriticalCount: 0,
		severityCounts: {
			critical: 0,
			high: 0,
			medium: 0,
			low: 0,
			info: 0,
			unknown: 0,
		},
		coverage: { completed: 3, skipped: 0, failed: 0, gaps: [] },
		reviewStatus: "completed",
		improvementRequest: null,
		error: null,
	};
}

async function waitForDiagnosticCall() {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (diagnosticMock.mock.calls.length > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("local CLI diagnostic did not start");
}

async function waitForTerminal(scanRunRef: string) {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const detail = await localCliScanDetail(scanRunRef);
		if (!["queued", "running"].includes(detail.status)) return detail;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("local CLI scan did not complete");
}

function capabilitiesFixture() {
	const target = (
		kind: "full" | "working_tree",
		profileRef: string,
		max: number,
	) => ({
		kind,
		profileRef,
		estimatedDurationSeconds: { min: Math.floor(max / 6), max },
		toolCategories: ["static"],
		warnings: [],
	});
	return {
		provider: { id: "vulnworkbench", version: "cli-2" },
		project: { ref: "local-project", displayName: "project" },
		presets: [
			{
				id: "quick",
				displayName: "クイック",
				description: "短時間の基本検査",
				recommended: false,
				targets: [
					target("working_tree", "diff-source-baseline", 600),
					target("full", "source-baseline", 600),
				],
			},
			{
				id: "standard",
				displayName: "標準",
				description: "日常利用向け検査",
				recommended: true,
				targets: [
					target("working_tree", "diff-basic-security", 900),
					target("full", "basic-security", 900),
				],
			},
			{
				id: "deep",
				displayName: "詳細",
				description: "詳細検査",
				recommended: false,
				targets: [target("full", "detailed-security", 1_200)],
			},
		],
		selectableProfiles: [
			{
				ref: "basic-security",
				name: "基本セキュリティスキャン",
				description: "基本検査",
				supportedTargets: ["full"],
				requirements: [],
				warnings: [],
			},
			{
				ref: "dependency-manifest",
				name: "依存マニフェストスキャン",
				description: "依存関係検査",
				supportedTargets: ["full"],
				requirements: [],
				warnings: [],
			},
		],
		limits: {
			maxConcurrentScansForClient: 1,
			maxFindingPageSize: 100,
			maxEventPageSize: 1,
			maxReportBytes: 5 * 1024 * 1024,
		},
	};
}

function profilePlan(profileId: string) {
	const tools =
		profileId === "dependency-manifest"
			? [["osv", "OSV Dependency Scanner"]]
			: [
					["semgrep", "Semgrep Static Analysis"],
					["gitleaks", "Gitleaks Secret Detection"],
					["osv", "OSV Dependency Scanner"],
					["trivy", "Trivy Filesystem Scanner"],
				];
	return {
		dryRun: true,
		profileId,
		resolvedSteps: tools.map(([id, displayName]) => ({
			kind: "static_tool",
			id,
			displayName,
			required: true,
			timeoutSec: profileId === "detailed-security" ? 1_200 : 900,
		})),
	};
}
