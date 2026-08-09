import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	scanController: null as null | Record<string, unknown>,
	taskController: null as null | Record<string, unknown>,
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) =>
			values ? `${key}:${JSON.stringify(values)}` : key,
	}),
}));
vi.mock("../src/modules/securityScan/useSecurityScanController", () => ({
	useSecurityScanController: () => hooks.scanController,
}));
vi.mock(
	"../src/modules/securityScan/useSecurityTaskCandidateController",
	() => ({
		useSecurityTaskCandidateController: () => hooks.taskController,
	}),
);

import { ProjectSecurityScanScreen } from "../src/modules/securityScan/ProjectSecurityScanScreen";
import { SecurityScanFindingsSection } from "../src/modules/securityScan/SecurityScanFindingsSection";
import { SecurityScanProfileSelector } from "../src/modules/securityScan/SecurityScanProfileSelector";

const selection = { mode: "preset" as const, presetId: "standard" as const };
const target = { kind: "working_tree" as const };
const customProfile = {
	ref: "custom-profile",
	name: "Custom profile",
	description: "Custom profile details",
	supportedTargets: ["full" as const],
	requirements: ["Docker"],
	warnings: ["Slow scan"],
};
const capabilities = {
	provider: { id: "vulnworkbench", version: "1.2.3" },
	project: { ref: "project-1", displayName: "Project" },
	presets: [
		{
			id: "standard",
			displayName: "Standard",
			description: "Standard scan",
			recommended: true,
			targets: [
				{
					kind: "working_tree",
					profileRef: "standard",
					estimatedDurationSeconds: { min: 2, max: 4 },
					toolCategories: [],
					warnings: [],
				},
				{
					kind: "full",
					profileRef: "standard-full",
					estimatedDurationSeconds: { min: 5, max: 9 },
					toolCategories: [],
					warnings: [],
				},
			],
		},
		{
			id: "deep",
			displayName: "Deep",
			description: "Deep scan",
			recommended: false,
			targets: [
				{
					kind: "full",
					profileRef: "deep",
					estimatedDurationSeconds: { min: 10, max: 20 },
					toolCategories: [],
					warnings: [],
				},
			],
		},
	],
	selectableProfiles: [customProfile],
	limits: {
		maxConcurrentScansForClient: 1,
		maxFindingPageSize: 100,
		maxEventPageSize: 100,
		maxReportBytes: 1_000,
	},
};
const finding = {
	ref: "finding-1",
	severity: "high",
	title: "Unsafe input",
	description: "Input reaches a sink",
	recommendation: "Validate input",
	tool: "semgrep",
	location: { path: "src/input.ts", startLine: 12 },
};

function baseScanController(overrides: Record<string, unknown> = {}) {
	return {
		providerSettings: null,
		capabilities: null,
		history: [],
		selection,
		target,
		preview: null,
		activeScan: null,
		findings: [],
		reports: [],
		selectedPreset: null,
		action: null,
		error: "",
		loadCapabilities: vi.fn(async () => undefined),
		updateSelection: vi.fn(),
		updateTarget: vi.fn(),
		createPreview: vi.fn(async () => undefined),
		runScan: vi.fn(async () => undefined),
		selectScan: vi.fn(async () => undefined),
		cancelScan: vi.fn(async () => undefined),
		createReport: vi.fn(async () => null),
		...overrides,
	};
}

function baseTaskController(overrides: Record<string, unknown> = {}) {
	return {
		selectedFindingRefs: [],
		result: null,
		action: null,
		error: "",
		selectAll: vi.fn(),
		clearSelection: vi.fn(),
		toggleFinding: vi.fn(),
		requestCandidates: vi.fn(async () => undefined),
		createDraftTasks: vi.fn(async () => undefined),
		closeDialog: vi.fn(),
		...overrides,
	};
}

function visitElements(
	node: ReactNode,
	callback: (element: ReactElement) => void,
) {
	if (Array.isArray(node)) {
		for (const child of node) visitElements(child, callback);
		return;
	}
	if (!node || typeof node !== "object" || !("props" in node)) return;
	const element = node as ReactElement<{ children?: ReactNode }>;
	callback(element);
	visitElements(element.props.children, callback);
}

