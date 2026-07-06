import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_TEST_QUALITY_SETTINGS,
	QUALITY_SETTINGS_FILENAME,
	readTestQualitySettingsFile,
	writeTestQualitySettingsFile,
} from "../api/services/settings/test-quality-settings";

let tempDir: string | null = null;

function makeTempDir() {
	tempDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-test-quality-"),
	);
	return tempDir;
}

afterEach(() => {
	if (tempDir) {
		fs.rmSync(tempDir, { recursive: true, force: true });
		tempDir = null;
	}
});

describe("test quality settings", () => {
	it("returns defaults when nightworkers-quality.json does not exist", () => {
		const repoRoot = makeTempDir();

		expect(readTestQualitySettingsFile(repoRoot)).toEqual(
			DEFAULT_TEST_QUALITY_SETTINGS,
		);
	});

	it("writes normalized project-scoped test quality settings", () => {
		const repoRoot = makeTempDir();

		const saved = writeTestQualitySettingsFile(repoRoot, {
			coverageGateEnabled: true,
			coverageMinimumPercent: 82.4,
			coverageMaxIterations: 7.8,
		});

		expect(saved).toEqual({
			coverageGateEnabled: true,
			coverageMinimumPercent: 82,
			coverageMaxIterations: 8,
		});
		expect(readTestQualitySettingsFile(repoRoot)).toEqual(saved);
		expect(
			JSON.parse(
				fs.readFileSync(path.join(repoRoot, QUALITY_SETTINGS_FILENAME), "utf8"),
			),
		).toEqual({
			testQuality: saved,
		});
	});

	it("rejects credential-like keys", () => {
		const repoRoot = makeTempDir();

		expect(() =>
			writeTestQualitySettingsFile(repoRoot, {
				coverageGateEnabled: true,
				coverageMinimumPercent: 80,
				coverageMaxIterations: 5,
				apiKey: "secret",
			}),
		).toThrow(/must not contain credentials/);
	});
});
