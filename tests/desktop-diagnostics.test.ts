import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectDesktopDiagnostics } from "../scripts/desktop/collect-diagnostics.mjs";

const roots: string[] = [];

function fixtureRoot() {
	const root = fs.mkdtempSync(
		path.join(os.tmpdir(), "nightworkers-desktop-diag-"),
	);
	roots.push(root);
	fs.writeFileSync(
		path.join(root, "package.json"),
		JSON.stringify({
			dependencies: { "@tauri-apps/api": "2.11.0" },
			devDependencies: { "@tauri-apps/cli": "2.11.2" },
		}),
	);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("desktop diagnostics", () => {
	it("writes allowlisted preflight evidence for the expected target", () => {
		const root = fixtureRoot();
		fs.mkdirSync(path.join(root, "dist"));
		const result = collectDesktopDiagnostics({
			root,
			mode: "preflight",
			expectedTarget: "darwin:arm64",
			platform: "darwin",
			arch: "arm64",
			env: {
				GITHUB_SHA: "a".repeat(40),
				GITHUB_RUN_ID: "123",
				GITHUB_RUN_ATTEMPT: "2",
				SECRET_VALUE: "must-not-be-recorded",
			},
			versionResolver: () => "fixture-version",
			now: new Date("2026-07-10T00:00:00.000Z"),
		});

		expect(fs.existsSync(result.outputPath)).toBe(true);
		expect(result.diagnostics).toMatchObject({
			schemaVersion: "nightworkers.desktop-diagnostics/v1",
			source: { commitSha: "a".repeat(40) },
			workflow: { runId: "123", runAttempt: 2 },
			runner: { actualTarget: "darwin:arm64", targetMatches: true },
		});
		expect(JSON.stringify(result.diagnostics)).not.toContain(
			"must-not-be-recorded",
		);
	});

	it("persists diagnostics before rejecting a runner target mismatch", () => {
		const root = fixtureRoot();

		expect(() =>
			collectDesktopDiagnostics({
				root,
				mode: "preflight",
				expectedTarget: "darwin:x64",
				platform: "darwin",
				arch: "arm64",
				env: { GITHUB_SHA: "b".repeat(40) },
				versionResolver: () => "fixture-version",
			}),
		).toThrow("expected=darwin:x64 actual=darwin:arm64");
		expect(
			fs.existsSync(path.join(root, "artifacts/desktop-preflight.json")),
		).toBe(true);
	});
});
