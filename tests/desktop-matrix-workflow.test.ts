import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("desktop OS matrix workflow", () => {
	it("keeps macOS, Linux, and Windows as independent fail-visible jobs", () => {
		const workflow = fs.readFileSync(
			".github/workflows/desktop-matrix.yml",
			"utf8",
		);
		expect(workflow).toContain("fail-fast: false");
		for (const value of [
			"platform: macos",
			"target: darwin:arm64",
			"platform: linux",
			"platform: windows",
			"collect-diagnostics.mjs preflight",
			"build:frontend",
			"desktop:prepare-sidecar",
			"desktop:smoke-sidecar",
			"desktop:smoke",
			"collect-diagnostics.mjs postmortem",
			"actions/upload-artifact@v7",
		]) {
			expect(workflow).toContain(value);
		}
	});
});
