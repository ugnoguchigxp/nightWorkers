import fs from "node:fs";
import { config } from "../../config";
import {
	getResourceRoot,
	getRuntimePaths,
	isDesktopMode,
} from "../../runtime/paths";
import { assessListenSecurity } from "../../security/listen-security";

export type PreflightCheckStatus = "pass" | "warn" | "fail";

export type PreflightCheck = {
	id: string;
	label: string;
	status: PreflightCheckStatus;
	detail: string;
};

export type StartupPreflightResult = {
	mode: "desktop" | "development" | "production";
	runtimeRoot: string;
	resourceRoot: string;
	checks: PreflightCheck[];
};

export function runStartupPreflight(): StartupPreflightResult {
	const paths = getRuntimePaths();
	const resourceRoot = getResourceRoot();
	const listenSecurity = assessListenSecurity({
		host: config.HOST,
		corsOrigins: config.CORS_ORIGINS,
	});
	const checks: PreflightCheck[] = [
		{
			id: "listen-security",
			label: "Listen host is loopback-only",
			status: listenSecurity.status,
			detail: listenSecurity.detail,
		},
		{
			id: "cors-origins",
			label: "CORS uses explicit origins",
			status:
				config.CORS_ORIGINS.length > 0 && !config.CORS_ORIGINS.includes("*")
					? "pass"
					: "fail",
			detail: config.CORS_ORIGINS.join(", ") || "No CORS origin configured.",
		},
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
	];

	return {
		mode: isDesktopMode()
			? "desktop"
			: config.NODE_ENV === "production"
				? "production"
				: "development",
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
