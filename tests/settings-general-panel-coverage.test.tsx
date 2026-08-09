import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Effect = () => void;

let stateSlots: unknown[] = [];
let stateCursor = 0;
let effects: Effect[] = [];
let setters: Array<ReturnType<typeof vi.fn>> = [];
let fetchPricingRows = vi.fn();
let importPublicPricingRows = vi.fn();
let applyAppLanguage = vi.fn();

function response(json: unknown, ok = true, text = "request failed") {
	return {
		ok,
		json: vi.fn(async () => json),
		text: vi.fn(async () => text),
	};
}

async function createHarness(initialState: unknown[] = []) {
	stateSlots = [...initialState];
	stateCursor = 0;
	effects = [];
	setters = [];
	fetchPricingRows = vi.fn(async () =>
		response({ rows: [], totalCount: 0, nextCursor: null }),
	);
	importPublicPricingRows = vi.fn(async () =>
		response({
			imported: 2,
			skipped: 1,
			providers: ["openai", "qwen"],
			rows: [],
			fetchedAt: "2026-08-09T00:00:00.000Z",
			sourceUrl: "https://example.test/pricing",
		}),
	);
	applyAppLanguage = vi.fn(async () => undefined);
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useCallback: <T extends (...args: never[]) => unknown>(callback: T) =>
				callback,
			useEffect: (effect: Effect) => effects.push(effect),
			useState: <T,>(initial: T) => {
				const index = stateCursor++;
				if (stateSlots.length <= index) stateSlots[index] = initial;
				const setter = vi.fn((next: T | ((current: T) => T)) => {
					stateSlots[index] =
						typeof next === "function"
							? (next as (current: T) => T)(stateSlots[index] as T)
							: next;
				});
				setters[index] = setter;
				return [stateSlots[index] as T, setter] as const;
			},
		};
	});
	vi.doMock("react-i18next", () => ({
		useTranslation: () => ({
			t: (key: string, params?: Record<string, unknown>) =>
				params ? `${key}:${JSON.stringify(params)}` : key,
		}),
	}));
	vi.doMock("lucide-react", () => ({ RefreshCw: "refresh-icon" }));
	vi.doMock("@/components/ui/Button", () => ({ Button: "button" }));
	vi.doMock("../src/modules/settings/SettingsFields", () => ({
		SelectField: "select-field",
	}));
	vi.doMock("../src/modules/settings/SettingsRetentionPanel", () => ({
		SettingsRetentionPanel: "retention-panel",
	}));
	vi.doMock("../src/i18n/format", () => ({
		formatDateTime: (value: string, language: string, timezone: string) =>
			`formatted:${value}:${language}:${timezone}`,
	}));
	vi.doMock("../src/i18n/I18nProvider", () => ({ applyAppLanguage }));
	vi.doMock("../src/modules/settings/settingsCommands", () => ({
		fetchPricingRows: (...args: unknown[]) => fetchPricingRows(...args),
		importPublicPricingRows: (...args: unknown[]) =>
			importPublicPricingRows(...args),
	}));

	const { GeneralSettingsPanel } = await import(
		"../src/modules/settings/SettingsGeneralPanel"
	);
	return {
		render(props: ReturnType<typeof props>) {
			stateCursor = 0;
			effects = [];
			return GeneralSettingsPanel(props as never) as ReactElement;
		},
		runEffects() {
			for (const effect of effects) effect();
		},
	};
}

function generalValue(overrides: Record<string, unknown> = {}) {
	return {
		timezone: "Asia/Tokyo",
		language: "ja",
		currency: "JPY",
		fx: {
			source: "ecb",
			autoRefresh: true,
			lastRefreshedAt: "2026-08-09T00:00:00.000Z",
		},
		dataRetention: { codingAgentFullRecordDays: 7 },
		...overrides,
	};
}

function props(overrides: Record<string, unknown> = {}) {
	return {
		value: generalValue(),
		fxCache: null,
		isRefreshingFx: false,
		onChange: vi.fn(),
		onRefreshFx: vi.fn(),
		...overrides,
	};
}

function elements(node: ReactNode): ReactElement[] {
	if (
		node === null ||
		node === undefined ||
		typeof node === "boolean" ||
		typeof node === "string" ||
		typeof node === "number"
	)
		return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...elements(element.props?.children)];
}

function text(node: ReactNode): string {
	if (node === null || node === undefined || typeof node === "boolean")
		return "";
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(text).join(" ");
	return text((node as ReactElement<{ children?: ReactNode }>).props?.children);
}

function byText(root: ReactElement, value: string) {
	return requiredElement(
		root,
		(element) => text(element).trim() === value,
		value,
	);
}

