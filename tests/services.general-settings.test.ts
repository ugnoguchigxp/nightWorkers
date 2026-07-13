import fs from "node:fs";
import path from "node:path";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { client } from "../api/db/client";
import { writeApplicationSetting } from "../api/services/settings/application-settings-store";

// Define custom setting paths inside the workspace directory
const TEMP_DIR = path.resolve(process.cwd(), "tests/temp-settings-test");
const GENERAL_SETTINGS_FILE = path.join(TEMP_DIR, "general-settings.json");
const _FX_CACHE_FILE = path.join(TEMP_DIR, "fx-rates.json");

vi.hoisted(() => {
	const tempDir = `${process.cwd()}/tests/temp-settings-test`;
	process.env.NIGHTWORKERS_GENERAL_SETTINGS_PATH = `${tempDir}/general-settings.json`;
	process.env.NIGHTWORKERS_FX_RATES_PATH = `${tempDir}/fx-rates.json`;
});

// Import the service after env variables are stubbed in hoisted
import {
	convertCurrency,
	DEFAULT_GENERAL_SETTINGS,
	normalizeGeneralSettings,
	readFxRateCache,
	readGeneralSettings,
	refreshEcbFxRates,
	refreshFxRatesIfNeeded,
	shouldRefreshFxRateCache,
	validateTimezone,
	writeFxRateCache,
	writeGeneralSettings,
} from "../api/services/settings/general-settings";

