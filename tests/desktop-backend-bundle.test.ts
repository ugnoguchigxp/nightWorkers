import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop backend bundle", () => {
	it("builds an ESM bundle that passes Node syntax validation", () => {
		const build = spawnSync(
			process.execPath,
			["scripts/desktop/build-backend.mjs"],
			{
				cwd: process.cwd(),
				encoding: "utf8",
			},
		);
		expect(build.status, build.stderr || build.stdout).toBe(0);

		const bundlePath = path.join(process.cwd(), "dist-api-desktop/index.js");
		expect(fs.existsSync(bundlePath)).toBe(true);
		const syntaxCheck = spawnSync(process.execPath, ["--check", bundlePath], {
			encoding: "utf8",
		});
		expect(syntaxCheck.status, syntaxCheck.stderr || syntaxCheck.stdout).toBe(
			0,
		);
	});
});
