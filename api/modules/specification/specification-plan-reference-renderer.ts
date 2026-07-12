import type { PlanModeWorkspace } from "../../../shared/schemas/plan-mode-artifact.schema";
import { renderCompressedBlueprintNaturalLanguage } from "./specification-blueprint-renderer";
import type { AssembledDesignContextSectionKind } from "./specification-document-renderer";
import {
	compactJson,
	compactText,
	ddlType,
	getMessageApiContract,
	getMessageDataModelArtifact,
	getMessageZodSchema,
	isRecord,
	renderApiContractReference,
	renderZodSchemaReference,
	safeSqlIdentifier,
	toRecordArray,
} from "./specification-schema-reference-renderer";

type JsonRecord = Record<string, unknown>;
type TaskMessageRow = {
	id: string;
	content?: string | null;
	messageType?: string | null;
	metadataJson?: unknown | null;
};

export function renderDataModelDdlReference(artifact: JsonRecord | null) {
	if (!artifact) return "Data Model は未生成です。";
	const ddl = typeof artifact.ddl === "string" ? artifact.ddl.trim() : "";
	if (ddl) return ddl;
	const tables = toRecordArray(artifact.derivedTables);
	const relations = toRecordArray(artifact.relations);
	if (tables.length === 0)
		return "Data Model には table が定義されていません。";
	const lines: string[] = [];
	for (const table of tables) {
		const tableName = safeSqlIdentifier(
			String(table.name || table.id || "table"),
		);
		const columns = toRecordArray(table.columns);
		lines.push(`CREATE TABLE ${tableName} (`);
		if (columns.length === 0) {
			lines.push("  -- columns are not defined");
		} else {
			columns.forEach((column, index) => {
				const columnName = safeSqlIdentifier(
					String(column.name || column.id || `column_${index + 1}`),
				);
				const type = ddlType(column.type);
				const constraints = [
					column.primaryKey ? "PRIMARY KEY" : null,
					column.nullable === false ? "NOT NULL" : null,
					column.unique ? "UNIQUE" : null,
				].filter(Boolean);
				const suffix = index === columns.length - 1 ? "" : ",";
				lines.push(
					`  ${columnName} ${type}${constraints.length ? ` ${constraints.join(" ")}` : ""}${suffix}`,
				);
			});
		}
		lines.push(");");
		if (Array.isArray(table.indexes)) {
			for (const index of table.indexes.slice(0, 4)) {
				const fields = Array.isArray(index)
					? index.map((field) => safeSqlIdentifier(String(field)))
					: [];
				if (fields.length > 0) {
					lines.push(
						`CREATE INDEX idx_${tableName}_${fields.join("_")} ON ${tableName} (${fields.join(", ")});`,
					);
				}
			}
		}
		lines.push("");
	}
	for (const relation of relations) {
		const fromTable = safeSqlIdentifier(String(relation.fromTable || ""));
		const fromColumn = safeSqlIdentifier(String(relation.fromColumn || ""));
		const toTable = safeSqlIdentifier(String(relation.toTable || ""));
		const toColumn = safeSqlIdentifier(String(relation.toColumn || ""));
		if (fromTable && fromColumn && toTable && toColumn) {
			lines.push(
				`ALTER TABLE ${fromTable} ADD FOREIGN KEY (${fromColumn}) REFERENCES ${toTable} (${toColumn});`,
			);
		}
	}
	return lines.join("\n").trim();
}

export function renderAssembledDataModelContract(artifact: JsonRecord) {
	const lines = [
		`Canonical source: ${String(artifact.canonicalSource || "unknown")}`,
		artifact.summary
			? `Summary: ${compactText(String(artifact.summary), 260)}`
			: "",
	].filter(Boolean);
	const ddl = renderDataModelDdlReference(artifact);
	if (ddl) lines.push("DDL:", compactText(ddl, 1600));
	const tables = toRecordArray(artifact.derivedTables).slice(0, 12);
	if (tables.length > 0) {
		lines.push(
			"Tables:",
			...tables.map((table) => {
				const columns = toRecordArray(table.columns)
					.slice(0, 12)
					.map((column) =>
						[
							String(column.name || column.id || "column"),
							String(column.type || "unknown"),
							column.primaryKey ? "pk" : "",
							column.nullable === false ? "required" : "",
							column.unique ? "unique" : "",
						]
							.filter(Boolean)
							.join(":"),
					);
				return `- ${String(table.name || table.id || "table")}: ${columns.join(", ")}`;
			}),
		);
	}
	const relations = toRecordArray(artifact.relations).slice(0, 8);
	if (relations.length > 0) {
		lines.push(
			"Relations:",
			...relations.map(
				(relation) =>
					`- ${[
						relation.from || relation.fromTable,
						relation.cardinality,
						relation.to || relation.toTable,
						relation.reason,
					]
						.filter(Boolean)
						.map(String)
						.join(" -> ")}`,
			),
		);
	}
	const constraints = Array.isArray(artifact.constraints)
		? artifact.constraints.map(String).filter(Boolean).slice(0, 8)
		: [];
	if (constraints.length > 0)
		lines.push("Constraints:", ...constraints.map((item) => `- ${item}`));
	return lines.join("\n").trim() || "Data Model は未生成です。";
}