describe("general-settings service", () => {
	beforeEach(async () => {
		vi.stubGlobal("fetch", vi.fn());
		await client.execute(
			"DELETE FROM application_settings WHERE scope IN ('general', 'fx-cache')",
		);
		// Ensure clean directory
		if (fs.existsSync(TEMP_DIR)) {
			fs.rmSync(TEMP_DIR, { recursive: true, force: true });
		}
		fs.mkdirSync(TEMP_DIR, { recursive: true });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	afterAll(() => {
		// Clean up temporary files
		if (fs.existsSync(TEMP_DIR)) {
			fs.rmSync(TEMP_DIR, { recursive: true, force: true });
		}
	});

	describe("readGeneralSettings", () => {
		it("returns default settings when file does not exist", () => {
			const settings = readGeneralSettings();
			expect(settings).toEqual(DEFAULT_GENERAL_SETTINGS);
		});

		it("reads and normalizes persisted settings", () => {
			writeApplicationSetting("general", {
				timezone: "America/New_York",
				language: "en",
				currency: "USD",
				fx: {
					source: "manual",
					autoRefresh: false,
					lastRefreshedAt: "2026-06-10T12:00:00Z",
				},
			});
			const settings = readGeneralSettings();
			expect(settings.timezone).toBe("America/New_York");
			expect(settings.language).toBe("en");
			expect(settings.currency).toBe("USD");
			expect(settings.fx).toEqual({
				source: "manual",
				autoRefresh: false,
				lastRefreshedAt: "2026-06-10T12:00:00Z",
			});
			expect(settings.planMode).toEqual(DEFAULT_GENERAL_SETTINGS.planMode);
			expect(settings.llmUsage).toEqual(DEFAULT_GENERAL_SETTINGS.llmUsage);
			expect(settings.dataRetention).toEqual(
				DEFAULT_GENERAL_SETTINGS.dataRetention,
			);
		});

		it("returns defaults if file contains invalid JSON", () => {
			fs.writeFileSync(GENERAL_SETTINGS_FILE, "invalid-json");
			const settings = readGeneralSettings();
			expect(settings).toEqual(DEFAULT_GENERAL_SETTINGS);
		});
	});

	describe("writeGeneralSettings", () => {
		it("normalizes and writes settings to SQLite", () => {
			const input = {
				timezone: "Europe/Paris",
				language: "en" as const,
				currency: "EUR" as const,
				fx: {
					source: "ecb" as const,
					autoRefresh: true,
					lastRefreshedAt: null,
				},
				llmUsage: {
					promptPartObservabilityEnabled: false,
				},
			};
			const result = writeGeneralSettings(input);
			expect(result).toEqual({
				...input,
				planMode: DEFAULT_GENERAL_SETTINGS.planMode,
				dataRetention: DEFAULT_GENERAL_SETTINGS.dataRetention,
			});
			expect(readGeneralSettings()).toEqual({
				...input,
				planMode: DEFAULT_GENERAL_SETTINGS.planMode,
				dataRetention: DEFAULT_GENERAL_SETTINGS.dataRetention,
			});
		});
	});

	describe("normalizeGeneralSettings", () => {
		it("defaults prompt part observability to enabled", () => {
			const settings = normalizeGeneralSettings({});
			expect(settings.llmUsage.promptPartObservabilityEnabled).toBe(true);
		});

		it("preserves disabled prompt part observability", () => {
			const settings = normalizeGeneralSettings({
				llmUsage: { promptPartObservabilityEnabled: false },
			});
			expect(settings.llmUsage.promptPartObservabilityEnabled).toBe(false);
		});

		it("keeps the fixed retention periods and rejects invalid capacity relationships", () => {
			const settings = normalizeGeneralSettings({
				dataRetention: {
					...DEFAULT_GENERAL_SETTINGS.dataRetention,
					apiLogMaxBytes: 100,
					runtimeLogsMaxBytes: 50,
				},
			});
			expect(settings.dataRetention.apiLogDays).toBe(7);
			expect(settings.dataRetention.llmRawLogDays).toBe(3);
			expect(settings.dataRetention.usageDataDays).toBe(30);
			expect(settings.dataRetention.auditEventDays).toBe(90);
			expect(settings.dataRetention.apiLogMaxBytes).toBe(
				DEFAULT_GENERAL_SETTINGS.dataRetention.apiLogMaxBytes,
			);
		});
	});

	describe("readFxRateCache and writeFxRateCache", () => {
		const sampleCache = {
			source: "ecb" as const,
			baseCurrency: "EUR" as const,
			validOn: "2026-06-10",
			fetchedAt: "2026-06-10T12:00:00Z",
			rates: { EUR: 1, USD: 1.1, JPY: 130 },
		};

		it("returns null if no FX cache file exists", () => {
			expect(readFxRateCache()).toBeNull();
		});

		it("reads and writes FX rate cache and updates general settings lastRefreshedAt", () => {
			writeFxRateCache(sampleCache);
			expect(readFxRateCache()).toEqual(sampleCache);

			// Verify general settings were updated
			const settings = readGeneralSettings();
			expect(settings.fx.lastRefreshedAt).toBe(sampleCache.fetchedAt);
			expect(settings.fx.source).toBe("ecb");
		});
	});

	describe("refreshEcbFxRates", () => {
		it("fetches ECB XML, parses it, and writes/returns FX cache", async () => {
			const mockXml = `
        <gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
          <Cube>
            <Cube time="2026-06-10">
              <Cube currency="USD" rate="1.085"/>
              <Cube currency="JPY" rate="168.50"/>
            </Cube>
          </Cube>
        </gesmes:Envelope>
      `;

			const fetchMock = vi.mocked(fetch);
			fetchMock.mockResolvedValueOnce(new Response(mockXml, { status: 200 }));

			const result = await refreshEcbFxRates();
			expect(fetchMock).toHaveBeenCalledWith(
				"https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			);
			expect(result.source).toBe("ecb");
			expect(result.validOn).toBe("2026-06-10");
			expect(result.rates).toEqual({
				EUR: 1,
				USD: 1.085,
				JPY: 168.5,
			});

			// Verify general settings got updated with ECB source
			const settings = readGeneralSettings();
			expect(settings.fx.source).toBe("ecb");
			expect(settings.fx.lastRefreshedAt).toBe(result.fetchedAt);
		});

		it("throws if fetch fails", async () => {
			const fetchMock = vi.mocked(fetch);
			fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

			await expect(refreshEcbFxRates()).rejects.toThrow(
				"ECB FX refresh failed: 500",
			);
		});

		it("uses current ISO date if validOn xml match fails", async () => {
			const mockXml = `
        <gesmes:Envelope>
          <Cube>
            <Cube time="">
              <Cube currency="USD" rate="1.085"/>
            </Cube>
          </Cube>
        </gesmes:Envelope>
      `;
			const fetchMock = vi.mocked(fetch);
			fetchMock.mockResolvedValueOnce(new Response(mockXml, { status: 200 }));

			const result = await refreshEcbFxRates();
			expect(result.validOn).toBeDefined();
			expect(result.rates.USD).toBe(1.085);
		});
	});

	describe("refreshFxRatesIfNeeded", () => {
		const currentCache = {
			source: "ecb" as const,
			baseCurrency: "EUR" as const,
			validOn: "2026-07-13",
			fetchedAt: "2026-07-13T00:00:00Z",
			rates: { EUR: 1, USD: 1.1, JPY: 170 },
		};

		it("recognizes missing, invalid, stale, and current caches", () => {
			const now = new Date("2026-07-14T00:00:00Z");
			expect(shouldRefreshFxRateCache(null, now)).toBe(true);
			expect(
				shouldRefreshFxRateCache(
					{ ...currentCache, fetchedAt: "invalid" },
					now,
				),
			).toBe(true);
			expect(
				shouldRefreshFxRateCache(
					{ ...currentCache, rates: { EUR: 1, USD: 1.1 } },
					now,
				),
			).toBe(true);
			expect(shouldRefreshFxRateCache(currentCache, now)).toBe(true);
			expect(
				shouldRefreshFxRateCache(
					{ ...currentCache, fetchedAt: "2026-07-13T12:00:00Z" },
					now,
				),
			).toBe(false);
		});

		it("does not fetch when automatic refresh is disabled", async () => {
			const result = await refreshFxRatesIfNeeded({
				settings: {
					...DEFAULT_GENERAL_SETTINGS,
					fx: { ...DEFAULT_GENERAL_SETTINGS.fx, autoRefresh: false },
				},
				cache: null,
			});

			expect(result).toEqual({ status: "disabled", cache: null });
			expect(fetch).not.toHaveBeenCalled();
		});

		it("does not fetch a current cache", async () => {
			const result = await refreshFxRatesIfNeeded({
				settings: DEFAULT_GENERAL_SETTINGS,
				cache: currentCache,
				now: new Date("2026-07-13T12:00:00Z"),
			});

			expect(result).toEqual({ status: "current", cache: currentCache });
			expect(fetch).not.toHaveBeenCalled();
		});

		it("fetches and persists a missing cache when automatic refresh is enabled", async () => {
			vi.mocked(fetch).mockResolvedValueOnce(
				new Response(
					'<Cube time="2026-07-13"><Cube currency="USD" rate="1.1"/><Cube currency="JPY" rate="170"/></Cube>',
					{ status: 200 },
				),
			);

			const result = await refreshFxRatesIfNeeded({
				settings: DEFAULT_GENERAL_SETTINGS,
				cache: null,
			});

			expect(result.status).toBe("refreshed");
			expect(result.cache.rates).toEqual({ EUR: 1, USD: 1.1, JPY: 170 });
			expect(readFxRateCache()).toEqual(result.cache);
		});
	});

	describe("convertCurrency", () => {
		const sampleCache = {
			source: "ecb" as const,
			baseCurrency: "EUR" as const,
			validOn: "2026-06-10",
			fetchedAt: "2026-06-10T12:00:00Z",
			rates: { EUR: 1, USD: 1.1, JPY: 130 },
		};

		it("returns amount and rate 1 when converting same currency", () => {
			const res = convertCurrency({
				amount: 100,
				from: "USD",
				to: "USD",
				cache: null,
			});
			expect(res).toEqual({ amount: 100, rate: 1 });
		});

		it("returns null values if cache is missing and currencies differ", () => {
			const res = convertCurrency({
				amount: 100,
				from: "EUR",
				to: "USD",
				cache: null,
			});
			expect(res).toEqual({ amount: null, rate: null });
		});

		it("converts currencies correctly using the cache rates", () => {
			// EUR to USD: rate should be 1.1 / 1 = 1.1
			const res1 = convertCurrency({
				amount: 100,
				from: "EUR",
				to: "USD",
				cache: sampleCache,
			});
			expect(res1.rate).toBeCloseTo(1.1);
			expect(res1.amount).toBeCloseTo(110);

			// USD to JPY: rate should be 130 / 1.1 = 118.1818
			const res2 = convertCurrency({
				amount: 10,
				from: "USD",
				to: "JPY",
				cache: sampleCache,
			});
			expect(res2.rate).toBeCloseTo(118.1818, 4);
			expect(res2.amount).toBeCloseTo(1181.818, 3);
		});

		it("returns null values if a currency is missing in rates", () => {
			const res = convertCurrency({
				amount: 100,
				from: "EUR",
				to: "USD",
				cache: {
					...sampleCache,
					rates: { EUR: 1 }, // USD rate is missing
				},
			});
			expect(res).toEqual({ amount: null, rate: null });
		});
	});

	describe("validateTimezone", () => {
		it("returns true for valid timezone strings and false for invalid ones", () => {
			expect(validateTimezone("Asia/Tokyo")).toBe(true);
			expect(validateTimezone("UTC")).toBe(true);
			expect(validateTimezone("America/New_York")).toBe(true);
			expect(validateTimezone("Invalid/Timezone")).toBe(false);
			expect(validateTimezone("")).toBe(false);
		});
	});

	describe("normalizeGeneralSettings", () => {
		it("returns default settings when given empty object", () => {
			expect(normalizeGeneralSettings({})).toEqual(DEFAULT_GENERAL_SETTINGS);
		});

		it("preserves valid timezone, language, currency", () => {
			const res = normalizeGeneralSettings({
				timezone: "Europe/London",
				language: "en",
				currency: "EUR",
			});
			expect(res.timezone).toBe("Europe/London");
			expect(res.language).toBe("en");
			expect(res.currency).toBe("EUR");
		});

		it("resets invalid timezone, language, currency to defaults", () => {
			const res = normalizeGeneralSettings({
				timezone: "Bad/Timezone",
				language: "fr" as never,
				currency: "CAD" as never,
			});
			expect(res.timezone).toBe(DEFAULT_GENERAL_SETTINGS.timezone);
			expect(res.language).toBe(DEFAULT_GENERAL_SETTINGS.language);
			expect(res.currency).toBe(DEFAULT_GENERAL_SETTINGS.currency);
		});

		it("normalizes fx options", () => {
			const res1 = normalizeGeneralSettings({
				fx: {
					source: "manual",
					autoRefresh: false,
					lastRefreshedAt: "2026-06-10T00:00:00Z",
				},
			});
			expect(res1.fx).toEqual({
				source: "manual",
				autoRefresh: false,
				lastRefreshedAt: "2026-06-10T00:00:00Z",
			});

			const res2 = normalizeGeneralSettings({
				fx: {
					source: "invalid-source" as never,
					autoRefresh: "not-a-boolean" as never,
					lastRefreshedAt: 12345 as never,
				},
			});
			expect(res2.fx).toEqual({
				source: "ecb",
				autoRefresh: DEFAULT_GENERAL_SETTINGS.fx.autoRefresh,
				lastRefreshedAt: null,
			});
		});
	});
});
