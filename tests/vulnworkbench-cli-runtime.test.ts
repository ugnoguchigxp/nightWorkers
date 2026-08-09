import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildVulnWorkbenchCliEnv,
	isVulnWorkbenchCliConfigured,
	resolveVulnWorkbenchBunExecutable,
} from "../api/services/vulnworkbench-cli-runtime";

let tempDir: string | null = null;

afterEach(async () => {
	if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
	tempDir = null;
});

describe("vulnWorkbench CLI runtime", () => {
	it("uses an explicit Bun executable instead of the packaged Node executable", () => {
		expect(
			resolveVulnWorkbenchBunExecutable({
				NIGHTWORKERS_BUN_EXECUTABLE: "/opt/tools/bun",
			}),
		).toBe("/opt/tools/bun");
	});

	it("reports configured only when the required CLI files exist", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "vulnworkbench-cli-"));
		await fs.mkdir(path.join(tempDir, "api/cli"), { recursive: true });
		await fs.writeFile(path.join(tempDir, "package.json"), "{}\n");
		const env = { NIGHTWORKERS_VULNWORKBENCH_CWD: tempDir };
		expect(isVulnWorkbenchCliConfigured(env)).toBe(false);
		await fs.writeFile(
			path.join(tempDir, "api/cli/oracle-security.ts"),
			"export {};\n",
		);
		expect(isVulnWorkbenchCliConfigured(env)).toBe(false);
		await fs.writeFile(
			path.join(tempDir, "api/cli/scan-profile.ts"),
			"export {};\n",
		);
		await fs.writeFile(
			path.join(tempDir, "api/cli/nightworkers-security-capabilities.ts"),
			"export {};\n",
		);
		expect(isVulnWorkbenchCliConfigured(env)).toBe(true);
		expect(
			isVulnWorkbenchCliConfigured({
				...env,
				NIGHTWORKERS_VULNWORKBENCH_ENABLED: "false",
			}),
		).toBe(false);
	});

	it("passes only the allowlisted environment variables", () => {
		const env = buildVulnWorkbenchCliEnv({
			PATH: "/custom/bin",
			LANG: "ja_JP.UTF-8",
			SECRET_TOKEN: "must-not-pass",
		});
		expect(env.LANG).toBe("ja_JP.UTF-8");
		expect(env.SECRET_TOKEN).toBeUndefined();
		expect(env.PATH).toContain("/custom/bin");
	});
});
