import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDesktopRuntimeBootstrap } from "../api/runtime/bootstrap";
import { getRuntimePaths } from "../api/runtime/paths";

const tempDirs: string[] = [];

function makeRuntimeDir() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nightworkers-runtime-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("desktop runtime bootstrap", () => {
	it("creates desktop defaults without requiring .env values", () => {
		const runtimeDir = makeRuntimeDir();
		const env: NodeJS.ProcessEnv = {
			NIGHTWORKERS_DESKTOP: "1",
			NIGHTWORKERS_RUNTIME_DIR: runtimeDir,
			PORT: "40123",
		};

		ensureDesktopRuntimeBootstrap(env);
		const paths = getRuntimePaths(env);

		expect(env.DATABASE_URL).toBe(`file:${path.join(runtimeDir, "sqlite.db")}`);
		expect(env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
		expect(env.AUTH_MODE).toBe("local");
		expect(env.API_AUTH_REQUIRED).toBe("false");
		expect(env.APP_URL).toBe("http://127.0.0.1:40123");
		expect(fs.existsSync(paths.settingsDir)).toBe(true);
		expect(fs.existsSync(paths.logsDir)).toBe(true);
		expect(fs.existsSync(path.join(paths.secretsDir, "jwt-secret"))).toBe(true);
	});

	it("defaults desktop runtime files under the resource root data directory", () => {
		const resourceDir = makeRuntimeDir();
		const env: NodeJS.ProcessEnv = {
			NIGHTWORKERS_DESKTOP: "1",
			NIGHTWORKERS_RESOURCE_DIR: resourceDir,
			PORT: "40124",
		};

		ensureDesktopRuntimeBootstrap(env);
		const paths = getRuntimePaths(env);

		expect(paths.runtimeRoot).toBe(path.join(resourceDir, "data"));
		expect(env.DATABASE_URL).toBe(
			`file:${path.join(resourceDir, "data/sqlite.db")}`,
		);
		expect(fs.existsSync(paths.runtimeRoot)).toBe(true);
		expect(fs.existsSync(paths.settingsDir)).toBe(true);
		expect(fs.existsSync(paths.logsDir)).toBe(true);
	});

	it("preserves configured desktop CORS origins while adding required defaults", () => {
		const runtimeDir = makeRuntimeDir();
		const env: NodeJS.ProcessEnv = {
			NIGHTWORKERS_DESKTOP: "1",
			NIGHTWORKERS_RUNTIME_DIR: runtimeDir,
			PORT: "40125",
			CORS_ORIGIN: "http://127.0.0.1:39174,http://tauri.localhost",
		};

		ensureDesktopRuntimeBootstrap(env);

		expect(env.CORS_ORIGIN).toBe(
			[
				"http://127.0.0.1:40125",
				"http://tauri.localhost",
				"tauri://localhost",
				"http://127.0.0.1:39174",
			].join(","),
		);
	});

	it("reuses a generated JWT secret on the next bootstrap", () => {
		const runtimeDir = makeRuntimeDir();
		const firstEnv: NodeJS.ProcessEnv = {
			NIGHTWORKERS_DESKTOP: "1",
			NIGHTWORKERS_RUNTIME_DIR: runtimeDir,
		};
		ensureDesktopRuntimeBootstrap(firstEnv);

		const secondEnv: NodeJS.ProcessEnv = {
			NIGHTWORKERS_DESKTOP: "1",
			NIGHTWORKERS_RUNTIME_DIR: runtimeDir,
		};
		ensureDesktopRuntimeBootstrap(secondEnv);

		expect(secondEnv.JWT_SECRET).toBe(firstEnv.JWT_SECRET);
	});
});
