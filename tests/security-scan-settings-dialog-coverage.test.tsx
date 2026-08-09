import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let setters: Array<ReturnType<typeof vi.fn>> = [];
let pendingEffects: Array<() => void | (() => void)> = [];

function mockReact(
	values: unknown[],
	effectMode: "skip" | "run" | "defer" = "skip",
) {
	const queue = [...values];
	setters = [];
	pendingEffects = [];
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useEffect: (callback: () => void | (() => void)) => {
				if (effectMode === "defer") pendingEffects.push(callback);
				else if (effectMode === "run") callback();
			},
			useState: <T,>(initial: T | (() => T)) => {
				const value = queue.length
					? (queue.shift() as T)
					: typeof initial === "function"
						? (initial as () => T)()
						: initial;
				const setter = vi.fn((next: T | ((current: T) => T)) =>
					typeof next === "function"
						? (next as (current: T) => T)(value)
						: next,
				);
				setters.push(setter);
				return [value, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({
			t: (key: string, values?: Record<string, unknown>) =>
				values ? `${key}:${JSON.stringify(values)}` : key,
		}),
	}));
}

function jsonResponse(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), { status });
}

function visit(node: ReactNode, callback: (element: ReactElement) => void) {
	if (Array.isArray(node)) {
		for (const child of node) visit(child, callback);
		return;
	}
	if (!node || typeof node !== "object" || !("props" in node)) return;
	const element = node as ReactElement<{ children?: ReactNode }>;
	callback(element);
	visit(element.props.children, callback);
}

