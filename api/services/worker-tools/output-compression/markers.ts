export function uniqueLines(lines: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const line of lines) {
		const key = line.trim();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		result.push(line);
	}
	return result;
}

export function selectWindow(
	lines: string[],
	index: number,
	contextLines: number,
): string[] {
	const start = Math.max(0, index - contextLines);
	const end = Math.min(lines.length, index + contextLines + 1);
	return lines.slice(start, end);
}

export function compactLineSections(
	sections: Array<{ title: string; lines: string[] }>,
): string {
	return sections
		.filter((section) => section.lines.length > 0)
		.map((section) => [`--- ${section.title} ---`, ...section.lines].join("\n"))
		.join("\n\n");
}
