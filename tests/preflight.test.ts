import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../api/config";
import { runStartupPreflight } from "../api/services/preflight/preflight";

describe("startup preflight", () => {
	const originalDatabaseUrl = config.DATABASE_URL;

	beforeEach(() => {
		config.DATABASE_URL = "file:sqlite.db";
	});

	afterEach(() => {
		config.DATABASE_URL = originalDatabaseUrl;
		vi.restoreAllMocks();
	});

	it("reports runtime and resource checks in development mode", () => {
		const result = runStartupPreflight();
		expect(result.mode).toBe("development");
		expect(result.runtimeRoot).toBeTruthy();
		expect(result.resourceRoot).toBeTruthy();
		expect(result.checks.find((c) => c.id === "listen-security")?.status).toBe(
			"pass",
		);
		expect(result.checks.find((c) => c.id === "database-url")?.status).toBe(
			"pass",
		);
	});

	it("reports desktop mode when NIGHTWORKERS_DESKTOP env is set", () => {
		vi.stubEnv("NIGHTWORKERS_DESKTOP", "1");
		const result = runStartupPreflight();
		expect(result.mode).toBe("desktop");
	});

	it("returns fail status if DATABASE_URL is empty", () => {
		config.DATABASE_URL = "";
		const result = runStartupPreflight();
		const dbCheck = result.checks.find((check) => check.id === "database-url");
		expect(dbCheck?.status).toBe("fail");
		expect(dbCheck?.detail).toBe("DATABASE_URL is empty.");
	});

	it("returns non-file URL as is during database url check", () => {
		config.DATABASE_URL = "postgres://localhost/db";
		const result = runStartupPreflight();
		const dbCheck = result.checks.find((check) => check.id === "database-url");
		expect(dbCheck?.status).toBe("pass");
		expect(dbCheck?.detail).toBe("postgres://localhost/db");
	});

	it("returns fail if directory check fails on existence check for read mode", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);
		const result = runStartupPreflight();
		const resourceCheck = result.checks.find((c) => c.id === "resource-root");
		expect(resourceCheck?.status).toBe("fail");
		expect(resourceCheck?.detail).toContain("Directory does not exist");
	});

	it("handles mkdirSync and accessSync errors in checkDirectory", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(false);
		vi.spyOn(fs, "mkdirSync").mockImplementation(() => {
			throw new Error("mkdir failed");
		});
		const result = runStartupPreflight();
		const runtimeCheck = result.checks.find((c) => c.id === "runtime-root");
		expect(runtimeCheck?.status).toBe("fail");
		expect(runtimeCheck?.detail).toBe("mkdir failed");
	});

	it("handles accessSync permission errors in checkDirectory", () => {
		vi.spyOn(fs, "existsSync").mockReturnValue(true);
		vi.spyOn(fs, "accessSync").mockImplementation(() => {
			throw new Error("Permission denied");
		});
		const result = runStartupPreflight();
		const runtimeCheck = result.checks.find((c) => c.id === "runtime-root");
		expect(runtimeCheck?.status).toBe("fail");
		expect(runtimeCheck?.detail).toBe("Permission denied");
	});
});