async function invokeScreenCallbacks(element: ReactElement) {
	const pending: Promise<unknown>[] = [];
	visitElements(element, (child) => {
		const props = child.props as Record<string, unknown>;
		if (typeof props.onClick === "function") {
			const value = (props.onClick as () => unknown)();
			if (value instanceof Promise) pending.push(value);
		}
		if (
			typeof child.type === "string" &&
			typeof props.onChange === "function"
		) {
			const value = (props.onChange as (event: unknown) => unknown)({
				target: { value: "full", checked: true },
			});
			if (value instanceof Promise) pending.push(value);
		}
		if (
			typeof child.type === "function" &&
			child.type.name === "SecurityScanProfileSelector" &&
			typeof props.onSelect === "function"
		) {
			(props.onSelect as (profile: typeof customProfile) => void)(
				customProfile,
			);
		}
		if (
			typeof child.type === "function" &&
			child.type.name === "SecurityTaskCandidateDialog" &&
			typeof props.onCreateTasks === "function"
		) {
			(props.onCreateTasks as (ids: string[]) => void)(["candidate-1"]);
			if (typeof props.onClose === "function") (props.onClose as () => void)();
		}
		if (
			typeof child.type === "function" &&
			child.type.name === "SecurityScanFindingsSection"
		) {
			if (typeof props.onSelectAll === "function")
				(props.onSelectAll as () => void)();
			if (typeof props.onClearSelection === "function")
				(props.onClearSelection as () => void)();
			if (typeof props.onToggleFinding === "function")
				(props.onToggleFinding as (ref: string) => void)("finding-1");
			if (typeof props.onGenerate === "function")
				(props.onGenerate as () => void)();
		}
	});
	await Promise.allSettled(pending);
	await Promise.resolve();
}

describe("project security scan screen coverage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hooks.scanController = baseScanController();
		hooks.taskController = baseTaskController();
	});

	it("renders unconfigured, disconnected, empty, and error states", () => {
		hooks.scanController = baseScanController({
			action: "initial",
			error: "provider unavailable",
		});
		hooks.taskController = baseTaskController({
			error: "task generation unavailable",
		});
		const html = renderToStaticMarkup(
			<ProjectSecurityScanScreen repositoryId="repo-1" />,
		);
		expect(html).toContain("securityScan.notConnected");
		expect(html).toContain("securityScan.configurationRequired");
		expect(html).toContain("provider unavailable");
		expect(html).toContain("task generation unavailable");
		expect(html).toContain("securityScan.historyEmpty");
	});

	it("renders preset, preview, running progress, findings, and history variants", async () => {
		const scan = baseScanController({
			providerSettings: {
				enabled: true,
				transport: "local_cli",
				localCliConfigured: true,
				tokenConfigured: false,
			},
			capabilities,
			selectedPreset: capabilities.presets[0],
			preview: {
				previewRef: "preview-1",
				target: { digest: "abcdef1234567890", fileCount: 4 },
				estimatedDurationSeconds: { min: 2, max: 5 },
				toolSteps: [
					{
						id: "available",
						name: "Semgrep",
						category: "sast",
						availability: "available",
					},
					{
						id: "missing",
						name: "Trivy",
						category: "sca",
						availability: "unavailable",
						reason: "not installed",
					},
				],
				warnings: ["working tree is dirty"],
			},
			activeScan: {
				scanRunRef: "scan-running",
				status: "running",
				progress: { currentStep: null, completedSteps: 1, totalSteps: 4 },
				summary: {
					findingCount: 3,
					severityCounts: {
						critical: 1,
						high: 1,
						medium: 1,
						low: 0,
						info: 0,
						unknown: 0,
					},
				},
				error: { message: "one tool failed" },
			},
			findings: [finding],
			history: [
				{
					scanRunRef: "scan-running",
					selection,
					target,
					createdAt: "invalid-date",
				},
				{
					scanRunRef: "scan-custom",
					selection: { mode: "custom", profileRef: "custom-profile" },
					target: { kind: "full" },
					createdAt: "2026-08-08T00:00:00Z",
				},
			],
		});
		const tasks = baseTaskController({ selectedFindingRefs: ["finding-1"] });
		hooks.scanController = scan;
		hooks.taskController = tasks;
		const element = ProjectSecurityScanScreen({
			repositoryId: "repo-1",
		}) as ReactElement;
		const html = renderToStaticMarkup(element);
		expect(html).toContain("Standard scan");
		expect(html).toContain("working tree is dirty");
		expect(html).toContain("one tool failed");
		expect(html).toContain("Unsafe input");
		expect(html).toContain("scan-custom");

		await invokeScreenCallbacks(element);
		expect(scan.loadCapabilities).toHaveBeenCalled();
		expect(scan.createPreview).toHaveBeenCalled();
		expect(scan.runScan).toHaveBeenCalled();
		expect(scan.cancelScan).toHaveBeenCalled();
		expect(scan.selectScan).toHaveBeenCalledWith("scan-custom");
		expect(scan.updateSelection).toHaveBeenCalledWith({
			mode: "custom",
			profileRef: "custom-profile",
		});
		expect(scan.updateTarget).toHaveBeenCalled();
		expect(tasks.toggleFinding).toHaveBeenCalledWith("finding-1");
		expect(tasks.requestCandidates).toHaveBeenCalled();
	});

	it("renders custom HTTP configuration, candidate dialog, completed reports, and download states", async () => {
		const completedReport = {
			reportRef: "report-complete",
			scanRunRef: "scan-complete",
			status: "completed",
			title: null,
			createdAt: "bad-date",
		};
		const scan = baseScanController({
			providerSettings: {
				enabled: true,
				transport: "http",
				localCliConfigured: false,
				tokenConfigured: true,
			},
			capabilities,
			selection: { mode: "custom", profileRef: "custom-profile" },
			target: { kind: "full" },
			activeScan: {
				scanRunRef: "scan-complete",
				status: "completed",
				progress: { currentStep: "done", completedSteps: 0, totalSteps: 0 },
				summary: null,
				error: null,
			},
			reports: [
				completedReport,
				{
					...completedReport,
					reportRef: "queued",
					status: "queued",
					title: "Queued",
				},
				{
					...completedReport,
					reportRef: "running",
					status: "running",
					title: "Running",
				},
				{
					...completedReport,
					reportRef: "failed",
					status: "failed",
					title: "Failed",
				},
			],
			createReport: vi.fn(async () => ({
				...completedReport,
				title: "New report",
			})),
		});
		const result = {
			batchId: null,
			status: "completed",
			candidates: [],
			duplicates: [],
			needsHuman: [],
			coverageWarnings: [],
		};
		const tasks = baseTaskController({ result, action: "create" });
		hooks.scanController = scan;
		hooks.taskController = tasks;
		const assign = vi.fn();
		vi.stubGlobal("window", { location: { assign } });
		const element = ProjectSecurityScanScreen({
			repositoryId: "repo-1",
		}) as ReactElement;
		const html = renderToStaticMarkup(element);
		expect(html).toContain("Custom profile details");
		expect(html).toContain("securityScan.reportPendingTitle");
		expect(html).toContain("securityScan.noNewTaskCandidates");
		expect(html).toContain("Queued");
		expect(html).toContain("Failed");
		await invokeScreenCallbacks(element);
		expect(scan.createReport).toHaveBeenCalled();
		expect(tasks.createDraftTasks).toHaveBeenCalledWith(["candidate-1"]);
		expect(tasks.closeDialog).toHaveBeenCalled();
		expect(assign).toHaveBeenCalledWith(
			expect.stringContaining("report-complete"),
		);
		vi.unstubAllGlobals();
	});

	it("does not navigate when report creation stays pending", async () => {
		const scan = baseScanController({
			providerSettings: {
				enabled: true,
				transport: "local_cli",
				localCliConfigured: true,
				tokenConfigured: false,
			},
			capabilities,
			selectedPreset: capabilities.presets[0],
			activeScan: {
				scanRunRef: "scan",
				status: "completed",
				progress: null,
				summary: null,
				error: null,
			},
			createReport: vi.fn(async () => ({ status: "queued" })),
		});
		hooks.scanController = scan;
		const assign = vi.fn();
		vi.stubGlobal("window", { location: { assign } });
		await invokeScreenCallbacks(
			ProjectSecurityScanScreen({ repositoryId: "repo-1" }) as ReactElement,
		);
		expect(scan.createReport).toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});
});