export function renderPlanViewReferences(input: {
	apiContract: JsonRecord | null;
	zodSchema: JsonRecord | null;
}) {
	const sections: string[] = [];
	const apiContract = renderApiContractReference(input.apiContract);
	if (apiContract) sections.push(apiContract);
	const zodSchema = renderZodSchemaReference(input.zodSchema);
	if (zodSchema) sections.push(zodSchema);
	return sections.length > 0
		? sections.join("\n\n")
		: "API Contract / Zod Schema は未生成です。";
}

export function renderPlanModeReferences(
	workspace: PlanModeWorkspace,
	messages: TaskMessageRow[],
) {
	const messageById = new Map(messages.map((message) => [message.id, message]));
	const sections = [
		"Plan Mode で既に生成済みの関連資料です。最終文書に全件列挙せず、設計判断と契約の確定に使ってください。",
		renderWorkspaceArtifactSection(
			"Feature Plans",
			workspaceArtifacts(workspace, "featurePlanArtifacts"),
			messageById,
			"feature_plan",
		),
		renderQuestionnaireSessionReferences(workspace),
		renderWorkspaceArtifactSection(
			"Blueprints",
			workspaceArtifacts(workspace, "blueprintArtifacts"),
			messageById,
			"blueprint",
		),
		renderWorkspaceArtifactSection(
			"Dedicated Views",
			workspaceArtifacts(workspace, "dedicatedViewArtifacts"),
			messageById,
			"dedicated_view",
		),
		renderWorkspaceArtifactSection(
			"Decision Reviews",
			workspaceArtifacts(workspace, "decisionReviews"),
			messageById,
			"decision_review",
		),
		renderImplementationReferenceSection(workspace, messageById),
	].filter(Boolean);
	return sections.join("\n\n");
}

export function renderWorkspaceArtifactSection(
	title: string,
	artifacts: PlanModeWorkspace["dedicatedViewArtifacts"],
	messageById: Map<string, TaskMessageRow>,
	mode: "feature_plan" | "blueprint" | "dedicated_view" | "decision_review",
) {
	if (artifacts.length === 0) return `${title}: none`;
	const lines = [`${title}:`];
	for (const artifact of artifacts) {
		const message = messageById.get(artifact.sourceMessageId);
		lines.push(renderWorkspaceArtifactReference(artifact, message, mode));
	}
	return lines.join("\n");
}

export function renderWorkspaceArtifactReference(
	artifact: PlanModeWorkspace["dedicatedViewArtifacts"][number],
	message: TaskMessageRow | undefined,
	mode: "feature_plan" | "blueprint" | "dedicated_view" | "decision_review",
) {
	const details = [
		`id=${artifact.id}`,
		`kind=${artifact.kind}`,
		`message=${artifact.sourceMessageId}`,
		artifact.adoptionState ? `adoption=${artifact.adoptionState}` : null,
		artifact.sourceArtifactMessageId
			? `source=${artifact.sourceArtifactMessageId}`
			: null,
	].filter(Boolean);
	const summary = compactText(
		renderMessageReferenceSummary(message, mode),
		760,
	);
	return `- ${artifact.title} (${details.join("; ")})${summary ? `\n  summary: ${summary}` : ""}`;
}

export function renderQuestionnaireSessionReferences(
	workspace: PlanModeWorkspace,
) {
	const sessions = workspace.questionnaireSessions || [];
	if (sessions.length === 0) return "Questionnaire Sessions: none";
	const lines = ["Questionnaire Sessions:"];
	for (const session of sessions) {
		const details = [
			`id=${session.id}`,
			`status=${session.status}`,
			`answered=${session.answeredCount}/${session.totalQuestionCount}`,
			session.sourceBlueprintMessageId
				? `sourceBlueprint=${session.sourceBlueprintMessageId}`
				: null,
			session.latestReviewId ? `latestReview=${session.latestReviewId}` : null,
		].filter(Boolean);
		lines.push(`- ${details.join("; ")}`);
	}
	return lines.join("\n");
}

