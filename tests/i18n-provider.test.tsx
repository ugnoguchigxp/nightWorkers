import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let effectMode: "run" | "skip" = "run";
const mockChangeLanguage = vi.fn();

vi.mock("../src/i18n/setup", () => ({
	i18next: {
		changeLanguage: (lang: string) => mockChangeLanguage(lang),
	},
}));

// Mock react to execute useEffect synchronously during static rendering
vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useEffect: (callback: () => undefined | (() => void)) => {
			if (effectMode === "run") {
				callback();
			}
		},
	};
});

import { enDictionary } from "../src/i18n/dictionaries/en";
import { jaDictionary } from "../src/i18n/dictionaries/ja";
import { AppI18nProvider, applyAppLanguage } from "../src/i18n/I18nProvider";

describe("AppI18nProvider", () => {
	it("keeps Japanese and English translation keys aligned", () => {
		expect(Object.keys(enDictionary).sort()).toEqual(
			Object.keys(jaDictionary).sort(),
		);
	});

	beforeEach(() => {
		vi.clearAllMocks();
		effectMode = "run";
		const dummyDocEl = { lang: "" } as HTMLElement;
		vi.stubGlobal("document", {
			documentElement: dummyDocEl,
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("renders children successfully", () => {
		effectMode = "skip";
		const result = renderToStaticMarkup(
			<AppI18nProvider>
				<div id="child">Hello</div>
			</AppI18nProvider>,
		);
		expect(result).toContain("Hello");
	});

	it("applies application language successfully", async () => {
		await applyAppLanguage("ja");
		expect(mockChangeLanguage).toHaveBeenCalledWith("ja");
		expect(document.documentElement.lang).toBe("ja");
	});

	it("fetches settings and changes language when language is in response", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ language: "en" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		renderToStaticMarkup(
			<AppI18nProvider>
				<div>Test</div>
			</AppI18nProvider>,
		);

		// Allow async loadLanguage to run
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(fetchMock).toHaveBeenCalled();
		expect(mockChangeLanguage).toHaveBeenCalledWith("en");
	});

	it("does not change language if response is not ok", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ language: "en" }), {
				status: 400,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		renderToStaticMarkup(
			<AppI18nProvider>
				<div>Test</div>
			</AppI18nProvider>,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(fetchMock).toHaveBeenCalled();
		expect(mockChangeLanguage).not.toHaveBeenCalled();
	});

	it("does not change language if response lacks language field", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({}), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		renderToStaticMarkup(
			<AppI18nProvider>
				<div>Test</div>
			</AppI18nProvider>,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mockChangeLanguage).not.toHaveBeenCalled();
	});

	it("handles fetch rejection gracefully", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("Network error"));
		vi.stubGlobal("fetch", fetchMock);

		renderToStaticMarkup(
			<AppI18nProvider>
				<div>Test</div>
			</AppI18nProvider>,
		);

		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(mockChangeLanguage).not.toHaveBeenCalled();
	});
});