function requiredElement(
	root: ReactElement,
	predicate: (element: ReactElement) => boolean,
	description: string,
) {
	const element = elements(root).find(predicate);
	if (!element) throw new Error(`Element not found: ${description}`);
	return element;
}

async function flushPromises() {
	for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("GeneralSettingsPanel coverage", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("loads pricing and wires general setting callbacks with optional defaults", async () => {
		const harness = await createHarness();
		const onChange = vi.fn();
		const onRefreshFx = vi.fn();
		const value = generalValue({
			fx: { source: "manual", autoRefresh: false, lastRefreshedAt: "invalid" },
			llmUsage: undefined,
		});
		let root = harness.render(
			props({ value, onChange, onRefreshFx, isRefreshingFx: true }),
		);
		const selectFields = elements(root).filter(
			(element) => element.type === "select-field",
		);
		expect(selectFields).toHaveLength(3);
		selectFields[0].props.onChange("UTC");
		selectFields[1].props.onChange("en");
		selectFields[2].props.onChange("USD");
		expect(applyAppLanguage).toHaveBeenCalledWith("en");
		expect(onChange).toHaveBeenNthCalledWith(1, { ...value, timezone: "UTC" });
		expect(onChange).toHaveBeenNthCalledWith(2, { ...value, language: "en" });
		expect(onChange).toHaveBeenNthCalledWith(3, { ...value, currency: "USD" });

		const checkbox = requiredElement(
			root,
			(element) =>
				element.type === "input" && element.props.type === "checkbox",
			"observability checkbox",
		);
		expect(checkbox.props.checked).toBe(true);
		checkbox.props.onChange({ target: { checked: false } });
		expect(onChange).toHaveBeenLastCalledWith({
			...value,
			llmUsage: { promptPartObservabilityEnabled: false },
		});

		const fxButton = byText(root, "settings.general.refreshFx");
		expect(fxButton.props.disabled).toBe(true);
		fxButton.props.onClick();
		expect(onRefreshFx).toHaveBeenCalledOnce();
		expect(text(root)).toContain("settings.general.fxMissing");
		expect(text(root)).toContain("settings.general.notAvailable");
		expect(
			elements(root).some((element) => element.type === "refresh-icon"),
		).toBe(true);
		expect(
			elements(root).find((element) => element.type === "retention-panel")
				?.props,
		).toMatchObject({ value, onChange });

		harness.runEffects();
		await flushPromises();
		expect(fetchPricingRows).toHaveBeenCalledWith({
			provider: undefined,
			model: undefined,
			limit: 50,
			cursor: null,
		});
		expect(stateSlots.slice(0, 3)).toEqual([[], 0, null]);
		root = harness.render(props({ value, onChange, onRefreshFx }));
		expect(text(root)).toContain("settings.general.pricing.empty");
	});

	it("formats FX values and every pricing row display fallback", async () => {
		const rows = [
			{
				id: "codex",
				provider: "codex",
				model: "gpt-5.3-codex",
				currencyCode: "USD",
				inputPer1m: 1.23456789,
				cachedInputPer1m: null,
				outputPer1m: 12,
				sourceLabel: "Official",
				fetchedAt: "2026-08-09T01:02:03.000Z",
				manualOverride: false,
				enabled: true,
			},
			{
				id: "qwen",
				provider: "qwen",
				model: "qwen3",
				currencyCode: "JPY",
				inputPer1m: 100,
				cachedInputPer1m: undefined,
				outputPer1m: null,
				sourceLabel: null,
				fetchedAt: "invalid",
				manualOverride: true,
				enabled: true,
			},
			{
				id: "anthropic",
				provider: "anthropic",
				model: "claude",
				currencyCode: "EUR",
				inputPer1m: 2,
				cachedInputPer1m: 1,
				outputPer1m: 4,
				sourceLabel: "",
				fetchedAt: null,
				manualOverride: false,
				enabled: true,
			},
		];
		const initialState = [rows, 3, "100", "qwen", "  qwen3  ", 1];
		const harness = await createHarness(initialState);
		const value = generalValue({ language: "en" });
		const root = harness.render(
			props({
				value,
				fxCache: {
					source: "ecb",
					baseCurrency: "EUR",
					validOn: "2026-08-08",
					fetchedAt: "2026-08-09T00:00:00.000Z",
					rates: { EUR: 1, USD: 1.23456789, JPY: Number.NaN },
				},
			}),
		);
		const content = text(root).replace(/\s+/g, " ");
		expect(content).toContain("1 EUR");
		expect(content).toContain("1.234568 USD");
		expect(content).toContain("— JPY");
		expect(content).toContain("OpenAI Codex");
		expect(content).toContain("Qwen");
		expect(content).toContain("$1.234568");
		expect(content).toContain("100 JPY");
		expect(content).toContain("settings.general.pricing.manual");
		expect(content).toContain("Official");
		expect(content).toContain("settings.general.pricing.count");

		const providerSelect = requiredElement(
			root,
			(element) =>
				element.type === "select" &&
				element.props["aria-label"] === "settings.general.pricing.provider",
			"pricing provider",
		);
		providerSelect.props.onChange({ target: { value: "openai" } });
		expect(stateSlots[3]).toBe("openai");
		expect(stateSlots[5]).toBe(0);
		const modelInput = requiredElement(
			root,
			(element) =>
				element.type === "input" &&
				element.props["aria-label"] === "settings.general.pricing.modelSearch",
			"pricing model search",
		);
		modelInput.props.onChange({ target: { value: "gpt" } });
		expect(stateSlots[4]).toBe("gpt");
		expect(stateSlots[5]).toBe(0);

		byText(root, "settings.general.pricing.previous").props.onClick();
		expect(stateSlots[5]).toBe(0);
		byText(root, "settings.general.pricing.next").props.onClick();
		expect(stateSlots[5]).toBe(1);

		stateSlots[3] = "qwen";
		stateSlots[4] = "  qwen3  ";
		stateSlots[5] = 1;
		harness.render(props({ value }));
		harness.runEffects();
		await flushPromises();
		expect(fetchPricingRows).toHaveBeenCalledWith({
			provider: "qwen",
			model: "qwen3",
			limit: 50,
			cursor: "50",
		});
	});

	it("shows loading, importing, error, and success message states", async () => {
		const loadingHarness = await createHarness([
			[],
			0,
			null,
			"",
			"",
			0,
			true,
			true,
			"boom",
			"error",
		]);
		let root = loadingHarness.render(props());
		expect(text(root)).toContain("settings.general.pricing.loading");
		const alert = requiredElement(
			root,
			(element) => element.props.role === "alert",
			"pricing alert",
		);
		expect(text(alert)).toBe("boom");
		expect(
			elements(root).filter((element) => element.type === "refresh-icon"),
		).toHaveLength(2);
		expect(
			byText(root, "settings.general.pricing.refresh").props.disabled,
		).toBe(true);
		expect(byText(root, "settings.general.pricing.import").props.disabled).toBe(
			true,
		);
		expect(
			byText(root, "settings.general.pricing.previous").props.disabled,
		).toBe(true);

		stateSlots[6] = false;
		stateSlots[7] = false;
		stateSlots[8] = "imported";
		stateSlots[9] = "success";
		root = loadingHarness.render(props());
		expect(
			elements(root).find((element) => element.props.role === "status"),
		).toBeDefined();
		expect(text(root)).toContain("settings.general.pricing.empty");
		expect(text(root)).toContain("settings.general.pricing.countEmpty");
	});

	it("imports public pricing and reloads the current page", async () => {
		const harness = await createHarness();
		let root = harness.render(props());
		byText(root, "settings.general.pricing.import").props.onClick();
		await flushPromises();
		expect(importPublicPricingRows).toHaveBeenCalledOnce();
		expect(stateSlots[8]).toContain("settings.general.pricing.importSucceeded");
		expect(stateSlots[9]).toBe("success");
		expect(fetchPricingRows).toHaveBeenCalledOnce();
		expect(stateSlots[7]).toBe(false);

		root = harness.render(props());
		byText(root, "settings.general.pricing.refresh").props.onClick();
		await flushPromises();
		expect(fetchPricingRows).toHaveBeenCalledTimes(2);
	});

	it("reports HTTP and non-Error failures for loading and importing", async () => {
		const harness = await createHarness();
		fetchPricingRows.mockResolvedValueOnce(response({}, false, "load-http"));
		harness.render(props());
		harness.runEffects();
		await flushPromises();
		expect(stateSlots[8]).toBe("load-http");
		expect(stateSlots[9]).toBe("error");
		expect(stateSlots[6]).toBe(false);

		fetchPricingRows.mockRejectedValueOnce("load-string");
		harness.render(props());
		harness.runEffects();
		await flushPromises();
		expect(stateSlots[8]).toBe("load-string");

		importPublicPricingRows.mockResolvedValueOnce(
			response({}, false, "import-http"),
		);
		let root = harness.render(props());
		byText(root, "settings.general.pricing.import").props.onClick();
		await flushPromises();
		expect(stateSlots[8]).toBe("import-http");
		expect(stateSlots[9]).toBe("error");

		importPublicPricingRows.mockRejectedValueOnce("import-string");
		root = harness.render(props());
		byText(root, "settings.general.pricing.import").props.onClick();
		await flushPromises();
		expect(stateSlots[8]).toBe("import-string");
		expect(stateSlots[7]).toBe(false);
	});
});
