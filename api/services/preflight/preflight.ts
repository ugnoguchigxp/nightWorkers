import fs from "node:fs";
import { config } from "../../config";
import {
	getResourceRoot,
	getRuntimePaths,
	isDesktopMode,
} from "../../runtime/paths";

export type PreflightCheckStatus = "pass" | "warn" | "fail";

export type PreflightCheck = {
	id: string;
	label: string;
	status: PreflightCheckStatus;
	detail: string;
};

export type StartupPreflightResult = {
	mode: "desktop" | "development";
	runtimeRoot: string;
	resourceRoot: string;
	checks: PreflightCheck[];
};

export function runStartupPreflight(): StartupPreflightResult {
	const paths = getRuntimePaths();
	const resourceRoot = getResourceRoot();
	const checks: PreflightCheck[] = [
		checkDirectory(
			"runtime-root",
			"Runtime root is writable",
			paths.runtimeRoot,
		),
		checkDirectory(
			"settings-dir",
			"Settings directory is writable",
			paths.settingsDir,
		),
		checkDirectory("logs-dir", "Logs directory is writable", paths.logsDir),
		checkDirectory(
			"resource-root",
			"Bundled resource root is readable",
			resourceRoot,
			"read",
		),
		{
			id: "database-url",
			label: "Database URL is configured",
			status: config.DATABASE_URL ? "pass" : "fail",
			detail: config.DATABASE_URL
				? redactFileUrl(config.DATABASE_URL)
				: "DATABASE_URL is empty.",
		},
		{
			id: "jwt-secret",
			label: "JWT secret is configured",
			status: config.JWT_SECRET.length >= 32 ? "pass" : "fail",
			detail:
				config.JWT_SECRET.length >= 32
					? "JWT secret is present and long enough."
					: "JWT_SECRET must be at least 32 characters.",
		},
	];

	return {
		mode: isDesktopMode() ? "desktop" : "development",
		runtimeRoot: paths.runtimeRoot,
		resourceRoot,
		checks,
	};
}

function checkDirectory(
	id: string,
	label: string,
	directory: string,
	mode: "read" | "write" = "write",
): PreflightCheck {
	try {
		if (!fs.existsSync(directory)) {
			if (mode === "read") {
				return {
					id,
					label,
					status: "fail",
					detail: `Directory does not exist: ${directory}`,
				};
			}
			fs.mkdirSync(directory, { recursive: true });
		}
		fs.accessSync(
			directory,
			mode === "write" ? fs.constants.W_OK : fs.constants.R_OK,
		);
		return { id, label, status: "pass", detail: directory };
	} catch (error) {
		return {
			id,
			label,
			status: "fail",
			detail: error instanceof Error ? error.message : String(error),
		};
	}
}

function redactFileUrl(value: string): string {
	if (!value.startsWith("file:")) return value;
	return `file:${value.slice("file:".length)}`;
}
