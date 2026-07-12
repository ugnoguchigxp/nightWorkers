import mermaid from "mermaid";
import type { GenericDedicatedViewArtifact } from "../../services/structured-generation/prompts/plan-dedicated-view";

export async function validatePlanViewMermaidArtifact(
	artifact: GenericDedicatedViewArtifact,
) {
	const chart = extractMermaidChart(artifact.markdown);
	if (!chart) return null;
	const parseChart = chart.trim().startsWith("flowchart")
		? buildFlowchartParseSource(chart)
		: chart;
	try {
		await mermaid.parse(parseChart);
		return null;
	} catch (err) {
		return { chart, error: err instanceof Error ? err.message : String(err) };
	}
}

export function normalizePlanViewMermaidArtifact(
	artifact: GenericDedicatedViewArtifact,
): GenericDedicatedViewArtifact {
	const chart = extractMermaidChart(artifact.markdown);
	if (!chart?.trim().startsWith("flowchart")) return artifact;
	const sanitizedChart = sanitizeFlowchartLabels(chart);
	if (sanitizedChart === chart) return artifact;
	return {
		...artifact,
		markdown: artifact.markdown.replace(/```mermaid\s*([\s\S]*?)```/i, () =>
			["```mermaid", sanitizedChart, "```"].join("\n"),
		),
	};
}

export function sanitizeFlowchartLabels(chart: string) {
	return chart.split("\n").map(sanitizeFlowchartLabelLine).join("\n");
}

export function sanitizeFlowchartLabelLine(line: string) {
	const metadataBlocks: string[] = [];
	const protectedLine = line.replace(/@\{[^}\n]*\}/g, (match) => {
		const index = metadataBlocks.push(match) - 1;
		return `__NIGHTWORKERS_MERMAID_METADATA_${index}__`;
	});
	return protectedLine
		.replace(
			/\[\[([^\]\n]*)\]\]/g,
			(_match, label: string) => `["${sanitizeMermaidText(label)}"]`,
		)
		.replace(
			/\[\(([^)\n]*)\)\]/g,
			(_match, label: string) => `["${sanitizeMermaidText(label)}"]`,
		)
		.replace(
			/\(\(([^)\n]*)\)\)/g,
			(_match, label: string) => `("${sanitizeMermaidText(label)}")`,
		)
		.replace(
			/\{\{([^}\n]*)\}\}/g,
			(_match, label: string) => `{"${sanitizeMermaidText(label)}"}`,
		)
		.replace(
			/\["([^"\n]*)"\]/g,
			(_match, label: string) => `["${sanitizeMermaidText(label)}"]`,
		)
		.replace(
			/\[([^\]\n]*)\]/g,
			(_match, label: string) => `["${sanitizeMermaidText(label)}"]`,
		)
		.replace(
			/\(([^)\n]*)\)/g,
			(_match, label: string) => `("${sanitizeMermaidText(label)}")`,
		)
		.replace(
			/\{([^}\n]*)\}/g,
			(_match, label: string) => `{"${sanitizeMermaidText(label)}"}`,
		)
		.replace(
			/__NIGHTWORKERS_MERMAID_METADATA_(\d+)__/g,
			(_match, index: string) => {
				return metadataBlocks[Number(index)] || "";
			},
		);
}

export function sanitizeMermaidText(value: string) {
	return value
		.replace(/`([^`]*)`/g, "$1")
		.replace(/`/g, "")
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/[*_~]/g, "")
		.replace(/[{}<>]/g, " ")
		.replaceAll("[", " ")
		.replaceAll("]", " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120)
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"');
}

export function buildFlowchartParseSource(chart: string) {
	return chart
		.split("\n")
		.filter((line) => !isFlowchartGroupWrapperLine(line))
		.map(stripFlowchartLabelsForParse)
		.join("\n");
}

export function isFlowchartGroupWrapperLine(line: string) {
	const trimmed = line.trim();
	return /^subgraph\b/.test(trimmed) || trimmed === "end";
}

export function stripFlowchartLabelsForParse(line: string) {
	return line
		.replace(/@\{[^}\n]*\}/g, "")
		.replace(/([-.=]+>?)\|[^|\n]*\|/g, "$1")
		.replace(/--\s+[^-\n]+?\s+-->/g, "-->")
		.replace(/-\.\s+[^.\n]+?\s+\.->/g, "-.->")
		.replace(/==\s+[^=\n]+?\s+==>/g, "==>")
		.replace(/\[\[[^\]\n]*\]\]/g, "")
		.replace(/\[\([^\]\n]*\)\]/g, "")
		.replace(/\(\([^)\n]*\)\)/g, "")
		.replace(/\{\{[^}\n]*\}\}/g, "")
		.replace(/\[[^\]\n]*\]/g, "")
		.replace(/\([^)\n]*\)/g, "")
		.replace(/\{[^}\n]*\}/g, "");
}

export function buildPlanViewMermaidRepairContext(input: {
	artifact: GenericDedicatedViewArtifact;
	chart: string;
	error: string;
}) {
	return [
		"### Error",
		input.error,
		"",
		"### Previous Mermaid source",
		"```mermaid",
		input.chart.trim(),
		"```",
		"",
		"### Previous artifact JSON",
		JSON.stringify(input.artifact, null, 2),
	].join("\n");
}

export function buildPlanViewOutputRepairContext(
	rawOutput: string,
	err: unknown,
) {
	return [
		"### Error",
		err instanceof Error ? err.message : String(err),
		"",
		"### Previous raw output",
		rawOutput,
	].join("\n");
}

export function extractMermaidChart(content: string) {
	const match = content.match(/```mermaid\s*([\s\S]*?)```/i);
	return match?.[1]?.trim() || null;
}