export function renderImplementationReferenceSection(
	workspace: PlanModeWorkspace,
	messageById: Map<string, TaskMessageRow>,
) {
	const references = workspace.implementationReferences || [];
	if (references.length === 0) return "Implementation References: none";
	const lines = ["Implementation References:"];
	for (const reference of references) {
		const message = reference.sourceMessageId
			? messageById.get(reference.sourceMessageId)
			: undefined;
		const details = [
			`id=${reference.id}`,
			`task=${reference.taskId}`,
			reference.sourceMessageId ? `message=${reference.sourceMessageId}` : null,
		].filter(Boolean);
		const summary = compactText(
			renderMessageReferenceSummary(message, "feature_plan"),
			760,
		);
		lines.push(
			`- ${reference.title} (${details.join("; ")})${summary ? `\n  summary: ${summary}` : ""}`,
		);
	}
	return lines.join("\n");
}

export function renderMessageReferenceSummary(
	message: TaskMessageRow | undefined,
	mode: "feature_plan" | "blueprint" | "dedicated_view" | "decision_review",
) {
	if (!message || !isRecord(message.metadataJson))
		return compactText(message?.content || "", 760);
	const metadata = message.metadataJson;
	if (mode === "blueprint") {
		const blueprint = metadata.appBlueprint || metadata.mockBlueprint;
		return isRecord(blueprint)
			? renderCompressedBlueprintNaturalLanguage(blueprint)
			: "";
	}
	if (mode === "dedicated_view") {
		const apiContract = getMessageApiContract(message);
		if (apiContract) return renderApiContractReference(apiContract);
		const zodSchema = getMessageZodSchema(message);
		if (zodSchema) return renderZodSchemaReference(zodSchema);
		const dataModel = getMessageDataModelArtifact(message);
		if (dataModel) return renderDataModelSummary(dataModel);
		return String(metadata.markdown || message.content || "");
	}
	if (mode === "decision_review") {
		return compactJson(
			metadata.designDecisionReview ||
				metadata.markdownDocumentData ||
				message.content,
		);
	}
	return String(
		(isRecord(metadata.markdownDocumentData)
			? metadata.markdownDocumentData.content
			: "") ||
			metadata.markdown ||
			message.content ||
			"",
	);
}

export function renderDataModelSummary(artifact: JsonRecord) {
	const lines = [];
	if (artifact.summary)
		lines.push(`Summary: ${compactText(String(artifact.summary), 240)}`);
	const tables = toRecordArray(artifact.derivedTables)
		.map((table) => String(table.name || table.id || "table"))
		.filter(Boolean)
		.slice(0, 12);
	if (tables.length > 0) lines.push(`Tables: ${tables.join(" / ")}`);
	const constraints = Array.isArray(artifact.constraints)
		? artifact.constraints.map(String).filter(Boolean).slice(0, 6)
		: [];
	if (constraints.length > 0)
		lines.push(`Constraints: ${constraints.join(" / ")}`);
	const ddl =
		typeof artifact.ddl === "string" ? compactText(artifact.ddl, 420) : "";
	if (ddl) lines.push(`DDL: ${ddl}`);
	return lines.join("\n");
}

export function workspaceArtifacts<K extends keyof PlanModeWorkspace>(
	workspace: PlanModeWorkspace,
	key: K,
): PlanModeWorkspace[K] extends unknown[] ? PlanModeWorkspace[K] : [] {
	const value = workspace[key];
	return (
		Array.isArray(value) ? value : []
	) as PlanModeWorkspace[K] extends unknown[] ? PlanModeWorkspace[K] : [];
}

export function extractOmittedViewDecisions(messages: TaskMessageRow[]) {
	const byView = new Map<string, { view: string; reason?: string }>();
	for (const message of messages) {
		const metadata = isRecord(message.metadataJson) ? message.metadataJson : {};
		const planModeGate = isRecord(metadata.planModeGate)
			? metadata.planModeGate
			: null;
		const originalGate =
			planModeGate && isRecord(planModeGate.originalGate)
				? planModeGate.originalGate
				: null;
		const candidates = [
			originalGate?.dedicatedViews,
			isRecord(metadata.planMode) ? metadata.planMode.dedicatedViews : null,
			planModeGate?.dedicatedViews,
			metadata.dedicatedViews,
			metadata.viewDecisions,
		];
		for (const candidate of candidates) {
			if (!Array.isArray(candidate)) continue;
			for (const item of candidate) {
				if (!isRecord(item)) continue;
				const view = typeof item.view === "string" ? item.view : "";
				if (!view || item.decision !== "omit") continue;
				byView.set(view, {
					view,
					...(typeof item.reason === "string" ? { reason: item.reason } : {}),
				});
			}
		}
	}
	return [...byView.values()];
}

export function isFlowViewKind(
	value: string,
): value is Extract<
	AssembledDesignContextSectionKind,
	"user_flow" | "activity_flow" | "sequence_flow"
> {
	return (
		value === "user_flow" ||
		value === "activity_flow" ||
		value === "sequence_flow"
	);
}

export function formatDesignContextKind(kind: string) {
	return kind
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}
