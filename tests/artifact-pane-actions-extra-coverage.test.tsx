import {
	Fragment,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookControls = vi.hoisted(() => ({
	isOpen: false,
	setIsOpen: vi.fn(),
	refIndex: 0,
	refs: [] as Array<{ current: unknown }>,
	effects: [] as Array<() => undefined | (() => void)>,
}));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useState: () => [hookControls.isOpen, hookControls.setIsOpen] as const,
		useRef: (initial: unknown) =>
			hookControls.refs[hookControls.refIndex++] || { current: initial },
		useEffect: (effect: () => undefined | (() => void)) => {
			hookControls.effects.push(effect);
		},
	};
});

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: { current?: number; total?: number }) =>
			values ? `${key}:${values.current}/${values.total}` : key,
	}),
}));

vi.mock("lucide-react", () => {
	const icon = (name: string) => (props: Record<string, unknown>) => (
		<span data-icon={name} {...props} />
	);
	return {
		ChevronLeft: icon("left"),
		ChevronRight: icon("right"),
		Copy: icon("copy"),
		Download: icon("download"),
		FileSpreadsheet: icon("spreadsheet"),
		FileText: icon("text"),
		FolderTree: icon("tree"),
		GitCompare: icon("diff"),
		Image: icon("image"),
		LoaderCircle: icon("loading"),
		Maximize2: icon("maximize"),
		Minimize2: icon("minimize"),
	};
});

import {
	ArtifactExportMenu,
	ArtifactHeaderActions,
	ProjectTreeHeaderActions,
} from "../src/modules/nightworkers/components/ArtifactPaneActions";

type HostElement = ReactElement<Record<string, unknown>, string>;

function collectHostElements(node: ReactNode, result: HostElement[] = []) {
	if (node === null || node === undefined || typeof node === "boolean")
		return result;
	if (Array.isArray(node)) {
		for (const child of node) collectHostElements(child, result);
		return result;
	}
	if (!isValidElement<Record<string, unknown>>(node)) return result;
	if (typeof node.type === "function") {
		return collectHostElements(node.type(node.props), result);
	}
	if (node.type === Fragment) {
		return collectHostElements(node.props.children as ReactNode, result);
	}
	if (typeof node.type === "string") {
		result.push(node as HostElement);
		collectHostElements(node.props.children as ReactNode, result);
	}
	return result;
}

function renderMenu(
	overrides: Partial<Parameters<typeof ArtifactExportMenu>[0]> = {},
) {
	hookControls.refIndex = 0;
	return ArtifactExportMenu({
		onCopyMarkdown: vi.fn(),
		onDownloadMarkdown: vi.fn(),
		onDownloadImage: vi.fn(),
		isExportingImage: false,
		exportError: null,
		...overrides,
	});
}

function buttonByLabel(hosts: HostElement[], label: string) {
	const button = hosts.find(
		(element) =>
			element.type === "button" && element.props["aria-label"] === label,
	);
	if (!button) throw new Error(`Expected button: ${label}`);
	return button;
}

