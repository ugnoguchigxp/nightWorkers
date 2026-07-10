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
			"platform: linux",
			"platform: windows",
			"desktop:prepare-sidecar",
			"desktop:smoke-sidecar",
			"desktop:smoke",
			"actions/upload-artifact@v4",
		]) {
			expect(workflow).toContain(value);
		}
	});
});
