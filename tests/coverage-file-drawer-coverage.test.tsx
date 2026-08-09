import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

type Effect = () => undefined | (() => void);

const row = {
	key: "/repo/src/example.ts",
	file: "src/example.ts",
	statements: 80,
	branches: 70,
	functions: 90,
	lines: 82,
	uncovered: "12",
};

const source = {
	path: "src/example.ts",
	content: "export const answer = 42;",
	size: 25,
	truncated: false,
};

const availableReport = {
	available: true as const,
	html: "<html><body>covered</body></html>",
	reason: null,
	generatedAt: "2026-08-09T00:00:00.000Z",
};

function drawerState(overrides: Record<number, unknown> = {}) {
	const values: unknown[] = ["source", null, null, "", "", true, false];
	for (const [index, value] of Object.entries(overrides))
		values[Number(index)] = value;
	return values;
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement(node)) return [];
	const element = node as ReactElement<Record<string, unknown>>;
	return [element, ...elements(element.props.children as ReactNode)];
}

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

async function loadDrawer(
	states = drawerState(),
	commands: {
		fetchRepositoryFile?: ReturnType<typeof vi.fn>;
		fetchCoverageFileReport?: ReturnType<typeof vi.fn>;
	} = {},
) {
	const queued = [...states];
	const setters: Array<ReturnType<typeof vi.fn>> = [];
	const effects: Effect[] = [];
	const closeFocus = vi.fn();
	const drawerRef: {
		current: null | {
			querySelectorAll: ReturnType<typeof vi.fn>;
		};
	} = { current: null };
	const refs: unknown[] = [{ current: { focus: closeFocus } }, drawerRef];
	const fetchRepositoryFile =
		commands.fetchRepositoryFile ?? vi.fn(async () => response(source));
	const fetchCoverageFileReport =
		commands.fetchCoverageFileReport ??
		vi.fn(async () => response(availableReport));

	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useEffect: (callback: Effect) => effects.push(callback),
			useRef: () => refs.shift() ?? { current: null },
			useState: <T,>(initial: T | (() => T)) => {
				const value = queued.length
					? (queued.shift() as T)
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
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	vi.doMock("@/components/ui/Button", () => ({
		Button: ({ children, ...props }: { children?: ReactNode }) => (
			<button {...props}>{children}</button>
		),
	}));
	vi.doMock(
		"../src/modules/nightworkers/components/ArtifactFileViewers",
		() => ({
			FileViewer: ({ file }: { file: { path: string; content: string } }) => (
				<div data-file={file.path}>{file.content}</div>
			),
		}),
	);
	vi.doMock("../src/modules/nightworkers/nightWorkersCommands", () => ({
		fetchRepositoryFile,
	}));
	vi.doMock("../src/modules/quality/api/qualityCommands", () => ({
		fetchCoverageFileReport,
	}));

	const { CoverageFileDrawer } = await import(
		"../src/modules/quality/components/CoverageFileDrawer"
	);
	return {
		CoverageFileDrawer,
		closeFocus,
		drawerRef,
		effects,
		fetchCoverageFileReport,
		fetchRepositoryFile,
		setters,
	};
}

function renderDrawer(
	CoverageFileDrawer: Awaited<
		ReturnType<typeof loadDrawer>
	>["CoverageFileDrawer"],
	onClose = vi.fn(),
) {
	const tree = CoverageFileDrawer({
		repositoryId: "repository-1",
		runId: "run-1",
		row,
		onClose,
	});
	return { markup: renderToStaticMarkup(tree), onClose, tree };
}

async function settle() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("CoverageFileDrawer coverage", () => {
	it("renders loading, source, source error, and all report states", async () => {
		const loading = await loadDrawer();
		expect(renderDrawer(loading.CoverageFileDrawer).markup).toContain(
			"projectDetail.quality.coverageViewerLoading",
		);

		const loaded = await loadDrawer(drawerState({ 1: source, 5: false }));
		const loadedMarkup = renderDrawer(loaded.CoverageFileDrawer).markup;
		expect(loadedMarkup).toContain("export const answer = 42;");
		expect(loadedMarkup).toContain('data-file="src/example.ts"');

		const sourceFailed = await loadDrawer(
			drawerState({ 3: "source failed", 5: false }),
		);
		expect(renderDrawer(sourceFailed.CoverageFileDrawer).markup).toContain(
			"source failed",
		);

		const reportLoading = await loadDrawer(
			drawerState({ 0: "coverage", 6: true }),
		);
		expect(renderDrawer(reportLoading.CoverageFileDrawer).markup).toContain(
			"projectDetail.quality.coverageViewerLoading",
		);

		const reportLoaded = await loadDrawer(
			drawerState({ 0: "coverage", 2: availableReport, 6: false }),
		);
		const reportMarkup = renderDrawer(reportLoaded.CoverageFileDrawer).markup;
		expect(reportMarkup).toContain("&lt;html&gt;&lt;body&gt;covered");
		expect(reportMarkup).toContain('sandbox=""');

		const unavailable = await loadDrawer(
			drawerState({
				0: "coverage",
				2: {
					available: false,
					html: null,
					reason: "report_stale",
					generatedAt: null,
				},
				6: false,
			}),
		);
		expect(renderDrawer(unavailable.CoverageFileDrawer).markup).toContain(
			"projectDetail.quality.coverageReportUnavailable.report_stale",
		);

		const missing = await loadDrawer(drawerState({ 0: "coverage", 6: false }));
		expect(renderDrawer(missing.CoverageFileDrawer).markup).toContain(
			"projectDetail.quality.coverageReportUnavailable.report_missing",
		);

		const reportFailed = await loadDrawer(
			drawerState({ 0: "coverage", 4: "report failed", 6: false }),
		);
		expect(renderDrawer(reportFailed.CoverageFileDrawer).markup).toContain(
			"report failed",
		);
	});

	it("wires close and tab callbacks", async () => {
		const loaded = await loadDrawer(drawerState({ 1: source, 5: false }));
		const rendered = renderDrawer(loaded.CoverageFileDrawer);
		const all = elements(rendered.tree);
		const closeActions = all.filter(
			(element) => element.props.onClick === rendered.onClose,
		);
		expect(closeActions).toHaveLength(2);
		for (const element of closeActions) (element.props.onClick as () => void)();
		expect(rendered.onClose).toHaveBeenCalledTimes(2);

		const sourceTab = all.find(
			(element) => element.props.id === "coverage-source-tab",
		);
		const reportTab = all.find(
			(element) => element.props.id === "coverage-report-tab",
		);
		if (!sourceTab || !reportTab)
			throw new Error("viewer tabs were not rendered");
		expect(sourceTab?.props.active).toBe(true);
		expect(reportTab?.props.active).toBe(false);
		(sourceTab.props.onClick as () => void)();
		(reportTab.props.onClick as () => void)();
		expect(loaded.setters[0]).toHaveBeenNthCalledWith(1, "source");
		expect(loaded.setters[0]).toHaveBeenNthCalledWith(2, "coverage");
	});

	it("locks focus, restores it, closes on Escape, and traps Tab focus", async () => {
		class FakeElement {
			focus = vi.fn();
		}
		const previous = new FakeElement();
		const body = { style: { overflow: "scroll" } };
		const documentStub = { activeElement: previous, body };
		let keydown: ((event: KeyboardEvent) => void) | undefined;
		const addEventListener = vi.fn(
			(_name: string, listener: (event: KeyboardEvent) => void) => {
				keydown = listener;
			},
		);
		const removeEventListener = vi.fn();
		vi.stubGlobal("HTMLElement", FakeElement);
		vi.stubGlobal("document", documentStub);
		vi.stubGlobal("window", { addEventListener, removeEventListener });

		const loaded = await loadDrawer();
		const onClose = vi.fn();
		renderDrawer(loaded.CoverageFileDrawer, onClose);
		const restoreFocus = loaded.effects[0]();
		expect(body.style.overflow).toBe("hidden");
		expect(loaded.closeFocus).toHaveBeenCalledOnce();

		const removeKeyListener = loaded.effects[1]();
		expect(addEventListener).toHaveBeenCalledWith("keydown", keydown);
		keydown?.({ key: "Escape" } as KeyboardEvent);
		expect(onClose).toHaveBeenCalledOnce();
		keydown?.({ key: "Enter" } as KeyboardEvent);

		loaded.drawerRef.current = { querySelectorAll: vi.fn(() => []) };
		keydown?.({ key: "Tab" } as KeyboardEvent);
		const first = new FakeElement();
		const middle = new FakeElement();
		const last = new FakeElement();
		loaded.drawerRef.current.querySelectorAll.mockReturnValue([
			first,
			middle,
			last,
		]);

		documentStub.activeElement = first;
		const backwards = { key: "Tab", shiftKey: true, preventDefault: vi.fn() };
		keydown?.(backwards as unknown as KeyboardEvent);
		expect(backwards.preventDefault).toHaveBeenCalledOnce();
		expect(last.focus).toHaveBeenCalledOnce();

		documentStub.activeElement = last;
		const forwards = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
		keydown?.(forwards as unknown as KeyboardEvent);
		expect(forwards.preventDefault).toHaveBeenCalledOnce();
		expect(first.focus).toHaveBeenCalledOnce();

		documentStub.activeElement = middle;
		const untouched = { key: "Tab", shiftKey: false, preventDefault: vi.fn() };
		keydown?.(untouched as unknown as KeyboardEvent);
		expect(untouched.preventDefault).not.toHaveBeenCalled();

		removeKeyListener?.();
		expect(removeEventListener).toHaveBeenCalledWith("keydown", keydown);
		restoreFocus?.();
		expect(body.style.overflow).toBe("scroll");
		expect(previous.focus).toHaveBeenCalledOnce();
	});

	it("loads source content and handles HTTP and non-Error failures", async () => {
		const success = await loadDrawer();
		renderDrawer(success.CoverageFileDrawer);
		success.effects[2]();
		await vi.waitFor(() =>
			expect(success.setters[1]).toHaveBeenCalledWith(source),
		);
		expect(success.fetchRepositoryFile).toHaveBeenCalledWith(
			"repository-1",
			"src/example.ts",
		);
		expect(success.setters[1]).toHaveBeenLastCalledWith(source);
		expect(success.setters[5]).toHaveBeenLastCalledWith(false);

		const httpFailure = await loadDrawer(drawerState(), {
			fetchRepositoryFile: vi.fn(async () => response({}, 404)),
		});
		renderDrawer(httpFailure.CoverageFileDrawer);
		httpFailure.effects[2]();
		await vi.waitFor(() =>
			expect(httpFailure.setters[3]).toHaveBeenCalledWith(
				"projectDetail.quality.sourceLoadFailed",
			),
		);
		expect(httpFailure.setters[3]).toHaveBeenLastCalledWith(
			"projectDetail.quality.sourceLoadFailed",
		);

		const rawFailure = await loadDrawer(drawerState(), {
			fetchRepositoryFile: vi.fn(async () => {
				throw "offline";
			}),
		});
		renderDrawer(rawFailure.CoverageFileDrawer);
		rawFailure.effects[2]();
		await settle();
		expect(rawFailure.setters[3]).toHaveBeenLastCalledWith("offline");
	});

	it("does not update source state after its effect is cancelled", async () => {
		let resolveFetch: ((value: Response) => void) | undefined;
		const pending = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		const loaded = await loadDrawer(drawerState(), {
			fetchRepositoryFile: vi.fn(() => pending),
		});
		renderDrawer(loaded.CoverageFileDrawer);
		const cleanup = loaded.effects[2]();
		const sourceCalls = loaded.setters[1].mock.calls.length;
		const loadingCalls = loaded.setters[5].mock.calls.length;
		cleanup?.();
		resolveFetch?.(response(source));
		await settle();
		expect(loaded.setters[1]).toHaveBeenCalledTimes(sourceCalls);
		expect(loaded.setters[5]).toHaveBeenCalledTimes(loadingCalls);
	});

	it("loads a coverage report and handles HTTP and non-Error failures", async () => {
		const success = await loadDrawer(drawerState({ 0: "coverage" }));
		renderDrawer(success.CoverageFileDrawer);
		success.effects[3]();
		await vi.waitFor(() =>
			expect(success.setters[2]).toHaveBeenCalledWith(availableReport),
		);
		expect(success.fetchCoverageFileReport).toHaveBeenCalledWith(
			"repository-1",
			"run-1",
			"/repo/src/example.ts",
		);
		expect(success.setters[2]).toHaveBeenLastCalledWith(availableReport);
		expect(success.setters[6]).toHaveBeenLastCalledWith(false);

		const httpFailure = await loadDrawer(drawerState({ 0: "coverage" }), {
			fetchCoverageFileReport: vi.fn(async () => response({}, 500)),
		});
		renderDrawer(httpFailure.CoverageFileDrawer);
		httpFailure.effects[3]();
		await vi.waitFor(() =>
			expect(httpFailure.setters[4]).toHaveBeenCalledWith(
				"projectDetail.quality.coverageReportLoadFailed",
			),
		);
		expect(httpFailure.setters[4]).toHaveBeenLastCalledWith(
			"projectDetail.quality.coverageReportLoadFailed",
		);

		const rawFailure = await loadDrawer(drawerState({ 0: "coverage" }), {
			fetchCoverageFileReport: vi.fn(async () => {
				throw 503;
			}),
		});
		renderDrawer(rawFailure.CoverageFileDrawer);
		rawFailure.effects[3]();
		await settle();
		expect(rawFailure.setters[4]).toHaveBeenLastCalledWith("503");
	});

	it("skips duplicate report loads and cancels in-flight report updates", async () => {
		for (const overrides of [
			{ 0: "source" },
			{ 0: "coverage", 2: availableReport },
			{ 0: "coverage", 4: "already failed" },
		]) {
			const loaded = await loadDrawer(drawerState(overrides));
			renderDrawer(loaded.CoverageFileDrawer);
			expect(loaded.effects[3]()).toBeUndefined();
			expect(loaded.fetchCoverageFileReport).not.toHaveBeenCalled();
		}

		let resolveFetch: ((value: Response) => void) | undefined;
		const pending = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		const loaded = await loadDrawer(drawerState({ 0: "coverage" }), {
			fetchCoverageFileReport: vi.fn(() => pending),
		});
		renderDrawer(loaded.CoverageFileDrawer);
		const cleanup = loaded.effects[3]();
		const reportCalls = loaded.setters[2].mock.calls.length;
		const loadingCalls = loaded.setters[6].mock.calls.length;
		cleanup?.();
		resolveFetch?.(response(availableReport));
		await settle();
		expect(loaded.setters[2]).toHaveBeenCalledTimes(reportCalls);
		expect(loaded.setters[6]).toHaveBeenCalledTimes(loadingCalls);
	});
});