beforeEach(() => {
	hookControls.isOpen = false;
	hookControls.setIsOpen.mockClear();
	hookControls.refIndex = 0;
	hookControls.refs = [];
	hookControls.effects = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ArtifactPaneActions extra coverage", () => {
	it("renders header version boundaries, fullscreen labels, export states, and callbacks", () => {
		const callbacks = {
			onPrevious: vi.fn(),
			onNext: vi.fn(),
			onCopyMarkdown: vi.fn(),
			onDownloadMarkdown: vi.fn(),
			onDownloadCsv: vi.fn(),
			onDownloadImage: vi.fn(),
			onToggleFullscreen: vi.fn(),
		};
		let tree = ArtifactHeaderActions({
			currentVersionIndex: 0,
			versionCount: 0,
			isFullscreen: false,
			isExportingImage: false,
			exportDisabled: true,
			exportError: null,
			...callbacks,
		});
		let hosts = collectHostElements(tree);
		expect(
			buttonByLabel(hosts, "artifact.previousVersion").props.disabled,
		).toBe(true);
		expect(buttonByLabel(hosts, "artifact.nextVersion").props.disabled).toBe(
			true,
		);
		expect(buttonByLabel(hosts, "artifact.exportMenu").props.disabled).toBe(
			true,
		);
		expect(buttonByLabel(hosts, "artifact.fullscreen")).toBeDefined();
		expect(
			hosts.some(
				(element) =>
					element.type === "span" &&
					element.props.children === "artifact.versionLabel:1/1",
			),
		).toBe(true);

		hookControls.refIndex = 0;
		tree = ArtifactHeaderActions({
			currentVersionIndex: 1,
			versionCount: 3,
			isFullscreen: true,
			isExportingImage: true,
			exportError: "Export failed",
			onDownloadCsv: undefined,
			...callbacks,
		});
		hosts = collectHostElements(tree);
		expect(
			buttonByLabel(hosts, "artifact.previousVersion").props.disabled,
		).toBe(false);
		expect(buttonByLabel(hosts, "artifact.nextVersion").props.disabled).toBe(
			false,
		);
		expect(buttonByLabel(hosts, "artifact.exitFullscreen")).toBeDefined();
		expect(
			hosts.some((element) => element.props["data-icon"] === "minimize"),
		).toBe(true);

		(
			buttonByLabel(hosts, "artifact.previousVersion").props
				.onClick as () => void
		)();
		(
			buttonByLabel(hosts, "artifact.nextVersion").props.onClick as () => void
		)();
		(
			buttonByLabel(hosts, "artifact.exitFullscreen").props
				.onClick as () => void
		)();
		expect(callbacks.onPrevious).toHaveBeenCalledOnce();
		expect(callbacks.onNext).toHaveBeenCalledOnce();
		expect(callbacks.onToggleFullscreen).toHaveBeenCalledOnce();
	});

	it("opens the export menu with optional CSV, errors, busy labels, and all actions", () => {
		vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
			callback();
			return 1;
		});
		hookControls.isOpen = true;
		const actions = {
			onCopyMarkdown: vi.fn(),
			onDownloadMarkdown: vi.fn(),
			onDownloadCsv: vi.fn(),
			onDownloadImage: vi.fn(),
		};
		let tree = renderMenu({
			...actions,
			exportError: "Image export failed",
		});
		let hosts = collectHostElements(tree);
		const trigger = buttonByLabel(hosts, "artifact.exportMenu");
		expect(trigger.props.title).toBe("Image export failed");
		expect(String(trigger.props.className)).toContain(
			"nightworkers-artifact-export-trigger-error",
		);
		expect(hosts.some((element) => element.props.role === "alert")).toBe(true);
		const menuItems = hosts.filter(
			(element) => element.props.role === "menuitem",
		);
		expect(menuItems).toHaveLength(4);
		for (const item of menuItems) (item.props.onClick as () => void)();
		expect(actions.onDownloadImage).toHaveBeenCalledOnce();
		expect(actions.onDownloadMarkdown).toHaveBeenCalledOnce();
		expect(actions.onDownloadCsv).toHaveBeenCalledOnce();
		expect(actions.onCopyMarkdown).toHaveBeenCalledOnce();
		expect(hookControls.setIsOpen).toHaveBeenCalledWith(false);

		hookControls.isOpen = true;
		hookControls.refIndex = 0;
		tree = renderMenu({
			isExportingImage: true,
			onDownloadCsv: undefined,
			exportError: null,
		});
		hosts = collectHostElements(tree);
		expect(buttonByLabel(hosts, "artifact.exportMenu").props.title).toBe(
			"artifact.exportMenu",
		);
		expect(
			hosts.some((element) => element.props["data-icon"] === "loading"),
		).toBe(true);
		const busyItem = hosts.find(
			(element) =>
				element.props.role === "menuitem" && element.props.disabled === true,
		);
		expect(busyItem?.props.children).toBeDefined();
		expect(menuItems).toHaveLength(4);
	});

	it("toggles the menu and handles closed, outside-click, Escape, and cleanup effects", () => {
		let tree = renderMenu();
		let hosts = collectHostElements(tree);
		const trigger = buttonByLabel(hosts, "artifact.exportMenu");
		(trigger.props.onClick as () => void)();
		const updater = hookControls.setIsOpen.mock.calls[0]?.[0] as (
			value: boolean,
		) => boolean;
		expect(updater(false)).toBe(true);
		expect(updater(true)).toBe(false);
		expect(hookControls.effects).toHaveLength(1);
		expect(hookControls.effects[0]?.()).toBeUndefined();

		const focusedItem = { focus: vi.fn() };
		const triggerElement = { focus: vi.fn() };
		const menuElement = {
			querySelector: vi.fn(() => focusedItem),
			querySelectorAll: vi.fn(() => []),
			contains: vi.fn((target: unknown) => target === "inside"),
		};
		const handlers: Record<string, (event: Record<string, unknown>) => void> =
			{};
		const fakeDocument = {
			activeElement: null,
			addEventListener: vi.fn(
				(type: string, handler: (event: Record<string, unknown>) => void) => {
					handlers[type] = handler;
				},
			),
			removeEventListener: vi.fn(),
		};
		const cancelAnimationFrame = vi.fn();
		vi.stubGlobal("document", fakeDocument);
		vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
			callback();
			return 17;
		});
		vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

		hookControls.isOpen = true;
		hookControls.effects = [];
		hookControls.refs = [{ current: menuElement }, { current: triggerElement }];
		tree = renderMenu();
		hosts = collectHostElements(tree);
		const cleanup = hookControls.effects[0]?.();
		expect(focusedItem.focus).toHaveBeenCalledOnce();
		expect(fakeDocument.addEventListener).toHaveBeenCalledTimes(2);
		handlers.mousedown?.({ target: "inside" });
		handlers.mousedown?.({ target: "outside" });
		handlers.keydown?.({ key: "Enter" });
		handlers.keydown?.({ key: "Escape" });
		expect(hookControls.setIsOpen).toHaveBeenCalledWith(false);
		expect(triggerElement.focus).toHaveBeenCalled();
		if (typeof cleanup !== "function")
			throw new Error("Expected effect cleanup");
		cleanup();
		expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
		expect(fakeDocument.removeEventListener).toHaveBeenCalledTimes(2);

		const firstMenuItem = hosts.find(
			(element) => element.props.role === "menuitem",
		);
		if (!firstMenuItem) throw new Error("Expected a menu item");
		(firstMenuItem.props.onClick as () => void)();
		expect(triggerElement.focus).toHaveBeenCalled();
	});

	it("moves menu focus for Home, End, ArrowUp, ArrowDown, and ignores other or empty keys", () => {
		const items = [{ focus: vi.fn() }, { focus: vi.fn() }, { focus: vi.fn() }];
		const menuElement = {
			querySelector: vi.fn(() => null),
			querySelectorAll: vi.fn(() => items),
			contains: vi.fn(() => true),
		};
		const fakeDocument = {
			activeElement: items[1],
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		};
		vi.stubGlobal("document", fakeDocument);
		vi.stubGlobal(
			"requestAnimationFrame",
			vi.fn(() => 1),
		);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		hookControls.isOpen = true;
		hookControls.refs = [{ current: menuElement }, { current: null }];
		const tree = renderMenu();
		const menu = collectHostElements(tree).find(
			(element) => element.props.role === "menu",
		);
		if (!menu) throw new Error("Expected an open menu");
		const onKeyDown = menu.props.onKeyDown as (event: {
			key: string;
			preventDefault: () => void;
		}) => void;
		const preventDefault = vi.fn();
		onKeyDown({ key: "PageDown", preventDefault });
		for (const key of ["Home", "End", "ArrowUp", "ArrowDown"]) {
			onKeyDown({ key, preventDefault });
		}
		expect(preventDefault).toHaveBeenCalledTimes(4);
		expect(items[0].focus).toHaveBeenCalled();
		expect(items[2].focus).toHaveBeenCalled();

		menuElement.querySelectorAll.mockReturnValue([]);
		onKeyDown({ key: "ArrowDown", preventDefault });
		hookControls.refs[0] = { current: null };
		hookControls.refIndex = 0;
		const nullRefMenu = collectHostElements(renderMenu()).find(
			(element) => element.props.role === "menu",
		);
		if (!nullRefMenu) throw new Error("Expected an open menu with null ref");
		(nullRefMenu.props.onKeyDown as typeof onKeyDown)({
			key: "ArrowDown",
			preventDefault,
		});
	});

	it("switches project tree modes and fullscreen states", () => {
		const onModeChange = vi.fn();
		const onToggleFullscreen = vi.fn();
		for (const [mode, fullscreen] of [
			["tree", false],
			["diff", true],
		] as const) {
			const hosts = collectHostElements(
				ProjectTreeHeaderActions({
					mode,
					isFullscreen: fullscreen,
					onModeChange,
					onToggleFullscreen,
				}),
			);
			(
				buttonByLabel(hosts, "artifact.showProjectTree").props
					.onClick as () => void
			)();
			(
				buttonByLabel(hosts, "artifact.showGitDiff").props.onClick as () => void
			)();
			(
				buttonByLabel(
					hosts,
					fullscreen ? "artifact.exitFullscreen" : "artifact.fullscreen",
				).props.onClick as () => void
			)();
			expect(
				hosts.some((element) =>
					String(element.props.className).includes(
						"border-sky-500/80 bg-sky-500/15",
					),
				),
			).toBe(true);
		}
		expect(onModeChange.mock.calls).toEqual([
			["tree"],
			["diff"],
			["tree"],
			["diff"],
		]);
		expect(onToggleFullscreen).toHaveBeenCalledTimes(2);
	});
});
