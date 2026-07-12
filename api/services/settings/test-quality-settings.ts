import fs from "node:fs";
import path from "node:path";
import { ValidationError } from "../../lib/errors";

export const QUALITY_SETTINGS_FILENAME = "nightworkers-quality.json";

export type TestQualitySettings = {
	coverageGateEnabled: boolean;
	coverageMinimumPercent: number;
	coverageMaxIterations: number;
};

export type TestQualitySettingsFile = {
	testQuality: TestQualitySettings;
};

export const DEFAULT_TEST_QUALITY_SETTINGS: TestQualitySettings = {
	coverageGateEnabled: false,
	coverageMinimumPercent: 80,
	coverageMaxIterations: 5,
};

const credentialKeyPattern =
	/(api[_-]?key|access[_-]?token|secret|password|credential|private[_-]?key)/i;

export function getTestQualitySettingsPath(repoRoot: string): string {
	const resolvedRoot = path.resolve(repoRoot);
	const settingsPath = path.resolve(resolvedRoot, QUALITY_SETTINGS_FILENAME);
	if (path.dirname(settingsPath) !== resolvedRoot) {
		throw new ValidationError("Invalid quality settings path");
	}
	return settingsPath;
}

export function normalizeTestQualitySettings(
	input: unknown,
): TestQualitySettings {
	assertNoCredentialLikeKeys(input);
	const value = isRecord(input) ? input : {};
	return {
		coverageGateEnabled:
			typeof value.coverageGateEnabled === "boolean"
				? value.coverageGateEnabled
				: DEFAULT_TEST_QUALITY_SETTINGS.coverageGateEnabled,
		coverageMinimumPercent: normalizeIntegerPercent(
			value.coverageMinimumPercent,
		),
		coverageMaxIterations: normalizeMaxIterations(value.coverageMaxIterations),
	};
}

export function readTestQualitySettingsFile(
	repoRoot: string,
): TestQualitySettings {
	const settingsPath = getTestQualitySettingsPath(repoRoot);
	if (!fs.existsSync(settingsPath)) return { ...DEFAULT_TEST_QUALITY_SETTINGS };

	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
	} catch (err) {
		throw new ValidationError("Failed to parse nightworkers-quality.json", {
			cause: err instanceof Error ? err.message : String(err),
		});
	}

	if (!isRecord(parsed)) return { ...DEFAULT_TEST_QUALITY_SETTINGS };
	assertNoCredentialLikeKeys(parsed);
	return normalizeTestQualitySettings(parsed.testQuality);
}

export function writeTestQualitySettingsFile(
	repoRoot: string,
	input: unknown,
): TestQualitySettings {
	const settings = normalizeTestQualitySettings(input);
	const settingsPath = getTestQualitySettingsPath(repoRoot);
	const payload: TestQualitySettingsFile = { testQuality: settings };
	fs.writeFileSync(
		settingsPath,
		`${JSON.stringify(payload, null, 2)}\n`,
		"utf8",
	);
	return settings;
}

function normalizeIntegerPercent(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_TEST_QUALITY_SETTINGS.coverageMinimumPercent;
	}
	return Math.min(100, Math.max(1, Math.round(value)));
}

function normalizeMaxIterations(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return DEFAULT_TEST_QUALITY_SETTINGS.coverageMaxIterations;
	}
	return Math.min(20, Math.max(1, Math.round(value)));
}

function assertNoCredentialLikeKeys(
	value: unknown,
	pathParts: string[] = [],
): void {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoCredentialLikeKeys(item, [...pathParts, String(index)]);
		}
		return;
	}
	if (!isRecord(value)) return;

	for (const [key, child] of Object.entries(value)) {
		if (credentialKeyPattern.test(key)) {
			throw new ValidationError(
				"nightworkers-quality.json must not contain credentials",
				{
					keyPath: [...pathParts, key].join("."),
				},
			);
		}
		assertNoCredentialLikeKeys(child, [...pathParts, key]);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

