import fs from "node:fs/promises";
import path from "node:path";
import { isProjectSecretPath } from "../security/project-secret-paths";
import { formatFileSystemToolError } from "./fs-error";
import {
	buildReadCacheMarker,
	compressReadFileContent,
	getReadCacheKey,
	type ReadFileCacheEntry,
	type ToolOutputCompressionMetadata,
	updateReadCache,
} from "./output-compression";
import { enforcePathPolicy } from "./tool-policy-enforcer";
import type { WorkerToolResult } from "./types";

const MAX_READ_FILE_BYTES = 4 * 1024 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;

export interface ReadFileInput {
	filePath: string;
	repoRoot: string;
	startLine?: number; // 1-indexed, inclusive
	endLine?: number; // 1-indexed, inclusive
	fresh?: boolean;
	compressionMode?: "auto" | "off";
	readCache?: Map<string, ReadFileCacheEntry>;
	allowedPaths?: string[];
	externalAllowedPaths?: string[];
	deniedPaths?: string[];
}

export interface ReadFileOutput {
	content: string;
	totalLines: number;
	linesReturned: number;
	startLine: number;
	endLine: number;
	truncated: boolean;
	cached?: boolean;
	contentHash?: string;
	compression?: ToolOutputCompressionMetadata;
}

export async function readFileTool(
	input: ReadFileInput,
): Promise<WorkerToolResult<ReadFileOutput>> {
	const startedAt = new Date().toISOString();
	const {
		filePath,
		repoRoot,
		startLine = 1,
		endLine,
		fresh = false,
		compressionMode = "auto",
		readCache,
		allowedPaths,
		externalAllowedPaths,
		deniedPaths,
	} = input;

	const absoluteRepoRoot = path.resolve(repoRoot);
	const targetPath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(absoluteRepoRoot, filePath);
	if (isProjectSecretPath(targetPath, absoluteRepoRoot)) {
		return {
			ok: false,
			toolName: "read_file",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				content: "",
				totalLines: 0,
				linesReturned: 0,
				startLine: 0,
				endLine: 0,
				truncated: false,
			},
			error: {
				code: "ACCESS_DENIED",
				message: "Project secret fileはread_fileで取得できません。",
			},
		};
	}

	const pathDecision = enforcePathPolicy(targetPath, {
		repoRoot,
		allowedPaths,
		externalAllowedPaths,
		deniedPaths,
	});
	if (!pathDecision.allowed) {
		return {
			ok: false,
			toolName: "read_file",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				content: "",
				totalLines: 0,
				linesReturned: 0,
				startLine: 0,
				endLine: 0,
				truncated: false,
			},
			error: {
				code: "ACCESS_DENIED",
				message:
					pathDecision.message ||
					`Access to path is denied by security policies: ${filePath}`,
			},
		};
	}

	let fileHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
	try {
		const linkStat = await fs.lstat(targetPath);
		if (!linkStat.isFile() && !linkStat.isSymbolicLink()) {
			return readResourceError({
				code: "UNSUPPORTED_FILE_TYPE",
				message: "read_file only supports regular text files.",
				filePath,
				startedAt,
			});
		}

		const canonicalPath = await fs.realpath(targetPath);
		if (isProjectSecretPath(canonicalPath, absoluteRepoRoot)) {
			return readResourceError({
				code: "ACCESS_DENIED",
				message: "Project secret fileはread_fileで取得できません。",
				filePath,
				startedAt,
			});
		}
		const canonicalPathDecision = enforcePathPolicy(canonicalPath, {
			repoRoot,
			allowedPaths,
			externalAllowedPaths,
			deniedPaths,
		});
		if (!canonicalPathDecision.allowed) {
			return readResourceError({
				code: "ACCESS_DENIED",
				message:
					canonicalPathDecision.message ||
					`Access to path is denied by security policies: ${filePath}`,
				filePath,
				startedAt,
			});
		}

		const targetStat = await fs.stat(canonicalPath);
		if (!targetStat.isFile()) {
			return readResourceError({
				code: "UNSUPPORTED_FILE_TYPE",
				message: "read_file only supports regular text files.",
				filePath,
				startedAt,
			});
		}
		if (targetStat.size > MAX_READ_FILE_BYTES) {
			return readResourceError({
				code: "FILE_TOO_LARGE",
				message: `File exceeds the ${MAX_READ_FILE_BYTES} byte read limit.`,
				filePath,
				startedAt,
			});
		}

		fileHandle = await fs.open(canonicalPath, "r");
		const openedStat = await fileHandle.stat();
		if (!openedStat.isFile()) {
			return readResourceError({
				code: "UNSUPPORTED_FILE_TYPE",
				message: "read_file only supports regular text files.",
				filePath,
				startedAt,
			});
		}
		if (openedStat.size > MAX_READ_FILE_BYTES) {
			return readResourceError({
				code: "FILE_TOO_LARGE",
				message: `File exceeds the ${MAX_READ_FILE_BYTES} byte read limit.`,
				filePath,
				startedAt,
			});
		}
		const binaryProbe = Buffer.alloc(
			Math.min(BINARY_PROBE_BYTES, openedStat.size),
		);
		const { bytesRead } = await fileHandle.read(
			binaryProbe,
			0,
			binaryProbe.length,
			0,
		);
		if (binaryProbe.subarray(0, bytesRead).includes(0)) {
			return readResourceError({
				code: "UNSUPPORTED_FILE_TYPE",
				message: "read_file only supports text files.",
				filePath,
				startedAt,
			});
		}

		const rawContent = await fileHandle.readFile({ encoding: "utf-8" });
		const lines = rawContent.split(/\r?\n/);
		const totalLines = lines.length;
		const now = new Date().toISOString();
		const explicitRange = Boolean(input.startLine || input.endLine);
		const previousCacheEntry = readCache?.get(getReadCacheKey(targetPath));
		const cacheUpdate = readCache
			? updateReadCache({
					cache: readCache,
					absolutePath: targetPath,
					content: rawContent,
					totalLines,
					now,
				})
			: undefined;
		const contentHash = cacheUpdate?.contentHash;

		if (compressionMode !== "off" && !fresh && !explicitRange && readCache) {
			const cacheEntry = previousCacheEntry;
			if (cacheEntry && contentHash) {
				if (cacheEntry.contentHash === contentHash) {
					const marker = buildReadCacheMarker({ filePath, entry: cacheEntry });
					return {
						ok: true,
						toolName: "read_file",
						startedAt,
						finishedAt: new Date().toISOString(),
						payload: {
							content: marker.content,
							totalLines,
							linesReturned: 0,
							startLine: 0,
							endLine: 0,
							truncated: true,
							cached: true,
							contentHash,
							compression: marker.compression,
						},
					};
				}
			}
		}

		if (compressionMode !== "off" && !explicitRange) {
			const compressed = compressReadFileContent({
				filePath,
				rawContent,
				lines,
				contentHash,
			});
			if (compressed.compression) {
				return {
					ok: true,
					toolName: "read_file",
					startedAt,
					finishedAt: new Date().toISOString(),
					payload: {
						content: compressed.content,
						totalLines,
						linesReturned: compressed.linesReturned,
						startLine: 1,
						endLine: totalLines,
						truncated: true,
						cached: false,
						contentHash,
						compression: compressed.compression,
					},
				};
			}
		}

		const actualStart = Math.max(1, Math.min(startLine, totalLines));
		const actualEnd = endLine
			? Math.max(actualStart, Math.min(endLine, totalLines))
			: totalLines;

		// Apply strict limit to line read count (e.g. max 1000 lines per tool call to avoid context overflow)
		const MAX_LINES = 1000;
		let linesReturned = actualEnd - actualStart + 1;
		let finalEnd = actualEnd;
		let truncated = false;

		if (linesReturned > MAX_LINES) {
			finalEnd = actualStart + MAX_LINES - 1;
			linesReturned = MAX_LINES;
			truncated = true;
		}

		const selectedLines = lines.slice(actualStart - 1, finalEnd);
		const lineNumbered = selectedLines
			.map((line, idx) => `${actualStart + idx}: ${line}`)
			.join("\n");
		return {
			ok: true,
			toolName: "read_file",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				content: lineNumbered,
				totalLines,
				linesReturned,
				startLine: actualStart,
				endLine: finalEnd,
				truncated,
				cached: false,
				contentHash,
			},
		};
	} catch (err) {
		return {
			ok: false,
			toolName: "read_file",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				content: "",
				totalLines: 0,
				linesReturned: 0,
				startLine: 0,
				endLine: 0,
				truncated: false,
			},
			error: formatFileSystemToolError({
				error: err,
				notFoundCode: "FILE_NOT_FOUND",
				notFoundMessage: `File not found: ${filePath}`,
				fallbackCode: "READ_FAILED",
				fallbackMessagePrefix: "Failed to read file",
			}),
		};
	} finally {
		await fileHandle?.close().catch(() => undefined);
	}
}

function readResourceError(input: {
	code: "ACCESS_DENIED" | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE_TYPE";
	message: string;
	filePath: string;
	startedAt: string;
}): WorkerToolResult<ReadFileOutput> {
	return {
		ok: false,
		toolName: "read_file",
		startedAt: input.startedAt,
		finishedAt: new Date().toISOString(),
		payload: {
			content: "",
			totalLines: 0,
			linesReturned: 0,
			startLine: 0,
			endLine: 0,
			truncated: false,
		},
		error: {
			code: input.code,
			message: input.message,
		},
	};
}
