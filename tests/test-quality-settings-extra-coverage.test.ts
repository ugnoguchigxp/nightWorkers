import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../api/lib/errors";
import {
	DEFAULT_TEST_QUALITY_SETTINGS,
	getTestQualitySettingsPath,
	normalizeTestQualitySettings,
	QUALITY_SETTINGS_FILENAME,
	readTestQualitySettingsFile,
	writeTestQualitySettingsFile,
} from "../api/services/settings/test-quality-settings";

let repoRoot: string;

beforeEach(() => {
	repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nightworkers-quality-"));
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("test quality settings extra coverage", () => {
	it("resolves the repository-local settings path", () => {
		expect(getTestQualitySettingsPath(repoRoot)).toBe(
			path.join(repoRoot, QUALITY_SETTINGS_FILENAME),
		);
	});

	it("normalizes defaults, valid values, rounding, and numeric bounds", () => {
		expect(normalizeTestQualitySettings(null)).toEqual(
			DEFAULT_TEST_QUALITY_SETTINGS,
		);
		expect(
			normalizeTestQualitySettings({
				coverageGateEnabled: true,
				coverageMinimumPercent: 82.6,
				coverageMaxIterations: 7.4,
			}),
		).toEqual({
			coverageGateEnabled: true,
			coverageMinimumPercent: 83,
			coverageMaxIterations: 7,
		});
		expect(
			normalizeTestQualitySettings({
				coverageGateEnabled: "yes",
				coverageMinimumPercent: -10,
				coverageMaxIterations: 100,
			}),
		).toEqual({
			coverageGateEnabled: false,
			coverageMinimumPercent: 1,
			coverageMaxIterations: 20,
		});
		expect(
			normalizeTestQualitySettings({
				coverageMinimumPercent: Number.POSITIVE_INFINITY,
				coverageMaxIterations: Number.NaN,
			}),
		).toEqual(DEFAULT_TEST_QUALITY_SETTINGS);
		expect(
			normalizeTestQualitySettings({
				coverageMinimumPercent: 101,
				coverageMaxIterations: 0,
			}),
		).toMatchObject({
			coverageMinimumPercent: 100,
			coverageMaxIterations: 1,
		});
	});

	it.each([
		[{ apiKey: "secret" }, "apiKey"],
		[{ nested: { access_token: "secret" } }, "nested.access_token"],
		[{ values: [{ privateKey: "secret" }] }, "values.0.privateKey"],
	])("rejects credential-like keys at any depth", (input, keyPath) => {
		expect(() => normalizeTestQualitySettings(input)).toThrowError(
			expect.objectContaining({
				message: "nightworkers-quality.json must not contain credentials",
				details: expect.objectContaining({ keyPath }),
			}),
		);
	});

	it("returns defaults for a missing or non-object settings file", () => {
		expect(readTestQualitySettingsFile(repoRoot)).toEqual(
			DEFAULT_TEST_QUALITY_SETTINGS,
		);
		fs.writeFileSync(
			getTestQualitySettingsPath(repoRoot),
			JSON.stringify(["not", "an", "object"]),
		);
		expect(readTestQualitySettingsFile(repoRoot)).toEqual(
			DEFAULT_TEST_QUALITY_SETTINGS,
		);
	});

	it("reads normalized settings and rejects credentials in the envelope", () => {
		const settingsPath = getTestQualitySettingsPath(repoRoot);
		fs.writeFileSync(
			settingsPath,
			JSON.stringify({
				testQuality: {
					coverageGateEnabled: true,
					coverageMinimumPercent: 91,
					coverageMaxIterations: 4,
				},
			}),
		);
		expect(readTestQualitySettingsFile(repoRoot)).toEqual({
			coverageGateEnabled: true,
			coverageMinimumPercent: 91,
			coverageMaxIterations: 4,
		});

		fs.writeFileSync(
			settingsPath,
			JSON.stringify({ testQuality: {}, password: "secret" }),
		);
		expect(() => readTestQualitySettingsFile(repoRoot)).toThrow(
			ValidationError,
		);
	});

	it("wraps JSON syntax and filesystem read failures", () => {
		const settingsPath = getTestQualitySettingsPath(repoRoot);
		fs.writeFileSync(settingsPath, "{invalid json");
		expect(() => readTestQualitySettingsFile(repoRoot)).toThrowError(
			expect.objectContaining({
				message: "Failed to parse nightworkers-quality.json",
			}),
		);

		fs.rmSync(settingsPath);
		fs.mkdirSync(settingsPath);
		expect(() => readTestQualitySettingsFile(repoRoot)).toThrow(
			ValidationError,
		);
	});

	it("records non-Error parse failures in validation metadata", () => {
		fs.writeFileSync(getTestQualitySettingsPath(repoRoot), "{}");
		vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
			throw "parse stopped";
		});

		expect(() => readTestQualitySettingsFile(repoRoot)).toThrowError(
			expect.objectContaining({
				message: "Failed to parse nightworkers-quality.json",
				details: expect.objectContaining({ cause: "parse stopped" }),
			}),
		);
	});

	it("writes a canonical envelope that can be read back", () => {
		const written = writeTestQualitySettingsFile(repoRoot, {
			coverageGateEnabled: true,
			coverageMinimumPercent: 88.4,
			coverageMaxIterations: 2.6,
		});

		expect(written).toEqual({
			coverageGateEnabled: true,
			coverageMinimumPercent: 88,
			coverageMaxIterations: 3,
		});
		expect(readTestQualitySettingsFile(repoRoot)).toEqual(written);
		expect(fs.readFileSync(getTestQualitySettingsPath(repoRoot), "utf8")).toBe(
			`${JSON.stringify({ testQuality: written }, null, 2)}\n`,
		);
	});
});
