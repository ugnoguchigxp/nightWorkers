import type { PlanModeTaskMessage } from "../nightworkers/nightworkers.plan-mode-core.port";

export function buildQuestionnairePlanModeContext(
	messages: PlanModeTaskMessage[],
) {
	const artifactLines: string[] = [];
	const authSignals = new Set<string>();
	for (const message of messages) {
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		const intent = String(metadata.intent || "").trim();
		const view = String(metadata.view || "").trim();
		const artifactKind = String(metadata.artifactKind || "").trim();
		const title = String(metadata.title || "").trim();
		if (intent || view || artifactKind) {
			artifactLines.push(
				`- message=${message.id}; type=${message.messageType || "message"}; intent=${intent || "none"}; view=${view || "none"}; artifactKind=${artifactKind || "none"}; title=${title || compactQuestionnaireContext(message.content, 80)}`,
			);
		}
		for (const signal of detectAuthBoundarySignals([
			message.content,
			JSON.stringify(metadata),
		])) {
			authSignals.add(signal);
		}
	}
	const lines = [
		"Generated artifacts available before Questionnaire:",
		...(artifactLines.length > 0 ? artifactLines.slice(-12) : ["- none"]),
		"",
		"Auth / permission context:",
		authSignals.size > 0
			? `- detected surfaces/signals: ${Array.from(authSignals).sort().join(", ")}`
			: "- no explicit auth/protected/public signal detected",
		"- If public/protected/auth/admin surfaces are mixed or target placement is unclear, ask a concrete route/API/data protection question.",
		"- If context clearly shows public-only or auth-only target, do not ask redundant auth questions.",
	];
	return lines.join("\n");
}

function detectAuthBoundarySignals(values: Array<string | null | undefined>) {
	const joined = values.filter(Boolean).join("\n").toLowerCase();
	const signals: string[] = [];
	if (/\bauth\b|認証|login|ログイン|session|セッション/.test(joined))
		signals.push("auth");
	if (/protected|保護|private|非公開/.test(joined)) signals.push("protected");
	if (/public|公開|guest|anonymous|匿名/.test(joined)) signals.push("public");
	if (/admin|管理者|permission|権限|role|ロール/.test(joined))
		signals.push("permission");
	return signals;
}

function compactQuestionnaireContext(
	value: string | null | undefined,
	limit: number,
) {
	const text = String(value || "")
		.replace(/\s+/g, " ")
		.trim();
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
