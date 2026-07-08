import type { NormalizedTestCaseEvidence } from "../../../../shared/schemas/verification-checklist.schema";
import { extractConditionIds, stableEvidenceId } from "../normalized-evidence";

export function parseJUnitXmlCases(xml: string): NormalizedTestCaseEvidence[] {
	const cases: NormalizedTestCaseEvidence[] = [];
	for (const match of xml.matchAll(
		/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g,
	)) {
		cases.push(parseCase(match[1] || "", match[2] || ""));
	}
	return cases;
}

function parseCase(attrs: string, body: string): NormalizedTestCaseEvidence {
	const name = readXmlAttr(attrs, "name") || "unnamed testcase";
	const className = readXmlAttr(attrs, "classname");
	const filePath = readXmlAttr(attrs, "file") || undefined;
	const durationSeconds = Number(readXmlAttr(attrs, "time") || "NaN");
	const failureMessage =
		readXmlAttr(firstTagAttrs(body, "failure"), "message") ||
		readXmlAttr(firstTagAttrs(body, "error"), "message") ||
		stripXml(body.match(/<(failure|error)\b[^>]*>([\s\S]*?)<\/\1>/)?.[2] || "");
	const skipped = /<skipped\b/.test(body);
	const failed = /<(failure|error)\b/.test(body);
	const displayName = className ? `${className} ${name}` : name;
	return {
		id: stableEvidenceId([displayName, body]),
		name: displayName,
		filePath,
		status: failed ? "failed" : skipped ? "skipped" : "passed",
		durationMs: Number.isFinite(durationSeconds)
			? Math.round(durationSeconds * 1000)
			: undefined,
		conditionIds: extractConditionIds(displayName),
		failureMessage: failureMessage || undefined,
	};
}

function firstTagAttrs(xml: string, tagName: string): string {
	return xml.match(new RegExp(`<${tagName}\\b([^>]*)>`, "i"))?.[1] || "";
}

function readXmlAttr(attrs: string, name: string): string | null {
	const match = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, "i"));
	return match ? decodeXml(match[1] || "") : null;
}

function stripXml(value: string): string {
	return decodeXml(
		value
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim(),
	);
}

function decodeXml(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}
