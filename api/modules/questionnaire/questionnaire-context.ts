import type { PlanModeTaskMessage } from "../nightworkers/nightworkers.plan-mode-core.port";

export function buildQuestionnairePlanModeContext(
	messages: PlanModeTaskMessage[],
) {
	const messageFacts: string[] = [];
	for (const message of messages.slice(-12)) {
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		const intent = String(metadata.intent || "").trim();
		const view = String(metadata.view || "").trim();
		const artifactKind = String(metadata.artifactKind || "").trim();
		const title = String(metadata.title || "").trim();
		messageFacts.push(
			`- message=${message.id}; type=${message.messageType || "message"}; intent=${intent || "none"}; view=${view || "none"}; artifactKind=${artifactKind || "none"}; title=${title || "none"}; contentExcerpt=${compactQuestionnaireContext(message.content, 240) || "none"}`,
		);
	}
	const lines = [
		"Recent Plan Mode message facts:",
		...(messageFacts.length > 0 ? messageFacts : ["- none"]),
		"",
		"Questionnaire 判断指示:",
		"- 上記の message metadata と本文抜粋を事実として読み、固定 keyword 分類を使わずに未確定の設計判断を推論してください。",
		"- public / protected / auth / admin の面が混在する、または対象配置が不明な場合だけ、route / API / data の保護方針を具体的に確認してください。",
		"- context から public-only または auth-only と判断できる場合は、同じ認証質問を繰り返さないでください。",
	];
	return lines.join("\n");
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