describe("security scan leaf components coverage", () => {
	it("renders and selects detailed custom profiles", () => {
		const onSelect = vi.fn();
		const html = renderToStaticMarkup(
			<SecurityScanProfileSelector
				profiles={[customProfile]}
				selectedProfileRef="custom-profile"
				onSelect={onSelect}
			/>,
		);
		expect(html).toContain("Custom profile details");
		expect(html).toContain("Docker");
		expect(html).toContain("Slow scan");
		const element = SecurityScanProfileSelector({
			profiles: [customProfile],
			selectedProfileRef: null,
			onSelect,
		}) as ReactElement;
		visitElements(element, (child) => {
			if (child.type !== "select") return;
			const onChange = (child.props as { onChange: (event: unknown) => void })
				.onChange;
			onChange({ target: { value: "missing" } });
			onChange({ target: { value: "custom-profile" } });
		});
		expect(onSelect).toHaveBeenCalledWith(customProfile);
	});

	it("renders all finding details, partial loading, and callback paths", async () => {
		const callbacks = {
			onSelectAll: vi.fn(),
			onClearSelection: vi.fn(),
			onToggleFinding: vi.fn(),
			onGenerate: vi.fn(),
		};
		const activeScan = {
			scanRunRef: "scan",
			status: "completed",
			summary: { findingCount: 4, severityCounts: {} },
		};
		const element = SecurityScanFindingsSection({
			findings: [
				finding,
				{
					...finding,
					ref: "finding-2",
					severity: "unknown",
					description: null,
					recommendation: null,
					location: { path: null, startLine: null },
				},
			],
			activeScan: activeScan as never,
			selectedFindingRefs: ["finding-1"],
			generating: false,
			...callbacks,
		}) as ReactElement;
		const html = renderToStaticMarkup(element);
		expect(html).toContain("findingsPartiallyLoaded");
		expect(html).toContain("Validate input");
		expect(html).toContain("—");
		await invokeScreenCallbacks(element);
		expect(callbacks.onSelectAll).toHaveBeenCalled();
		expect(callbacks.onClearSelection).toHaveBeenCalled();
		expect(callbacks.onToggleFinding).toHaveBeenCalledWith("finding-2");
		expect(callbacks.onGenerate).toHaveBeenCalled();
		expect(
			SecurityScanFindingsSection({
				findings: [],
				activeScan: null,
				selectedFindingRefs: [],
				generating: true,
				...callbacks,
			}),
		).toBeNull();
	});
});