async function flush() {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

const project = {
	id: "repo-1",
	name: "Project",
	localPath: "/repo",
	branch: "main",
	allowed: true,
	queueEnabled: true,
	maxConcurrentSessions: 1,
	createdAt: "2026-01-01",
	updatedAt: "2026-01-01",
};
const settings = {
	enabled: true,
	transport: "http",
	baseUrl: "http://127.0.0.1:29831",
	tokenConfigured: true,
	localCliConfigured: false,
};
const capabilities = {
	provider: { version: "1.2.3" },
	project: { displayName: "Project" },
};

function mockSettingsCommands(overrides: Record<string, unknown> = {}) {
	const commands = {
		fetchSecurityScanProviderSettings: vi.fn(async () =>
			jsonResponse(settings),
		),
		saveSecurityScanProviderSettings: vi.fn(async () => jsonResponse(settings)),
		fetchSecurityScanCapabilities: vi.fn(async () =>
			jsonResponse(capabilities),
		),
		...overrides,
	};
	vi.doMock("../src/modules/securityScan/securityScanCommands", () => commands);
	return commands;
}

function settingsState(overrides: Record<number, unknown> = {}) {
	const state: unknown[] = [
		false,
		"local_cli",
		"http://127.0.0.1:29831",
		"",
		false,
		false,
		false,
		false,
		false,
		"",
		"success",
	];
	for (const [index, value] of Object.entries(overrides))
		state[Number(index)] = value;
	return state;
}

describe("vulnerability scan provider settings coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("renders local, HTTP, configured, loading, and message variants", async () => {
		mockReact(
			settingsState({
				0: true,
				1: "http",
				3: " token ",
				4: true,
				9: "saved",
				10: "success",
			}),
		);
		mockSettingsCommands();
		let module = await import(
			"../src/modules/securityScan/SettingsVulnerabilityScanProviderPanel"
		);
		let html = renderToStaticMarkup(
			module.SettingsVulnerabilityScanProviderPanel({
				activeProject: project as never,
			}),
		);
		expect(html).toContain("settings.vulnerabilityScanProvider.configured");
		expect(html).toContain("settings.vulnerabilityScanProvider.tokenStored");
		expect(html).toContain("integration:client create");
		expect(html).toContain("saved");

		mockReact(
			settingsState({
				1: "local_cli",
				5: true,
				6: true,
				7: true,
				8: true,
				9: "failed",
				10: "error",
			}),
		);
		mockSettingsCommands();
		module = await import(
			"../src/modules/securityScan/SettingsVulnerabilityScanProviderPanel"
		);
		html = renderToStaticMarkup(
			module.SettingsVulnerabilityScanProviderPanel({ activeProject: null }),
		);
		expect(html).toContain("settings.vulnerabilityScanProvider.localCliHelp");
		expect(html).toContain(
			"settings.vulnerabilityScanProvider.testNeedsProject",
		);
		expect(html).toContain("failed");
	});

	it("updates form controls and saves trimmed HTTP credentials", async () => {
		mockReact(
			settingsState({
				0: true,
				1: "http",
				2: "http://old",
				3: "  secret  ",
				4: true,
			}),
		);
		const commands = mockSettingsCommands();
		const module = await import(
			"../src/modules/securityScan/SettingsVulnerabilityScanProviderPanel"
		);
		const element = module.SettingsVulnerabilityScanProviderPanel({
			activeProject: project as never,
		}) as ReactElement;
		const promises: Promise<unknown>[] = [];
		visit(element, (child) => {
			const props = child.props as Record<string, unknown>;
			if (
				typeof child.type === "string" &&
				typeof props.onChange === "function"
			) {
				(props.onChange as (event: unknown) => void)({
					target: { checked: false, value: "http://new" },
				});
			}
			if (typeof props.onClick === "function") {
				const value = (props.onClick as () => unknown)();
				if (value instanceof Promise) promises.push(value);
			}
		});
		await Promise.allSettled(promises);
		await flush();
		expect(setters[0]).toHaveBeenCalledWith(false);
		expect(setters[1]).toHaveBeenCalledWith("http://new");
		expect(setters[2]).toHaveBeenCalledWith("http://new");
		expect(setters[3]).toHaveBeenCalledWith("http://new");
		expect(commands.saveSecurityScanProviderSettings).toHaveBeenCalledWith({
			enabled: true,
			transport: "http",
			baseUrl: "http://old",
			token: "secret",
		});
		expect(commands.fetchSecurityScanCapabilities).toHaveBeenCalledWith(
			"repo-1",
		);
		expect(setters[9]).toHaveBeenCalledWith(
			expect.stringContaining("testSucceeded"),
		);
	});

	it("omits empty tokens, guards tests without a project, and exposes failures", async () => {
		mockReact(settingsState({ 0: true, 1: "http", 3: "" }));
		let commands = mockSettingsCommands({
			saveSecurityScanProviderSettings: vi.fn(async () =>
				jsonResponse({ error: { message: "save denied" } }, 403),
			),
			fetchSecurityScanCapabilities: vi.fn(async () => {
				throw "test offline";
			}),
		});
		let module = await import(
			"../src/modules/securityScan/SettingsVulnerabilityScanProviderPanel"
		);
		let element = module.SettingsVulnerabilityScanProviderPanel({
			activeProject: project as never,
		}) as ReactElement;
		const actions: Array<() => unknown> = [];
		visit(element, (child) => {
			const onClick = (child.props as Record<string, unknown>).onClick;
			if (typeof onClick === "function") actions.push(onClick as () => unknown);
		});
		for (const action of actions) await action();
		await flush();
		expect(commands.saveSecurityScanProviderSettings).toHaveBeenCalledWith({
			enabled: true,
			transport: "http",
			baseUrl: "http://127.0.0.1:29831",
		});
		expect(setters[9]).toHaveBeenCalledWith("save denied");
		expect(setters[9]).toHaveBeenCalledWith("test offline");

		mockReact(settingsState({ 0: true, 1: "local_cli", 5: true }));
		commands = mockSettingsCommands();
		module = await import(
			"../src/modules/securityScan/SettingsVulnerabilityScanProviderPanel"
		);
		element = module.SettingsVulnerabilityScanProviderPanel({
			activeProject: null,
		}) as ReactElement;
		visit(element, (child) => {
			const onClick = (child.props as Record<string, unknown>).onClick;
			if (typeof onClick === "function") void (onClick as () => unknown)();
		});
		await flush();
		expect(commands.fetchSecurityScanCapabilities).not.toHaveBeenCalled();
	});

	it("loads settings, reports load errors, and ignores cancelled effects", async () => {
		mockReact(settingsState({ 6: true }), "run");
		let commands = mockSettingsCommands();
		let module = await import(
			"../src/modules/securityScan/SettingsVulnerabilityScanProviderPanel"
		);
		module.SettingsVulnerabilityScanProviderPanel({
			activeProject: project as never,
		});
		await flush();
		expect(commands.fetchSecurityScanProviderSettings).toHaveBeenCalled();
		expect(setters[0]).toHaveBeenCalledWith(true);
		expect(setters[6]).toHaveBeenCalledWith(false);

		mockReact(settingsState({ 6: true }), "run");
		commands = mockSettingsCommands({
			fetchSecurityScanProviderSettings: vi.fn(
				async () => new Response("bad", { status: 500 }),
			),
		});
		module = await import(
			"../src/modules/securityScan/SettingsVulnerabilityScanProviderPanel"
		);
		module.SettingsVulnerabilityScanProviderPanel({
			activeProject: project as never,
		});
		await flush();
		expect(setters[9]).toHaveBeenCalledWith("Request failed (500)");

		mockReact(settingsState({ 6: true }), "defer");
		commands = mockSettingsCommands();
		module = await import(
			"../src/modules/securityScan/SettingsVulnerabilityScanProviderPanel"
		);
		module.SettingsVulnerabilityScanProviderPanel({
			activeProject: project as never,
		});
		const cleanup = pendingEffects[0]();
		if (typeof cleanup === "function") cleanup();
		await flush();
		expect(setters[0]).not.toHaveBeenCalledWith(true);
	});
});

