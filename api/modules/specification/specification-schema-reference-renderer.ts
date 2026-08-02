import { createHash } from "node:crypto";
import type {
	DesignQuestionnaire,
	DesignQuestionnaireAnswer,
} from "../../../shared/schemas/design-questionnaire.schema";
import { getSessionQuestions } from "../questionnaire/questionnaire-parser.service";

type JsonRecord = Record<string, unknown>;
type TaskMessageRow = {
	id: string;
	content?: string | null;
	messageType?: string | null;
	metadataJson?: unknown | null;
};
type QuestionnaireAnswerRow = {
	questionId: string;
	answer: DesignQuestionnaireAnswer;
};
type QuestionnaireSessionLike = {
	id: string;
	questionSets: Array<{ questionnaire: DesignQuestionnaire | null }>;
	answers: QuestionnaireAnswerRow[];
};

export function digestText(value: string) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function uniqueStrings(values: string[]) {
	return [...new Set(values)];
}

export function compactJson(value: unknown) {
	if (typeof value === "string") return value;
	if (value === null || value === undefined) return "";
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

export function renderApiContractReference(artifact: JsonRecord | null) {
	if (!artifact) return "";
	const lines = [
		`API Contract: ${String(artifact.title || "API Contract")}`,
		artifact.summary
			? `Summary: ${compactText(String(artifact.summary), 180)}`
			: "",
	].filter(Boolean);
	const openapi = isRecord(artifact.openapi) ? artifact.openapi : {};
	const paths = isRecord(openapi.paths) ? openapi.paths : {};
	const operations = Object.entries(paths).flatMap(([path, methods]) => {
		if (!isRecord(methods)) return [];
		return Object.entries(methods)
			.map(([method, operation]) => {
				const record = isRecord(operation) ? operation : {};
				const operationId = String(record.operationId || "");
				const summary = compactText(
					String(record.summary || record.description || ""),
					100,
				);
				const requestShape = summarizeRequestShape(
					record.requestBody,
					artifact,
				);
				const responseShape = summarizeResponseShape(
					record.responses,
					artifact,
				);
				return [
					`- ${method.toUpperCase()} ${path}${operationId ? ` (${operationId})` : ""}${summary ? `: ${summary}` : ""}`,
					requestShape ? `  request: ${requestShape}` : null,
					responseShape ? `  response/error: ${responseShape}` : null,
				]
					.filter(Boolean)
					.join("\n");
			})
			.slice(0, 8);
	});
	if (operations.length > 0) {
		lines.push("Operations:", ...operations.slice(0, 10));
	}
	return lines.join("\n");
}

export function summarizeRequestShape(value: unknown, artifact: JsonRecord) {
	if (!isRecord(value)) return "";
	const schemaName = schemaNameFromContent(value);
	const shape = schemaName
		? summarizeComponentSchema(artifact, schemaName)
		: summarizeJsonShape(value);
	const required =
		value.required === false
			? "optional"
			: value.required === true
				? "required"
				: "";
	return [schemaName, required, shape].filter(Boolean).join("; ");
}

export function summarizeResponseShape(value: unknown, artifact: JsonRecord) {
	if (!isRecord(value)) return "";
	return Object.entries(value)
		.slice(0, 5)
		.map(([status, response]) => {
			const record = isRecord(response) ? response : {};
			const schemaName = schemaNameFromContent(record);
			const shape = schemaName
				? summarizeComponentSchema(artifact, schemaName)
				: summarizeJsonShape(record);
			return `${status}${schemaName ? ` ${schemaName}` : ""}${shape ? ` {${shape}}` : ""}`;
		})
		.join(" / ");
}

export function schemaNameFromContent(value: JsonRecord) {
	const content = isRecord(value.content) ? value.content : {};
	const json = isRecord(content["application/json"])
		? content["application/json"]
		: {};
	const schema = isRecord(json.schema) ? json.schema : {};
	const ref = typeof schema.$ref === "string" ? schema.$ref : "";
	return ref.split("/").pop() || "";
}

export function summarizeComponentSchema(
	artifact: JsonRecord,
	schemaName: string,
) {
	const openapi = isRecord(artifact.openapi) ? artifact.openapi : {};
	const components = isRecord(openapi.components) ? openapi.components : {};
	const schemas = isRecord(components.schemas) ? components.schemas : {};
	const schema = isRecord(schemas[schemaName]) ? schemas[schemaName] : null;
	if (!schema) return "";
	const properties = isRecord(schema.properties) ? schema.properties : {};
	const required = new Set(
		Array.isArray(schema.required) ? schema.required.map(String) : [],
	);
	const fields = Object.entries(properties)
		.slice(0, 8)
		.map(([name, field]) => {
			const record = isRecord(field) ? field : {};
			const type = Array.isArray(record.enum)
				? `enum(${record.enum.map(String).join("|")})`
				: String(record.type || "unknown");
			return `${name}:${type}${required.has(name) ? "" : "?"}`;
		});
	return fields.join(", ");
}

export function summarizeJsonShape(value: JsonRecord) {
	const schema = isRecord(value.schema) ? value.schema : value;
	const properties = isRecord(schema.properties) ? schema.properties : {};
	if (Object.keys(properties).length === 0) return "";
	const required = new Set(
		Array.isArray(schema.required) ? schema.required.map(String) : [],
	);
	return Object.entries(properties)
		.slice(0, 8)
		.map(([name, field]) => {
			const record = isRecord(field) ? field : {};
			const type = Array.isArray(record.enum)
				? `enum(${record.enum.map(String).join("|")})`
				: String(record.type || "unknown");
			return `${name}:${type}${required.has(name) ? "" : "?"}`;
		})
		.join(", ");
}

export function renderZodSchemaReference(artifact: JsonRecord | null) {
	if (!artifact) return "";
	const lines = [
		`Zod Schema: ${String(artifact.schemaName || artifact.title || "Zod Schema")}`,
		artifact.summary
			? `Summary: ${compactText(String(artifact.summary), 180)}`
			: "",
		artifact.owner ? `Owner: ${String(artifact.owner)}` : "",
	].filter(Boolean);
	const fields = toRecordArray(artifact.fields).slice(0, 10);
	if (fields.length > 0) {
		lines.push(
			`Fields: ${fields
				.map((field) => {
					const name = String(field.name || "");
					const type = String(field.type || "unknown");
					const required = field.required === false ? "optional" : "required";
					const enumOptions = Array.isArray(field.enumOptions)
						? field.enumOptions.map(String).filter(Boolean)
						: [];
					return `${name}:${type}/${required}${enumOptions.length ? `(${enumOptions.join("|")})` : ""}`;
				})
				.filter(Boolean)
				.join(" / ")}`,
		);
	}
	const zodSource =
		typeof artifact.zodSource === "string" ? artifact.zodSource : "";
	const inferredShape = summarizeZodSourceShape(zodSource);
	if (inferredShape) lines.push(`JSON shape: ${inferredShape}`);
	return lines.join("\n");
}

export function summarizeZodSourceShape(source: string) {
	if (!source.trim()) return "";
	const objectMatch = source.match(/z\.object\(\s*\{([\s\S]*?)\}\s*\)/);
	const body = objectMatch?.[1] || "";
	if (!body.trim()) return "";
	const fields = [
		...body.matchAll(
			/([A-Za-z_$][\w$]*)\s*:\s*z\.([A-Za-z]+)([\s\S]*?)(?:,|\n|$)/g,
		),
	]
		.slice(0, 8)
		.map((match) => {
			const name = match[1];
			const type = match[2];
			const chain = match[3] || "";
			return `${name}:${type}${chain.includes(".optional()") ? "?" : ""}`;
		});
	return fields.join(", ");
}

export function ddlType(value: unknown) {
	if (value === "number" || value === "integer") return "INTEGER";
	if (value === "boolean") return "BOOLEAN";
	if (value === "date" || value === "datetime" || value === "timestamp")
		return "DATETIME";
	if (value === "json") return "JSON";
	return "TEXT";
}

export function safeSqlIdentifier(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

export function compactText(value: string, limit: number) {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= limit) return text;
	return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

export function findLatestBlueprintMessage(
	messages: TaskMessageRow[],
	input: { kind: "blueprint"; preferredMessageId?: string | null },
) {
	const isTargetBlueprintMessage = (message: TaskMessageRow) => {
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		const hasBlueprint =
			(metadata.intent === "app_blueprint" && metadata.appBlueprint) ||
			(metadata.intent === "mock_blueprint" && metadata.mockBlueprint);
		if (!hasBlueprint) return false;
		if (isDataModelMessageMetadata(metadata)) return false;
		return input.kind === "blueprint";
	};
	if (input.preferredMessageId) {
		const preferred = messages.find(
			(message) =>
				message.id === input.preferredMessageId &&
				isTargetBlueprintMessage(message),
		);
		if (preferred) return preferred;
	}
	return [...messages].reverse().find(isTargetBlueprintMessage);
}

export function findLatestDataModelMessage(messages: TaskMessageRow[]) {
	return [...messages].reverse().find((message) => {
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		return isDataModelMessageMetadata(metadata);
	});
}

export function findLatestPlanViewMessage(
	messages: TaskMessageRow[],
	view: "api_io_contract" | "zod_schema_design",
) {
	return [...messages].reverse().find((message) => {
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		return Boolean(
			metadata.view === view &&
				(metadata.artifactKind === "plan_mode_api_contract" ||
					metadata.artifactKind === "plan_mode_zod_schema" ||
					metadata.artifactKind === "plan_mode_dedicated_view" ||
					metadata.intent === "plan_mode_dedicated_view" ||
					metadata.apiContract ||
					metadata.zodSchema),
		);
	});
}

export function getMessageBlueprint(
	message: TaskMessageRow | undefined,
): JsonRecord | null {
	const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
	const blueprint = metadata.appBlueprint || metadata.mockBlueprint;
	return isRecord(blueprint) ? blueprint : null;
}

export function getMessageDataModelArtifact(
	message: TaskMessageRow | undefined,
): JsonRecord | null {
	const metadata = isRecord(message?.metadataJson) ? message.metadataJson : {};
	const artifact = metadata.dataModelArtifact;
	if (isRecord(artifact)) return artifact;
	return null;
}

export function getMessageApiContract(
	message: TaskMessageRow | undefined,
): JsonRecord | null {
	if (!message || !isRecord(message.metadataJson)) return null;
	const metadata = message.metadataJson;
	if (isRecord(metadata.apiContract)) return metadata.apiContract;
	if (isRecord(metadata.artifactPayload)) return metadata.artifactPayload;
	return metadata.artifactKind === "plan_mode_api_contract" ? metadata : null;
}

export function getMessageZodSchema(
	message: TaskMessageRow | undefined,
): JsonRecord | null {
	if (!message || !isRecord(message.metadataJson)) return null;
	const metadata = message.metadataJson;
	if (isRecord(metadata.zodSchema)) return metadata.zodSchema;
	if (isRecord(metadata.artifactPayload)) return metadata.artifactPayload;
	return metadata.artifactKind === "plan_mode_zod_schema" ? metadata : null;
}

export function isDataModelMessageMetadata(metadata: JsonRecord) {
	return (
		(metadata.artifactKind === "plan_mode_dedicated_view" &&
			metadata.view === "data_model") ||
		metadata.source === "data-model" ||
		metadata.artifactType === "data_model"
	);
}

export function isRecord(value: unknown): value is JsonRecord {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function toRecordArray(value: unknown): JsonRecord[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function renderQuestionnaireAnswerMarkdown(
	session: QuestionnaireSessionLike,
) {
	const answerByQuestionId = new Map(
		session.answers.map((item) => [item.questionId, item]),
	);
	const lines: string[] = [];
	for (const question of toRecordArray(getSessionQuestions(session))) {
		const answer = answerByQuestionId.get(String(question.id));
		lines.push(`- ${question.question}`);
		if (question.decisionKey)
			lines.push(`  - Decision key: ${question.decisionKey}`);
		lines.push(
			`  - Answer: ${renderQuestionnaireAnswer(question, answer?.answer)}`,
		);
		if (question.why) lines.push(`  - Why: ${question.why}`);
		if (question.outputSection)
			lines.push(`  - Section: ${question.outputSection}`);
	}
	return lines.length > 0 ? lines.join("\n") : "- No questionnaire answers.";
}

export function renderQuestionnaireAnswer(
	question: JsonRecord,
	answer: DesignQuestionnaireAnswer | undefined,
) {
	if (!answer) return "未回答";
	if (answer.deferred) return "後で決める";
	if (typeof answer.booleanValue === "boolean")
		return answer.booleanValue ? "はい" : "いいえ";
	if (answer.freeText?.trim()) return answer.freeText.trim();
	const options = new Map(
		toRecordArray(question.options).map((option) => [
			String(option.id),
			String(option.label || option.id),
		]),
	);
	const selected = [
		...(Array.isArray(answer.selectedOptionIds)
			? answer.selectedOptionIds
			: []),
		...(Array.isArray(answer.rankedOptionIds) ? answer.rankedOptionIds : []),
	]
		.map((id) => options.get(id) || id)
		.filter(Boolean);
	return selected.length > 0 ? selected.join(", ") : "未回答";
}
