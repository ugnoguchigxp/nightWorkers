import path from "node:path";
import pino from "pino";
import { getRuntimePaths } from "../runtime/paths";
import {
	DEFAULT_RUNTIME_LOG_RETENTION,
	type RuntimeLogRetentionConfig,
	RuntimeLogWriter,
} from "../runtime/runtime-log-writer";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function shouldLog(level: LogLevel): boolean {
	const configured = (
		process.env.LOG_LEVEL || "info"
	).toLowerCase() as LogLevel;
	const configuredRank = levelRank[configured] ?? levelRank.info;
	return levelRank[level] >= configuredRank;
}

function nowLabel(): string {
	const d = new Date();
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	return `${hh}:${mm}:${ss}`;
}

function levelLabel(level: LogLevel): string {
	if (level === "debug") return "Debug";
	if (level === "warn") return "Warn";
	if (level === "error") return "Error";
	return "Info";
}

function inlineMeta(meta?: Record<string, unknown>): string {
	if (!meta || Object.keys(meta).length === 0) return "";
	const pairs = Object.entries(meta)
		.filter(([, value]) => value !== undefined)
		.map(
			([key, value]) =>
				`${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
		);
	if (pairs.length === 0) return "";
	return ` ${pairs.join(" ")}`;
}

const LOG_DIR = getRuntimePaths().logsDir;
const API_LOG_PATH = path.join(LOG_DIR, "api.log");
const TRACE_LOG_PATH = path.join(LOG_DIR, "supervisor-trace.log");
const LLM_TRACE_LOG_PATH = path.join(LOG_DIR, "llm-trace.jsonl");

let runtimeLogRetention: RuntimeLogRetentionConfig = {
	...DEFAULT_RUNTIME_LOG_RETENTION,
};
const runtimeLogWriter = new RuntimeLogWriter(
	LOG_DIR,
	() => runtimeLogRetention,
);

export function configureRuntimeLogRetention(
	settings: RuntimeLogRetentionConfig,
) {
	runtimeLogRetention = { ...settings };
}

export function sweepRuntimeLogs() {
	return runtimeLogWriter.sweep();
}

export function flushRuntimeLogs() {
	return runtimeLogWriter.flush();
}

function appendLogFile(filePath: string, line: string) {
	const kind =
		filePath === API_LOG_PATH
			? "api"
			: filePath === TRACE_LOG_PATH
				? "supervisor"
				: "llm";
	void runtimeLogWriter.append(kind, line).catch(() => {});
}

function boundedText(value: string, maxBytes: number) {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	const suffix = "\n...[truncated]...\n";
	const available = Math.max(0, maxBytes - Buffer.byteLength(suffix, "utf8"));
	const headBytes = Math.floor(available / 2);
	const tailBytes = available - headBytes;
	const bytes = Buffer.from(value, "utf8");
	return `${bytes.subarray(0, headBytes).toString("utf8")}${suffix}${bytes.subarray(Math.max(0, bytes.length - tailBytes)).toString("utf8")}`;
}

function boundedLlmTraceLine(event: string, payload: Record<string, unknown>) {
	const original = { timestamp: new Date().toISOString(), event, ...payload };
	const record: Record<string, unknown> = { ...original };
	for (const key of ["systemPrompt", "userPrompt", "rawContent"] as const) {
		if (typeof record[key] !== "string") continue;
		const originalBytes = Buffer.byteLength(record[key], "utf8");
		if (originalBytes <= 512 * 1024) continue;
		record[key] = boundedText(record[key] as string, 512 * 1024);
		record[`${key}Truncated`] = true;
		record[`${key}OriginalBytes`] = originalBytes;
	}
	let line = JSON.stringify(record);
	if (Buffer.byteLength(line, "utf8") <= 2 * 1024 * 1024) return line;
	if (record.providerDebug !== undefined) {
		record.providerDebug = { truncated: true };
		record.providerDebugTruncated = true;
		line = JSON.stringify(record);
	}
	if (Buffer.byteLength(line, "utf8") <= 2 * 1024 * 1024) return line;
	for (const key of ["systemPrompt", "userPrompt", "rawContent"] as const) {
		if (typeof record[key] === "string")
			record[key] = boundedText(record[key] as string, 128 * 1024);
	}
	line = JSON.stringify(record);
	if (Buffer.byteLength(line, "utf8") <= 2 * 1024 * 1024) return line;
	return JSON.stringify({
		timestamp: original.timestamp,
		event,
		callId: payload.callId ?? null,
		provider: payload.provider ?? null,
		label: payload.label ?? null,
		truncated: true,
		originalBytes: Buffer.byteLength(line, "utf8"),
	});
}

export function logHttpEvent(params: {
	channel?: string;
	level?: LogLevel;
	method: string;
	path: string;
	message: string;
	meta?: Record<string, unknown>;
}) {
	const channel = params.channel || "api";
	const level = params.level || "info";
	if (!shouldLog(level)) return;
	const line = `[${channel}]${nowLabel()} [${params.method}]${params.path} ${levelLabel(level)}: ${params.message}${inlineMeta(params.meta)}`;
	// eslint-disable-next-line no-console
	console.log(line);
	appendLogFile(API_LOG_PATH, line);
}

export function logEvent(params: {
	channel?: string;
	level?: LogLevel;
	message: string;
	meta?: Record<string, unknown>;
}) {
	const channel = params.channel || "api";
	const level = params.level || "info";
	if (!shouldLog(level)) return;
	const line = `[${channel}]${nowLabel()} ${levelLabel(level)}: ${params.message}${inlineMeta(params.meta)}`;
	// eslint-disable-next-line no-console
	console.log(line);
	appendLogFile(API_LOG_PATH, line);
}

// LLM behavior is intentionally emitted as JSON for full-fidelity debugging.
export const llmLogger = pino({
	level: process.env.LOG_LEVEL || "info",
	base: { channel: "llm" },
	timestamp: pino.stdTimeFunctions.isoTime,
});

// Backward-compatible alias for existing imports.
export const logger = llmLogger;

export function appendSupervisorTrace(
	event: string,
	payload?: Record<string, unknown>,
) {
	const line = `[${new Date().toISOString()}] ${event}${payload ? ` ${JSON.stringify(payload)}` : ""}\n`;
	appendLogFile(TRACE_LOG_PATH, line.trimEnd());
}

export function appendLlmTrace(
	event: string,
	payload: Record<string, unknown>,
) {
	const line = boundedLlmTraceLine(event, payload);
	appendLogFile(LLM_TRACE_LOG_PATH, line);
}