const candidate = {
	id: "11111111-1111-4111-8111-111111111111",
	title: "Fix injection",
	summary: "Validate all input",
	taskPrompt: "Implement validation",
	rationale: "Untrusted input reaches a sink",
	acceptanceCriteria: "Malicious input is rejected",
	verificationPlan: "Run focused tests",
	planModeOpenQuestions: ["Which validation library?"],
	source: {
		kind: "security_scan",
		findings: [{ ref: "finding-1", severity: "high", title: "Injection" }],
	},
};

function dialogResult(overrides: Record<string, unknown> = {}) {
	return {
		batchId: null,
		status: "completed",
		candidates: [
			candidate,
			{
				...candidate,
				id: "22222222-2222-4222-8222-222222222222",
				title: "Investigate",
				planModeOpenQuestions: [],
				source: { kind: "mission" },
			},
		],
		duplicates: [
			{ findingRef: "duplicate-1", candidateId: candidate.id, taskId: null },
			{
				findingRef: "duplicate-2",
				candidateId: candidate.id,
				taskId: "33333333-3333-4333-8333-333333333333",
			},
		],
		needsHuman: [
			{ findingRef: "finding-human", reason: "Needs owner decision" },
		],
		coverageWarnings: ["One finding was skipped"],
		...overrides,
	};
}

describe("security task candidate dialog coverage", () => {
	it("renders rich candidate results and drives selection callbacks", async () => {
		mockReact([[candidate.id]], "run");
		let modalOptions: { onClose: () => void } | null = null;
		vi.doMock("../src/hooks/useModalFocus", () => ({
			useModalFocus: (options: { onClose: () => void }) => {
				modalOptions = options;
				return { current: null };
			},
		}));
		const module = await import(
			"../src/modules/securityScan/SecurityTaskCandidateDialog"
		);
		const onClose = vi.fn();
		const onCreateTasks = vi.fn();
		const element = module.SecurityTaskCandidateDialog({
			result: dialogResult() as never,
			busy: false,
			onClose,
			onCreateTasks,
		}) as ReactElement;
		const html = renderToStaticMarkup(element);
		expect(html).toContain("One finding was skipped");
		expect(html).toContain("duplicate-1");
		expect(html).toContain("33333333-3333-4333-8333-333333333333");
		expect(html).toContain("Which validation library?");
		expect(html).toContain("finding-human");
		visit(element, (child) => {
			const props = child.props as Record<string, unknown>;
			if (typeof props.onChange === "function")
				(props.onChange as () => void)();
			if (typeof props.onClick === "function") (props.onClick as () => void)();
		});
		modalOptions?.onClose();
		expect(
			setters[0].mock.results.some(
				(result) =>
					Array.isArray(result.value) && result.value.includes(candidate.id),
			),
		).toBe(true);
		expect(onCreateTasks).toHaveBeenCalledWith([candidate.id]);
		expect(onClose).toHaveBeenCalled();
	});

	it("renders empty results and prevents modal close while busy", () => {
		mockReact([[]]);
		let modalOptions: { onClose: () => void } | null = null;
		vi.doMock("../src/hooks/useModalFocus", () => ({
			useModalFocus: (options: { onClose: () => void }) => {
				modalOptions = options;
				return { current: null };
			},
		}));
		return import(
			"../src/modules/securityScan/SecurityTaskCandidateDialog"
		).then((module) => {
			const onClose = vi.fn();
			const html = renderToStaticMarkup(
				module.SecurityTaskCandidateDialog({
					result: dialogResult({
						candidates: [],
						duplicates: [],
						needsHuman: [],
						coverageWarnings: [],
					}) as never,
					busy: true,
					onClose,
					onCreateTasks: vi.fn(),
				}),
			);
			expect(html).toContain("securityScan.noNewTaskCandidates");
			modalOptions?.onClose();
			expect(onClose).not.toHaveBeenCalled();
		});
	});
});
