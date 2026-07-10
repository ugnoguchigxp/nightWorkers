import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRuntimeResult } from "../../../services/agent-runtime/types";
import type { RuntimePromptSnapshot } from "../../../services/todo-context";

const TEST_MODE_NEXT_STEP_LABEL =
	"テストモードに入り、完了条件テストの構築をする";
const REVIEW_MODE_NEXT_STEP_LABEL = "レビューモードに移行する";

export function appendTestModeNextStepLink(input: {
	finalReport: string;
	taskId: string;
	executionMode?: RuntimePromptSnapshot["executionMode"] | null;
	status: AgentRuntimeResult["terminalState"];
	repoRoot?: string | null;
}) {
	let report = input.finalReport.trim();
	if (input.executionMode === "review") {
		return sanitizeReviewFinalReportLinks(report, input.repoRoot);
	}
	if (input.executionMode === "test") {
		if (input.status !== "completed" && input.status !== "needs_review") {
			return report;
		}
		report = stripTestModeFollowUpSuggestions(report);
		const href = `/sessions/${encodeURIComponent(input.taskId)}?artifact=review_status`;
		report = removeReviewModeNextStepLinks(report);
		const link = `[${REVIEW_MODE_NEXT_STEP_LABEL}](${href})`;
		return report ? `${report}\n\n${link}` : link;
	}
	if (input.status !== "completed" && input.status !== "needs_review") {
		return report;
	}
	if (input.executionMode !== "implementation") return report;
	if (
		report.includes(TEST_MODE_NEXT_STEP_LABEL) ||
		report.includes("artifact=test_mode")
	) {
		return report;
	}
	const href = `/sessions/${encodeURIComponent(input.taskId)}?artifact=test_mode`;
	return [report, "", `[${TEST_MODE_NEXT_STEP_LABEL}](${href})`]
		.filter(Boolean)
		.join("\n");
}

export function sanitizeReviewFinalReportLinks(
	report: string,
	repoRoot?: string | null,
) {
	const root = repoRoot ? path.resolve(repoRoot) : null;
	return report.replace(
		/\[([^\]\n]+)\]\(\s*([^)]+?)\s*\)/g,
		(match, label: string, href: string) => {
			const localPath = localFilesystemPathFromHref(href);
			if (!localPath) return match;
			if (root && isPathInsideRoot(localPath, root)) return match;
			return outsideProjectLinkReplacement(label);
		},
	);
}

function outsideProjectLinkReplacement(label: string) {
	const text = label.trim();
	const comparableText = text.replace(/^`+|`+$/g, "");
	if (!text || looksLikeLocalPath(comparableText)) {
		return "`外部ファイルへのリンクは省略しました`";
	}
	return text;
}

function localFilesystemPathFromHref(href: string) {
	const raw = href.trim().replace(/^<|>$/g, "");
	if (!raw) return null;
	if (raw.startsWith("file://")) {
		try {
			return path.resolve(fileURLToPath(raw));
		} catch {
			return null;
		}
	}
	if (/^https?:\/\//i.test(raw)) {
		try {
			const url = new URL(raw);
			if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
				return null;
			}
			return path.isAbsolute(url.pathname)
				? path.resolve(decodeURIComponent(url.pathname))
				: null;
		} catch {
			return null;
		}
	}
	const withoutFragment = raw.split("#")[0]?.split("?")[0] ?? "";
	return path.isAbsolute(withoutFragment)
		? path.resolve(decodeURIComponent(withoutFragment))
		: null;
}

function isPathInsideRoot(candidate: string, root: string) {
	const resolved = path.resolve(candidate);
	return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function looksLikeLocalPath(value: string) {
	const trimmed = value.trim();
	if (trimmed.startsWith("file://")) return true;
	if (/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])/i.test(trimmed)) {
		return true;
	}
	return path.isAbsolute(trimmed);
}

function stripTestModeFollowUpSuggestions(report: string) {
	const lines = report.split(/\r?\n/);
	const start = lines.findIndex((line) => line.trim().startsWith("必要なら次"));
	if (start < 0) return report.trim();
	const end = lines.findIndex(
		(line, index) =>
			index > start &&
			(line.includes(REVIEW_MODE_NEXT_STEP_LABEL) ||
				line.includes("artifact=review_status")),
	);
	const stripped =
		end >= 0
			? [...lines.slice(0, start), ...lines.slice(end)]
			: lines.slice(0, start);
	return stripped
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function removeReviewModeNextStepLinks(report: string) {
	return report
		.split(/\r?\n/)
		.filter(
			(line) =>
				!line.includes(REVIEW_MODE_NEXT_STEP_LABEL) &&
				!line.includes("artifact=review_status"),
		)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}
