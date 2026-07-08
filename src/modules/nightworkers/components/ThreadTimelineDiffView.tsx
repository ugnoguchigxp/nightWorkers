export function DiffCodeBlock({
	code,
	label,
	className = "",
}: {
	code: string;
	label: string;
	className?: string;
}) {
	const metadata = parseDiffMetadata(code);
	const lines = buildDiffDisplayLinesWithKeys(metadata.lines);
	return (
		<div className={`nightworkers-diff-view ${className}`.trim()}>
			<div className="nightworkers-diff-header">
				<span className="nightworkers-diff-file">
					{metadata.filePath || "diff"}
				</span>
				<span className="nightworkers-diff-label">{label}</span>
			</div>
			<pre className="nightworkers-diff-body">
				{lines.map(({ key, line }) => (
					<span
						className={`nightworkers-diff-line ${diffLineClassName(line.text)}`}
						key={key}
					>
						<span className="nightworkers-diff-line-number">
							{line.lineNumber ?? ""}
						</span>
						<code className="nightworkers-diff-line-code">
							{line.text || " "}
						</code>
					</span>
				))}
			</pre>
		</div>
	);
}

type DiffDisplayLine = {
	text: string;
	lineNumber?: number;
};

export function parseDiffMetadata(code: string): {
	filePath: string;
	lines: DiffDisplayLine[];
} {
	const lines = code.split("\n");
	const filePathLine =
		lines.find(
			(line) => line.startsWith("+++ ") && line.slice(4).trim() !== "/dev/null",
		) ||
		lines.find(
			(line) => line.startsWith("--- ") && line.slice(4).trim() !== "/dev/null",
		) ||
		lines.find((line) => line.startsWith("+++ ") || line.startsWith("--- "));
	return {
		filePath: filePathLine ? filePathLine.slice(4).trim() : "",
		lines: buildDiffDisplayLines(lines),
	};
}

function buildDiffDisplayLines(lines: string[]): DiffDisplayLine[] {
	const displayLines: DiffDisplayLine[] = [];
	let nextNewLine = 1;

	for (const line of lines) {
		if (isDiffFileMetadataLine(line)) continue;

		const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
		if (hunkMatch) {
			nextNewLine = Number(hunkMatch[1]);
			displayLines.push({ text: line });
			continue;
		}

		if (line.startsWith("@@")) {
			displayLines.push({ text: line });
			continue;
		}

		if (line.startsWith("-") || line.startsWith("\\")) {
			displayLines.push({ text: line });
			continue;
		}

		displayLines.push({ text: line, lineNumber: nextNewLine });
		nextNewLine += 1;
	}

	return displayLines;
}

export function buildDiffDisplayLinesWithKeys(
	lines: DiffDisplayLine[],
): { key: string; line: DiffDisplayLine }[] {
	const seen = new Map<string, number>();
	return lines.map((line) => {
		const baseKey = `${line.lineNumber ?? "meta"}:${line.text}`;
		const occurrence = seen.get(baseKey) ?? 0;
		seen.set(baseKey, occurrence + 1);
		return {
			key: `${baseKey}:${occurrence}`,
			line,
		};
	});
}

function isDiffFileMetadataLine(line: string): boolean {
	return (
		line.startsWith("diff --git ") ||
		line.startsWith("index ") ||
		line.startsWith("new file mode ") ||
		line.startsWith("deleted file mode ") ||
		line.startsWith("old mode ") ||
		line.startsWith("new mode ") ||
		line.startsWith("similarity index ") ||
		line.startsWith("rename from ") ||
		line.startsWith("rename to ") ||
		line.startsWith("--- ") ||
		line.startsWith("+++ ")
	);
}

function diffLineClassName(line: string): string {
	if (line.startsWith("@@")) return "nightworkers-diff-line-hunk";
	if (line.startsWith("+")) return "nightworkers-diff-line-add";
	if (line.startsWith("-")) return "nightworkers-diff-line-remove";
	return "";
}
