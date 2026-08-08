import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	PROMPT_IMAGE_MAX_BYTES,
	PROMPT_IMAGE_MAX_COUNT,
} from "../shared/prompt-image";

let setters: Array<ReturnType<typeof vi.fn>> = [];
let refs: Array<{ current: unknown }> = [];
let effects: Array<() => undefined | (() => void)> = [];
let layouts: Array<() => void> = [];
let listeners: Record<string, (event: never) => void> = {};

function setup(
	state: unknown[] = ["", [], null, false],
	options: {
		stored?: string | null;
		storageThrows?: boolean;
		fileReadFails?: boolean;
	} = {},
) {
	const values = [...state];
	setters = [];
	refs = [];
	effects = [];
	layouts = [];
	listeners = {};
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useMemo: <T,>(factory: () => T) => factory(),
			useEffect: (callback: () => undefined | (() => void)) =>
				effects.push(callback),
			useLayoutEffect: (callback: () => void) => layouts.push(callback),
			useRef: <T,>(initial: T) => {
				const ref = { current: initial };
				refs.push(ref as { current: unknown });
				return ref;
			},
			useState: <T,>(initial: T) => {
				const value = values.length ? (values.shift() as T) : initial;
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
	vi.doMock(
		"../src/modules/nightworkers/components/ModelThinkingControls",
		() => ({
			ModelThinkingControls: () => null,
		}),
	);
	const localStorage = {
		getItem: vi.fn(() => {
			if (options.storageThrows) throw new Error("storage");
			return options.stored ?? null;
		}),
		setItem: vi.fn(() => {
			if (options.storageThrows) throw new Error("storage");
		}),
		removeItem: vi.fn(() => {
			if (options.storageThrows) throw new Error("storage");
		}),
	};
	vi.stubGlobal("window", {
		localStorage,
		getComputedStyle: vi.fn(() => ({
			lineHeight: "normal",
			paddingTop: "bad",
			paddingBottom: "4",
			borderTopWidth: "1",
			borderBottomWidth: "bad",
		})),
		addEventListener: vi.fn(
			(name: string, callback: (event: never) => void) => {
				listeners[name] = callback;
			},
		),
		removeEventListener: vi.fn(),
	});
	class FileReaderMock {
		result: string | null = "data:image/png;base64,abc";
		error: Error | null = options.fileReadFails ? new Error("read") : null;
		onload: (() => void) | null = null;
		onerror: (() => void) | null = null;
		readAsDataURL() {
			queueMicrotask(() =>
				options.fileReadFails ? this.onerror?.() : this.onload?.(),
			);
		}
	}
	vi.stubGlobal("FileReader", FileReaderMock);
	return { localStorage };
}

function baseProps(overrides: Record<string, unknown> = {}) {
	return {
		disabled: false,
		model: "model",
		thinkingDepth: "medium",
		modelOptions: [],
		thinkingDepthOptions: [],
		onModelChange: vi.fn(),
		onThinkingDepthChange: vi.fn(),
		onSubmit: vi.fn(async () => undefined),
		...overrides,
	} as never;
}

async function render(props = baseProps()) {
	const { Composer } = await import(
		"../src/modules/nightworkers/components/Composer"
	);
	return Composer(props) as ReactElement;
}

function elements(node: ReactNode): ReactElement[] {
	if (
		node == null ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...elements(element.props?.children)];
}

function textarea(root: ReactElement) {
	return elements(root).find((element) => element.type === "textarea")!;
}

function submitButton(root: ReactElement) {
	return elements(root)
		.filter((element) => element.type === "button")
		.at(-1)!;
}

async function flushPromises() {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("Composer coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("loads, clears, persists, and recovers drafts across storage branches", async () => {
		let tools = setup(["prompt", [], null, false], { stored: "stored" });
		await render(
			baseProps({ draftStorageKey: "draft", initialPrompt: "initial" }),
		);
		effects[0]();
		effects[1]();
		expect(setters[0]).toHaveBeenCalledWith("stored");
		expect(tools.localStorage.setItem).toHaveBeenCalledWith("draft", "prompt");

		tools = setup(["", [], null, false], { stored: null });
		await render(
			baseProps({ draftStorageKey: "draft", initialPrompt: "initial" }),
		);
		effects[0]();
		effects[1]();
		expect(setters[0]).toHaveBeenCalledWith("initial");
		expect(tools.localStorage.removeItem).toHaveBeenCalledWith("draft");

		tools = setup(["prompt", [], null, false], { storageThrows: true });
		await render(
			baseProps({
				draftStorageKey: "draft",
				initialPrompt: "fallback",
				discardStoredDraft: true,
			}),
		);
		effects[0]();
		expect(setters[0]).toHaveBeenCalledWith("");

		setup();
		await render(baseProps());
		effects[0]();
		expect(setters[0]).toHaveBeenCalledWith("");
	});

	it("injects prompts into empty and populated drafts", async () => {
		setup(["existing", [], null, false]);
		await render(baseProps({ injectedPrompt: { id: 1, text: "injected" } }));
		effects[2]();
		expect(setters[0].mock.results.at(-1)?.value).toBe(
			"existing\n\n---\n\ninjected",
		);

		setup(["", [], null, false]);
		await render(baseProps({ injectedPrompt: { id: 1, text: "injected" } }));
		effects[2]();
		expect(setters[0].mock.results.at(-1)?.value).toBe("injected");

		setup();
		await render();
		effects[2]();
		expect(setters[0]).not.toHaveBeenCalled();
	});

	it("resizes the textarea with minimum, maximum, and overflow behavior", async () => {
		setup();
		await render();
		const node = {
			style: {} as Record<string, string>,
			scrollHeight: 20,
			focus: vi.fn(),
		};
		refs[0].current = node;
		layouts[0]();
		expect(node.style.height).toBe("58px");
		expect(node.style.overflowY).toBe("hidden");
		effects[3]();
		node.scrollHeight = 500;
		listeners.resize(undefined as never);
		expect(node.style.height).toBe("205px");
		expect(node.style.overflowY).toBe("auto");
		const cleanup = effects[3]();
		cleanup?.();
	});

	it("handles global drag lifecycle and ignores non-file drags", async () => {
		setup();
		await render();
		effects[4]();
		const plain = {
			dataTransfer: { types: ["text/plain"] },
			preventDefault: vi.fn(),
		};
		listeners.dragenter(plain as never);
		expect(plain.preventDefault).not.toHaveBeenCalled();
		const files = {
			dataTransfer: { types: ["Files"], dropEffect: "", files: [] },
			preventDefault: vi.fn(),
		};
		listeners.dragenter(files as never);
		listeners.dragenter(files as never);
		listeners.dragover(files as never);
		expect(files.dataTransfer.dropEffect).toBe("copy");
		listeners.dragleave({} as never);
		listeners.dragleave({} as never);
		expect(setters[3]).toHaveBeenCalledWith(false);
		listeners.dragend({} as never);
		listeners.drop(plain as never);
		const cleanup = effects[4]();
		cleanup?.();
	});

	it("accepts supported images and reports unsupported, oversized, and count limits", async () => {
		setup();
		await render();
		effects[4]();
		refs[0].current = { focus: vi.fn() };
		const supported = new File(["x"], "one.png", { type: "image/png" });
		const unsupported = new File(["x"], "one.txt", { type: "text/plain" });
		listeners.drop({
			dataTransfer: { types: ["Files"], files: [supported, unsupported] },
			preventDefault: vi.fn(),
		} as never);
		await flushPromises();
		expect(setters[1]).toHaveBeenCalledWith(expect.any(Array));
		expect(setters[2]).toHaveBeenCalledWith("composer.imageUnsupported");

		const oversized = new File(["x"], "large.png", { type: "image/png" });
		Object.defineProperty(oversized, "size", {
			value: PROMPT_IMAGE_MAX_BYTES + 1,
		});
		listeners.drop({
			dataTransfer: { types: ["Files"], files: [oversized] },
			preventDefault: vi.fn(),
		} as never);
		await flushPromises();
		expect(setters[2]).toHaveBeenCalledWith("composer.imageSizeLimit");

		const many = Array.from(
			{ length: PROMPT_IMAGE_MAX_COUNT + 1 },
			(_, index) => new File(["x"], `${index}.png`, { type: "image/png" }),
		);
		listeners.drop({
			dataTransfer: { types: ["Files"], files: many },
			preventDefault: vi.fn(),
		} as never);
		await flushPromises();
		expect(setters[2]).toHaveBeenCalledWith("composer.imageCountLimit");
	});

	it("reports file-read failures", async () => {
		setup(undefined, { fileReadFails: true });
		await render();
		effects[4]();
		listeners.drop({
			dataTransfer: {
				types: ["Files"],
				files: [new File(["x"], "one.png", { type: "image/png" })],
			},
			preventDefault: vi.fn(),
		} as never);
		await flushPromises();
		expect(setters[2]).toHaveBeenCalledWith("composer.imageReadFailed");
	});

	it("submits text and image-only prompts and restores non-aborted failures", async () => {
		let onSubmit = vi.fn(async () => undefined);
		setup(["  prompt  ", [], null, false]);
		let root = await render(baseProps({ draftStorageKey: "draft", onSubmit }));
		refs[2].current = [];
		await submitButton(root).props.onClick();
		expect(onSubmit).toHaveBeenCalledWith("prompt", "intake", []);

		onSubmit = vi.fn(async () => {
			throw new Error("failed");
		});
		setup(["prompt", [], null, false]);
		root = await render(baseProps({ draftStorageKey: "draft", onSubmit }));
		refs[2].current = [];
		await expect(submitButton(root).props.onClick()).rejects.toThrow("failed");
		expect(setters[0]).toHaveBeenLastCalledWith("prompt");

		onSubmit = vi.fn(async () => {
			throw new DOMException("aborted", "AbortError");
		});
		setup(["prompt", [], null, false]);
		root = await render(baseProps({ onSubmit }));
		refs[2].current = [];
		await expect(submitButton(root).props.onClick()).resolves.toBeUndefined();
		expect(setters[0]).toHaveBeenCalledWith("");

		const image = {
			id: "i",
			name: "i.png",
			mediaType: "image/png",
			size: 1,
			dataUrl: "data:",
		};
		onSubmit = vi.fn(async () => undefined);
		setup(["", [image], null, false]);
		root = await render(baseProps({ onSubmit }));
		refs[2].current = [image];
		await submitButton(root).props.onClick();
		expect(onSubmit).toHaveBeenCalledWith(
			"composer.imageOnlyPrompt",
			"intake",
			[image],
		);
	});

	it("handles keyboard shortcuts, stop mode, disabled state, and image removal", async () => {
		const onSubmit = vi.fn(async () => undefined);
		setup(["prompt", [], null, false]);
		let root = await render(baseProps({ onSubmit }));
		refs[2].current = [];
		const input = textarea(root);
		await input.props.onKeyDown({
			key: "Enter",
			metaKey: true,
			ctrlKey: false,
			nativeEvent: { isComposing: false },
			preventDefault: vi.fn(),
		});
		expect(onSubmit).toHaveBeenCalled();
		await input.props.onKeyDown({
			key: "Enter",
			metaKey: true,
			ctrlKey: false,
			nativeEvent: { isComposing: true },
			preventDefault: vi.fn(),
		});

		const onStop = vi.fn(async () => undefined);
		setup(["", [], null, false]);
		root = await render(
			baseProps({ isStopMode: true, onStop, isStopping: false }),
		);
		await submitButton(root).props.onClick();
		expect(onStop).toHaveBeenCalled();

		setup(["", [], null, false]);
		root = await render(
			baseProps({ isStopMode: true, onStop: undefined, isStopping: true }),
		);
		await submitButton(root).props.onClick();
		expect(submitButton(root).props.disabled).toBe(true);

		const image = {
			id: "i",
			name: "i.png",
			mediaType: "image/png",
			size: 1,
			dataUrl: "data:",
		};
		setup(["", [image], "warning", true]);
		root = await render(
			baseProps({
				artifactContext: { title: "Plan", kind: "plan", metadata: {} },
				realtimeStatus: "disconnected",
				latestDiffPatch: "diff --git a/a b/a\n+x\n-y",
			}),
		);
		refs[2].current = [image];
		const buttons = elements(root).filter(
			(element) => element.type === "button",
		);
		buttons[0].props.onClick();
		expect(setters[1].mock.results.at(-1)?.value).toEqual([]);
	});
});
