import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
	getDeepRecordString,
	unknownErrorMessage,
} from "../../../shared/json-record";
import { enforcePathPolicy } from "./tool-policy-enforcer";
import type { WorkerToolResult } from "./types";

const execAsync = promisify(exec);

export interface ApplyPatchInput {
	patchContent: string;
	repoRoot: string;
	allowedPaths?: string[];
	externalAllowedPaths?: string[];
	deniedPaths?: string[];
}

export interface ApplyPatchOutput {
	applied: boolean;
	changedFiles: string[];
	stdout?: string;
	stderr?: string;
}

export async function applyPatchTool(
	input: ApplyPatchInput,
): Promise<WorkerToolResult<ApplyPatchOutput>> {
	const startedAt = new Date().toISOString();
	const {
		patchContent,
		repoRoot,
		allowedPaths,
		externalAllowedPaths,
		deniedPaths,
	} = input;
	const gitPatchContent = toGitApplyPatch(patchContent);

	const absoluteRepoRoot = path.resolve(repoRoot);
	const tempPatchFile = path.join(
		absoluteRepoRoot,
		`.temp-patch-${Math.random().toString(36).substring(7)}.patch`,
	);

	let targets: string[] = [];

	try {
		const codexUpdate = await applyCodexUpdateEnvelope({
			patchContent,
			repoRoot: absoluteRepoRoot,
			allowedPaths,
			externalAllowedPaths,
			deniedPaths,
		});
		if (codexUpdate) {
			return {
				ok: true,
				toolName: "apply_patch",
				startedAt,
				finishedAt: new Date().toISOString(),
				payload: {
					applied: true,
					changedFiles: codexUpdate,
					stdout: "",
					stderr: "",
				},
			};
		}

		// 1. Write the patch content to a temp file
		await fs.writeFile(tempPatchFile, gitPatchContent, "utf-8");

		// 2. Dry run with git apply to parse target files and check if it's safe
		try {
			const { stdout } = await execAsync(
				`git apply --numstat ${tempPatchFile}`,
				{
					cwd: absoluteRepoRoot,
				},
			);
			// Parse modified files from numstat output: "added\tdeleted\tpath"
			targets = stdout
				.split("\n")
				.map((line) => line.split("\t")[2])
				.filter((p) => p && p.trim().length > 0);
		} catch (_dryError) {
			// If git numstat fails, fallback to parsing diff header manually
			const lines = gitPatchContent.split("\n");
			for (const line of lines) {
				if (line.startsWith("--- a/") || line.startsWith("+++ b/")) {
					const filePart = line.substring(6).trim();
					if (
						filePart &&
						filePart !== "/dev/null" &&
						!targets.includes(filePart)
					) {
						targets.push(filePart);
					}
				}
			}
		}

		// 3. Verify safety policies on all target files
		for (const relativePath of targets) {
			const absolutePath = path.resolve(absoluteRepoRoot, relativePath);

			// Workspace boundaries check
			const policy = enforcePathPolicy(absolutePath, {
				repoRoot: absoluteRepoRoot,
				allowedPaths,
				externalAllowedPaths,
				deniedPaths,
			});
			if (!policy.allowed) {
				await fs.unlink(tempPatchFile).catch(() => {});
				return {
					ok: false,
					toolName: "apply_patch",
					startedAt,
					finishedAt: new Date().toISOString(),
					payload: { applied: false, changedFiles: [] },
					error: {
						code: "ACCESS_DENIED",
						message:
							policy.message ||
							`Patch target lies outside allowed workspace directories: ${relativePath}`,
					},
				};
			}
		}

		// 4. Apply the patch using git apply
		const { stdout, stderr } = await execAsync(
			`git apply --recount --whitespace=fix ${tempPatchFile}`,
			{
				cwd: absoluteRepoRoot,
			},
		);

		// 5. Clean up temp patch file
		await fs.unlink(tempPatchFile).catch(() => {});

		return {
			ok: true,
			toolName: "apply_patch",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				applied: true,
				changedFiles: targets,
				stdout,
				stderr,
			},
		};
	} catch (err) {
		// Clean up temp patch file on failure
		await fs.unlink(tempPatchFile).catch(() => {});

		return {
			ok: false,
			toolName: "apply_patch",
			startedAt,
			finishedAt: new Date().toISOString(),
			payload: {
				applied: false,
				changedFiles: targets,
				stdout: "",
				stderr: getDeepRecordString(err, "stderr") || "",
			},
			error: classifyPatchError(err),
		};
	}
}

