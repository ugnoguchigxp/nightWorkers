import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	getResourceRoot,
	getRuntimePaths,
	isDesktopMode,
} from "../api/runtime/paths";

describe("runtime paths", () => {
	it("keeps development runtime state under the fixed .nightworkers root", () => {
		const paths = getRuntimePaths({});
		expect(paths.runtimeRoot).toBe(
			path.resolve(process.cwd(), ".nightworkers"),
		);
		expect(paths.settingsDir).toBe(
			path.resolve(process.cwd(), ".nightworkers/settings"),
		);
		expect(paths.logsDir).toBe(
			path.resolve(process.cwd(), ".nightworkers/logs"),
		);
		const projectDigest = createHash("sha256")
			.update(path.resolve(process.cwd()))
			.digest("hex")
			.slice(0, 16);
		const bootstrapRoot = path.join(
			os.tmpdir(),
			"nightworkers",
			"workspace-bootstrap",
			projectDigest,
		);
		expect(paths.workspaceBootstrapTmpDir).toBe(
			path.join(bootstrapRoot, "tmp"),
		);
		expect(paths.workspaceBootstrapCacheDir).toBe(
			path.join(bootstrapRoot, "cache"),
		);
		expect(paths.workspaceBootstrapEnvironmentsDir).toBe(
			path.join(bootstrapRoot, "environments"),
		);
	});

	it("uses desktop runtime root for writable state", () => {
		const paths = getRuntimePaths({
			NIGHTWORKERS_DESKTOP: "1",
			NIGHTWORKERS_RUNTIME_DIR: "/tmp/nightworkers-app",
		});
		expect(paths.runtimeRoot).toBe("/tmp/nightworkers-app");
		expect(paths.settingsDir).toBe("/tmp/nightworkers-app/settings");
		expect(paths.logsDir).toBe("/tmp/nightworkers-app/logs");
		expect(paths.databasePath).toBe("/tmp/nightworkers-app/sqlite.db");
		expect(paths.workspaceBootstrapDir).toBe(
			"/tmp/nightworkers-app/workspace-bootstrap",
		);
	});

	it("defaults desktop runtime state to the project .nightworkers directory when no runtime dir is set", () => {
		const paths = getRuntimePaths({
			NIGHTWORKERS_DESKTOP: "1",
			NIGHTWORKERS_RESOURCE_DIR: "/repo/nightWorkers",
		});
		expect(paths.runtimeRoot).toBe("/repo/nightWorkers/.nightworkers");
		expect(paths.settingsDir).toBe("/repo/nightWorkers/.nightworkers/settings");
		expect(paths.logsDir).toBe("/repo/nightWorkers/.nightworkers/logs");
		expect(paths.databasePath).toBe(
			"/repo/nightWorkers/.nightworkers/sqlite.db",
		);
	});

	it("keeps bundled resources separate from runtime state", () => {
		expect(isDesktopMode({ NIGHTWORKERS_DESKTOP: "true" })).toBe(true);
		expect(
			getResourceRoot({ NIGHTWORKERS_RESOURCE_DIR: "/tmp/resources" }),
		).toBe("/tmp/resources");
	});
});
