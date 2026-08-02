import type { NormalizedTestCaseEvidence } from "../../../../shared/schemas/verification-checklist.schema";
import { extractConditionIds, stableEvidenceId } from "../normalized-evidence";

export function parseJUnitXmlCases(xml: string): NormalizedTestCaseEvidence[] {
	return parseJUnitXmlArtifact(xml).cases;
}

export function parseJUnitXmlArtifact(xml: string): {
	recognized: boolean;
	cases: NormalizedTestCaseEvidence[];
} {
	const document = extractCompleteJunitDocument(xml);
	if (!document) {
		return { recognized: false, cases: [] };
	}
	const cases: NormalizedTestCaseEvidence[] = [];
	for (const match of document.matchAll(
		/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase\s*>)/gi,
	)) {
		cases.push(parseCase(match[1] || "", match[2] || ""));
	}
	return { recognized: true, cases };
}

function parseCase(attrs: string, body: string): NormalizedTestCaseEvidence {
	const name = readXmlAttr(attrs, "name") || "unnamed testcase";
	const className = readXmlAttr(attrs, "classname");
	const filePath = readXmlAttr(attrs, "file") || undefined;
	const durationSeconds = Number(readXmlAttr(attrs, "time") || "NaN");
	const failureMessage =
		readXmlAttr(firstTagAttrs(body, "failure"), "message") ||
		readXmlAttr(firstTagAttrs(body, "error"), "message") ||
		stripXml(
			body.match(/<(failure|error)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] || "",
		);
	const skipped = /<skipped\b/i.test(body);
	const failed = /<(failure|error)\b/i.test(body);
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
	const match = attrs.match(
		new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
	);
	return match ? decodeXml(match[2] || "") : null;
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
		.replace(/&#x([0-9a-f]+);/gi, (_match, digits: string) =>
			decodeCodePoint(digits, 16),
		)
		.replace(/&#([0-9]+);/g, (_match, digits: string) =>
			decodeCodePoint(digits, 10),
		)
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function decodeCodePoint(digits: string, radix: number) {
	const value = Number.parseInt(digits, radix);
	return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff
		? String.fromCodePoint(value)
		: "�";
}

function extractCompleteJunitDocument(xml: string) {
	const match = /<testsuites?\b/i.exec(xml);
	if (match?.index === undefined) return null;
	const end = findCompleteXmlElementEnd(xml, match.index);
	return end === null ? null : xml.slice(match.index, end);
}

function findCompleteXmlElementEnd(xml: string, rootStart: number) {
	const stack: string[] = [];
	let cursor = rootStart;
	while (cursor < xml.length) {
		const tagStart = xml.indexOf("<", cursor);
		if (tagStart < 0) return null;
		if (xml.startsWith("<!--", tagStart)) {
			const end = xml.indexOf("-->", tagStart + 4);
			if (end < 0) return null;
			cursor = end + 3;
			continue;
		}
		if (xml.startsWith("<![CDATA[", tagStart)) {
			const end = xml.indexOf("]]>", tagStart + 9);
			if (end < 0) return null;
			cursor = end + 3;
			continue;
		}
		if (xml.startsWith("<?", tagStart)) {
			const end = xml.indexOf("?>", tagStart + 2);
			if (end < 0) return null;
			cursor = end + 2;
			continue;
		}
		const tagEnd = findXmlTagEnd(xml, tagStart + 1);
		if (tagEnd < 0) return null;
		const tag = xml.slice(tagStart + 1, tagEnd).trim();
		if (tag.startsWith("!")) {
			cursor = tagEnd + 1;
			continue;
		}
		const closing = tag.startsWith("/");
		const name = tag
			.match(closing ? /^\/\s*([\w:.-]+)/ : /^([\w:.-]+)/)?.[1]
			?.toLowerCase();
		if (!name) return null;
		if (closing) {
			if (stack.pop() !== name) return null;
			if (stack.length === 0) return tagEnd + 1;
		} else if (!/\/\s*$/.test(tag)) {
			stack.push(name);
		} else if (stack.length === 0) {
			return tagEnd + 1;
		}
		cursor = tagEnd + 1;
	}
	return null;
}

function findXmlTagEnd(xml: string, start: number) {
	let quote: '"' | "'" | null = null;
	for (let index = start; index < xml.length; index += 1) {
		const character = xml[index];
		if (quote) {
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
		} else if (character === ">") {
			return index;
		}
	}
	return -1;
}
