import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";

const gzip = promisify(gzipCallback);

export type RuntimeLogKind = "api" | "llm" | "supervisor";

export type RuntimeLogRetentionConfig = {
	apiLogDays: number;
	llmRawLogDays: number;
	apiLogMaxBytes: number;
	llmRawLogsMaxBytes: number;
	runtimeLogsMaxBytes: number;
	apiSegmentMaxBytes: number;
	llmSegmentMaxBytes: number;
};

export const DEFAULT_RUNTIME_LOG_RETENTION: RuntimeLogRetentionConfig = {
	apiLogDays: 7,
	llmRawLogDays: 3,
	apiLogMaxBytes: 16 * 1024 * 1024,
	llmRawLogsMaxBytes: 64 * 1024 * 1024,
	runtimeLogsMaxBytes: 80 * 1024 * 1024,
	apiSegmentMaxBytes: 4 * 1024 * 1024,
	llmSegmentMaxBytes: 8 * 1024 * 1024,
};

type LogDescriptor = {
	kind: RuntimeLogKind;
	category: "api" | "llm";
	activeName: string;
	rotatedPrefix: string;
	rotatedExtension: string;
};

type ManagedFile = {
	path: string;
	category: "api" | "llm";
	mtimeMs: number;
	size: number;
};

const descriptors: Record<RuntimeLogKind, LogDescriptor> = {
	api: {
		kind: "api",
		category: "api",
		activeName: "api.log",
		rotatedPrefix: "api.",
		rotatedExtension: ".log.gz",
	},
	llm: {
		kind: "llm",
		category: "llm",
		activeName: "llm-trace.jsonl",
		rotatedPrefix: "llm-trace.",
		rotatedExtension: ".jsonl.gz",
	},
	supervisor: {
		kind: "supervisor",
		category: "llm",
		activeName: "supervisor-trace.log",
		rotatedPrefix: "supervisor-trace.",
		rotatedExtension: ".log.gz",
	},
};

function utcDay(value: Date) {
	return value.toISOString().slice(0, 10);
}

function safeStat(filePath: string) {
	return fs.stat(filePath).catch(() => null);
}

function maxLineBytes(kind: RuntimeLogKind) {
	return kind === "api" ? 64 * 1024 : 2 * 1024 * 1024;
}

function truncateLine(value: string, limit: number) {
	const bytes = Buffer.byteLength(value, "utf8");
	if (bytes <= limit) return value;
	const suffix = " [truncated]";
	const allowed = Math.max(0, limit - Buffer.byteLength(suffix, "utf8"));
	return (
		Buffer.from(value, "utf8").subarray(0, allowed).toString("utf8") + suffix
	);
}

/**
 * Serializes all file mutations. The logger calls this asynchronously, but a
 * single queue prevents concurrent requests from rotating the same file twice.
 */