async function applyCodexUpdateEnvelope(input: ApplyPatchInput) {
	const lines = input.patchContent.trimEnd().split("\n");
	if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
		return null;
	}
	const header = lines[1] ?? "";
	if (!header.startsWith("*** Update File: ")) return null;
	if (lines.slice(2, -1).some((line) => line.startsWith("*** "))) {
		return null;
	}
	const relativePath = header.slice("*** Update File: ".length).trim();
	const absolutePath = path.resolve(input.repoRoot, relativePath);
	const policy = enforcePathPolicy(absolutePath, {
		repoRoot: input.repoRoot,
		allowedPaths: input.allowedPaths,
		externalAllowedPaths: input.externalAllowedPaths,
		deniedPaths: input.deniedPaths,
	});
	if (!policy.allowed) {
		throw new Error(
			policy.message || `Patch target is not allowed: ${relativePath}`,
		);
	}
	const original = await fs.readFile(absolutePath, "utf8");
	const trailingNewline = original.endsWith("\n");
	let content = original.split("\n");
	if (trailingNewline) content.pop();
	const hunks = lines.slice(2, -1).reduce<string[][]>((result, line) => {
		if (line.startsWith("@@")) result.push([]);
		else if (result.length > 0) result.at(-1)?.push(line);
		return result;
	}, []);
	if (hunks.length === 0) throw new Error("Codex update patch has no hunks.");
	let searchFrom = 0;
	for (const hunk of hunks) {
		const oldLines: string[] = [];
		const newLines: string[] = [];
		for (const line of hunk) {
			if (line.startsWith("+")) newLines.push(line.slice(1));
			else if (line.startsWith("-")) oldLines.push(line.slice(1));
			else {
				const contextLine = line.startsWith(" ") ? line.slice(1) : line;
				oldLines.push(contextLine);
				newLines.push(contextLine);
			}
		}
		const index = findLineSequence(content, oldLines, searchFrom);
		if (index < 0) {
			throw new Error(
				`Codex update hunk does not match current file: ${relativePath}`,
			);
		}
		content = [
			...content.slice(0, index),
			...newLines,
			...content.slice(index + oldLines.length),
		];
		searchFrom = index + newLines.length;
	}
	await fs.writeFile(
		absolutePath,
		`${content.join("\n")}${trailingNewline ? "\n" : ""}`,
		"utf8",
	);
	return [relativePath];
}

function findLineSequence(
	content: string[],
	expected: string[],
	start: number,
) {
	if (expected.length === 0) return -1;
	for (
		let index = start;
		index <= content.length - expected.length;
		index += 1
	) {
		if (expected.every((line, offset) => content[index + offset] === line)) {
			return index;
		}
	}
	return -1;
}

function classifyPatchError(err: unknown) {
	const stderr = getDeepRecordString(err, "stderr") || "";
	const message = unknownErrorMessage(err);
	const combined = `${stderr}\n${message}`;
	if (/already exists in working directory/i.test(combined)) {
		return {
			code: "PATCH_TARGET_EXISTS",
			message: `Patch tried to create a file that already exists. Read the target file and build an update patch instead. ${message}`,
		};
	}
	if (/patch does not apply|patch failed:/i.test(combined)) {
		return {
			code: "PATCH_DOES_NOT_APPLY",
			message: `Patch did not match the current file content. Read the target file and rebuild the patch from current content. ${message}`,
		};
	}
	if (/No such file or directory|does not exist/i.test(combined)) {
		return {
			code: "PATCH_TARGET_NOT_FOUND",
			message: `Patch target path was not found. Confirm the parent directory with list_dir or create the target path with a new-file patch. ${message}`,
		};
	}
	return {
		code: "PATCH_FAILED",
		message: `Failed to apply patch: ${message}`,
	};
}

function toGitApplyPatch(patchContent: string): string {
	const lines = patchContent.trimEnd().split("\n");
	if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
		return patchContent;
	}

	const chunks: string[] = [];
	let index = 1;

	while (index < lines.length - 1) {
		const line = lines[index];
		if (!line.startsWith("*** Add File: ")) {
			return patchContent;
		}

		const filePath = line.slice("*** Add File: ".length).trim();
		index += 1;
		const addedLines: string[] = [];

		while (index < lines.length - 1 && !lines[index].startsWith("*** ")) {
			const contentLine = lines[index];
			if (!contentLine.startsWith("+")) return patchContent;
			addedLines.push(contentLine.slice(1));
			index += 1;
		}

		chunks.push(
			[
				"--- /dev/null",
				`+++ b/${filePath}`,
				`@@ -0,0 +1,${Math.max(addedLines.length, 1)} @@`,
				...addedLines.map((contentLine) => `+${contentLine}`),
			].join("\n"),
		);
	}

	return chunks.length ? `${chunks.join("\n")}\n` : patchContent;
}
