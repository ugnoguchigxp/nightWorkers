import { describe, expect, it, vi } from "vitest";

let _stateValue = "";

function mockReact(prompt: string) {
	_stateValue = prompt;
	const stateSlots: unknown[] = [prompt, [], null, false];
	let stateIndex = 0;
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: (callback: () => void) => callback(),
			useLayoutEffect: (callback: () => void) => callback(),
			useMemo: <T,>(factory: () => T) => factory(),
			useRef: <T,>(initial: T) => ({ current: initial }),
			useState: <T,>(initial: T) => {
				const index = stateIndex++;
				if (stateSlots[index] === undefined) stateSlots[index] = initial;
				return [
					stateSlots[index] as T,
					vi.fn((next: T | ((current: T) => T)) => {
						stateSlots[index] =
							typeof next === "function"
								? (next as (current: T) => T)(stateSlots[index] as T)
								: next;
						if (index === 0) _stateValue = String(stateSlots[index]);
					}),
				] as const;
			},
		};
	});
	vi.doMock("react-i18next", async () => ({
		...(await vi.importActual<typeof import("react-i18next")>("react-i18next")),
		useTranslation: () => ({ t: (key: string) => key }),
	}));
	vi.stubGlobal("window", {
		localStorage: {
			getItem: vi.fn(() => prompt),
			setItem: vi.fn(),
			removeItem: vi.fn(),
		},
		getComputedStyle: vi.fn(() => ({
			lineHeight: "20px",
			paddingTop: "4px",
			paddingBottom: "4px",
			borderTopWidth: "1px",
			borderBottomWidth: "1px",
		})),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	});
}

async function triggerHandlers(element: unknown) {
	const seen = new Set<unknown>();
	const errors: unknown[] = [];
	const visit = async (node: unknown) => {
		if (!node || typeof node !== "object" || seen.has(node)) return;
		seen.add(node);
		if (Array.isArray(node)) {
			for (const child of node) await visit(child);
			return;
		}
		const props = (node as { props?: Record<string, unknown> }).props;
		const type = (node as { type?: unknown }).type;
		if (!props) return;
		if (typeof props.onChange === "function") {
			await props.onChange(
				type === "textarea"
					? { target: { value: "updated prompt" } }
					: "updated-model",
			);
		}
		if (typeof props.onKeyDown === "function") {
			try {
				await props.onKeyDown({
					key: "Enter",
					metaKey: true,
					ctrlKey: false,
					nativeEvent: { isComposing: false },
					preventDefault: vi.fn(),
				});
			} catch (error) {
				errors.push(error);
			}
		}
		if (typeof props.onClick === "function") await props.onClick();
		await visit(props.children);
	};
	await visit(element);
	return errors;
}

describe("Composer actions", () => {
	it("submits, stops, clears context, and restores draft on failed submit", async () => {
		mockReact("Run coverage");
		const { Composer } = await import(
			"../src/modules/nightworkers/components/Composer"
		);
		const onSubmit = vi
			.fn()
			.mockRejectedValueOnce(new Error("submit failed"))
			.mockResolvedValueOnce(undefined);
		const onStop = vi.fn(async () => undefined);
		const onClearArtifactContext = vi.fn();

		const element = Composer({
			disabled: false,
			model: "gpt-5",
			thinkingDepth: "high",
			modelOptions: [{ value: "gpt-5", label: "GPT-5" }],
			thinkingDepthOptions: [{ value: "high", label: "High" }],
			latestDiffPatch: "diff --git a/a.ts b/a.ts\n+added\n-removed\n",
			draftStorageKey: "draft-key",
			initialPrompt: "Initial",
			injectedPrompt: { id: 1, text: "Injected" },
			artifactContext: {
				artifactId: "artifact-1",
				kind: "plan_mode_workspace",
				title: "Feature Plan",
				source: { type: "task_message", messageId: "message-1" },
				metadata: { displayKind: "PLAN_MODE:FEATURE_PLAN" },
			},
			realtimeStatus: "connected",
			isStopMode: true,
			isStopping: false,
			onModelChange: vi.fn(),
			onThinkingDepthChange: vi.fn(),
			onSubmit,
			onClearArtifactContext,
			onStop,
		});

		const errors = await triggerHandlers(element);
		expect(onSubmit).toHaveBeenCalled();
		expect(errors[0]).toBeInstanceOf(Error);
		expect(onClearArtifactContext).toHaveBeenCalled();
		expect(onStop).toHaveBeenCalled();
	});
});