export class RuntimeLogWriter {
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly logsDir: string,
		private readonly getConfig: () => RuntimeLogRetentionConfig = () =>
			DEFAULT_RUNTIME_LOG_RETENTION,
	) {}

	append(kind: RuntimeLogKind, line: string, now = new Date()) {
		return this.enqueue(() => this.appendNow(kind, line, now));
	}

	sweep(now = new Date()) {
		return this.enqueue(() => this.sweepNow(now));
	}

	flush() {
		return this.queue;
	}

	private enqueue(work: () => Promise<void>) {
		const run = this.queue.then(work, work);
		this.queue = run.catch(() => undefined);
		return run;
	}

	private async appendNow(kind: RuntimeLogKind, line: string, now: Date) {
		const descriptor = descriptors[kind];
		const activePath = path.join(this.logsDir, descriptor.activeName);
		const bounded = truncateLine(line, maxLineBytes(kind));
		const next = `${bounded}\n`;
		await fs.mkdir(this.logsDir, { recursive: true, mode: 0o700 });
		const stat = await safeStat(activePath);
		if (
			stat &&
			(utcDay(stat.mtime) !== utcDay(now) ||
				(stat.size > 0 &&
					stat.size + Buffer.byteLength(next, "utf8") >
						this.segmentLimit(descriptor)))
		) {
			await this.rotate(descriptor, now);
		}
		await fs.appendFile(activePath, next, "utf8");
		await this.enforceCapacity(now);
	}

	private segmentLimit(descriptor: LogDescriptor) {
		const config = this.getConfig();
		return descriptor.category === "api"
			? config.apiSegmentMaxBytes
			: config.llmSegmentMaxBytes;
	}

	private async sweepNow(now: Date) {
		await fs.mkdir(this.logsDir, { recursive: true, mode: 0o700 });
		for (const descriptor of Object.values(descriptors)) {
			const activePath = path.join(this.logsDir, descriptor.activeName);
			const stat = await safeStat(activePath);
			if (stat && stat.size > 0 && utcDay(stat.mtime) !== utcDay(now)) {
				await this.rotate(descriptor, now);
			}
		}

		const config = this.getConfig();
		const cutoffByCategory = {
			api: now.getTime() - config.apiLogDays * 24 * 60 * 60 * 1000,
			llm: now.getTime() - config.llmRawLogDays * 24 * 60 * 60 * 1000,
		};
		for (const file of await this.closedFiles()) {
			if (file.mtimeMs < cutoffByCategory[file.category]) {
				await fs.unlink(file.path).catch(() => undefined);
			}
		}
		await this.enforceCapacity(now);
	}

	private async rotate(descriptor: LogDescriptor, now: Date) {
		const activePath = path.join(this.logsDir, descriptor.activeName);
		const stat = await safeStat(activePath);
		if (!stat || stat.size === 0) return;
		const stamp = now.toISOString().replace(/[:.]/g, "-");
		const rawPath = path.join(
			this.logsDir,
			`${descriptor.rotatedPrefix}${stamp}.${crypto.randomUUID()}${descriptor.rotatedExtension.replace(".gz", "")}`,
		);
		await fs.rename(activePath, rawPath);
		try {
			const compressed = await gzip(await fs.readFile(rawPath));
			await fs.writeFile(`${rawPath}.gz`, compressed, { mode: 0o600 });
			await fs.unlink(rawPath);
		} catch (error) {
			// The uncompressed closed segment is still safe for the next sweep.
			void error;
		}
	}

	private async closedFiles(): Promise<ManagedFile[]> {
		const entries = await fs.readdir(this.logsDir, { withFileTypes: true });
		const files: ManagedFile[] = [];
		for (const entry of entries) {
			if (!entry.isFile() || entry.isSymbolicLink()) continue;
			const descriptor = Object.values(descriptors).find(
				(candidate) =>
					entry.name.startsWith(candidate.rotatedPrefix) &&
					(entry.name.endsWith(candidate.rotatedExtension) ||
						entry.name.endsWith(candidate.rotatedExtension.replace(".gz", ""))),
			);
			if (!descriptor) continue;
			const filePath = path.join(this.logsDir, entry.name);
			const stat = await safeStat(filePath);
			if (!stat?.isFile()) continue;
			files.push({
				path: filePath,
				category: descriptor.category,
				mtimeMs: stat.mtimeMs,
				size: stat.size,
			});
		}
		return files.sort((a, b) => a.mtimeMs - b.mtimeMs);
	}

	private async managedSize() {
		const closed = await this.closedFiles();
		const active = await Promise.all(
			Object.values(descriptors).map(async (descriptor) => {
				const stat = await safeStat(
					path.join(this.logsDir, descriptor.activeName),
				);
				return {
					category: descriptor.category,
					size: stat?.isFile() ? stat.size : 0,
				};
			}),
		);
		return { closed, active };
	}

	private async enforceCapacity(_now: Date) {
		const config = this.getConfig();
		let { closed, active } = await this.managedSize();
		const categorySize = (category: "api" | "llm") =>
			closed
				.filter((file) => file.category === category)
				.reduce((sum, file) => sum + file.size, 0) +
			active
				.filter((file) => file.category === category)
				.reduce((sum, file) => sum + file.size, 0);
		const totalSize = () => categorySize("api") + categorySize("llm");
		const removeOldest = async (category?: "api" | "llm") => {
			const file = closed.find(
				(candidate) => !category || candidate.category === category,
			);
			if (!file) return false;
			await fs.unlink(file.path).catch(() => undefined);
			closed = closed.filter((candidate) => candidate.path !== file.path);
			return true;
		};

		while (
			categorySize("api") > config.apiLogMaxBytes &&
			(await removeOldest("api"))
		) {
			// Keep deleting closed generations until the category is bounded.
		}
		while (
			categorySize("llm") > config.llmRawLogsMaxBytes &&
			(await removeOldest("llm"))
		) {
			// Keep deleting closed generations until the category is bounded.
		}
		while (totalSize() > config.runtimeLogsMaxBytes) {
			if (await removeOldest("llm")) continue;
			if (await removeOldest("api")) continue;
			break;
		}
	}
}
