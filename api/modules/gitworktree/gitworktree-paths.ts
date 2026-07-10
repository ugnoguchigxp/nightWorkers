import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export async function canonicalize(value: string) {
	const absolute = path.resolve(value);
	return fs.realpath(absolute).catch(() => absolute);
}

export async function canonicalizeProspectivePath(value: string) {
	const absolute = path.resolve(value);
	const missingSegments: string[] = [];
	let cursor = absolute;
	while (true) {
		try {
			return path.join(await fs.realpath(cursor), ...missingSegments.reverse());
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return absolute;
			const parent = path.dirname(cursor);
			if (parent === cursor) return absolute;
			missingSegments.push(path.basename(cursor));
			cursor = parent;
		}
	}
}

export function worktreeId(commonDir: string, canonicalPath: string) {
	return createHash("sha256")
		.update(commonDir)
		.update("\0")
		.update(canonicalPath)
		.digest("hex");
}

export function branchSlug(value: string) {
	return (
		value
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "worktree"
	);
}

export function overlapsExisting(target: string, existing: string) {
	const fromExisting = path.relative(existing, target);
	const fromTarget = path.relative(target, existing);
	return (
		fromExisting === "" ||
		(!fromExisting.startsWith("..") && !path.isAbsolute(fromExisting)) ||
		(!fromTarget.startsWith("..") && !path.isAbsolute(fromTarget))
	);
}
