import type { CodeBlockData } from "@/components/ui/CodeBlock";

export function buildApplyPatchCodeBlockData(
	patchContent: string,
): CodeBlockData[] {
	return [
		{
			code: patchContent.trimEnd() || "No patch",
			filename: "apply_patch.patch",
			language: "diff",
		},
	];
}

export function buildReplaceContentCodeBlockData(input: {
	filePath: string;
	needle: string;
	replacement: string;
	occurrences?: number;
}): CodeBlockData[] | undefined {
	if (!input.needle && !input.replacement) return undefined;
	const occurrenceLabel =
		typeof input.occurrences === "number"
			? `# occurrences: ${input.occurrences}`
			: "# replacement requested";
	return [
		{
			code: [
				`--- ${input.filePath}`,
				`+++ ${input.filePath}`,
				occurrenceLabel,
				input.needle ? `- ${input.needle}` : "",
				input.replacement ? `+ ${input.replacement}` : "",
			]
				.filter(Boolean)
				.join("\n"),
			filename: `${input.filePath}.replace.diff`,
			language: "diff",
		},
	];
}

export function estimateReplacementStats(input: {
	needle: string;
	replacement: string;
	occurrences?: number;
}): { added: number; deleted: number } | null {
	if (!input.needle && !input.replacement) return null;
	const occurrences =
		typeof input.occurrences === "number" && input.occurrences > 0
			? input.occurrences
			: 1;
	return {
		added: countContentLines(input.replacement) * occurrences,
		deleted: countContentLines(input.needle) * occurrences,
	};
}

export function countContentLines(value: string): number {
	if (!value) return 0;
	return value.split("\n").length;
}

export function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function parseApplyPatchSections(
	patchContent: string,
): Array<{ path: string; added: number; deleted: number }> {
	const lines = patchContent.split("\n");
	const sections: Array<{ path: string; added: number; deleted: number }> = [];
	let activePath: string | null = null;
	let activeSection: { path: string; added: number; deleted: number } | null =
		null;
	let hasApplyPatchDirective = false;

	const pushSection = () => {
		if (activeSection) sections.push(activeSection);
	};

	for (const line of lines) {
		if (line.startsWith("*** Update File: ")) {
			hasApplyPatchDirective = true;
			pushSection();
			activePath = line.replace("*** Update File: ", "").trim();
			activeSection = null;
			continue;
		}
		if (line.startsWith("*** Add File: ")) {
			hasApplyPatchDirective = true;
			pushSection();
			activePath = line.replace("*** Add File: ", "").trim();
			activeSection = { path: activePath || "unknown", added: 0, deleted: 0 };
			continue;
		}
		if (line.startsWith("*** Delete File: ")) {
			hasApplyPatchDirective = true;
			pushSection();
			const deletedPath = line.replace("*** Delete File: ", "").trim();
			sections.push({ path: deletedPath, added: 0, deleted: 0 });
			activePath = null;
			activeSection = null;
			continue;
		}
		if (line.startsWith("@@")) {
			pushSection();
			activeSection = { path: activePath || "unknown", added: 0, deleted: 0 };
			continue;
		}
		if (!activeSection) continue;
		if (line.startsWith("+") && !line.startsWith("+++"))
			activeSection.added += 1;
		if (line.startsWith("-") && !line.startsWith("---"))
			activeSection.deleted += 1;
	}
	pushSection();

	return hasApplyPatchDirective && sections.length > 0
		? sections
		: parseUnifiedDiffSections(patchContent);
}

export function parseUnifiedDiffSections(
	diffContent: string,
): Array<{ path: string; added: number; deleted: number }> {
	const sections: Array<{ path: string; added: number; deleted: number }> = [];
	let current: { path: string; added: number; deleted: number } | null = null;
	let pendingOldPath: string | null = null;

	for (const line of diffContent.split("\n")) {
		if (line.startsWith("--- ")) {
			const oldPath = normalizeDiffPath(line.slice(4).trim());
			pendingOldPath = oldPath === "/dev/null" ? null : oldPath;
			continue;
		}

		if (line.startsWith("+++ ")) {
			if (current) sections.push(current);
			const newPath = normalizeDiffPath(line.slice(4).trim());
			current = {
				path: newPath === "/dev/null" ? pendingOldPath || "unknown" : newPath,
				added: 0,
				deleted: 0,
			};
			pendingOldPath = null;
			continue;
		}

		if (!current) continue;
		if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
		if (line.startsWith("-") && !line.startsWith("---")) current.deleted += 1;
	}

	if (current) sections.push(current);
	return sections;
}

export function normalizeDiffPath(path: string): string {
	if (path.startsWith("a/") || path.startsWith("b/")) return path.slice(2);
	return path;
}
