type JsonRecord = Record<string, unknown>;

import { SPECIFICATION_ACCEPTANCE_CRITERION_TITLE_GUIDANCE_JA } from "../../../shared/schemas/verification-checklist.schema";
import {
	compactText,
	isRecord,
	toRecordArray,
} from "./specification-schema-reference-renderer";

export function buildImplementationPlanGuidance(context: string) {
	const lower = context.toLowerCase();
	const hasUi =
		/react|vite|画面|screen|page|route|ui|frontend|component|form|table/.test(
			lower,
		);
	const hasApi = /hono|api|endpoint|route|request|response|backend|server/.test(
		lower,
	);
	const hasDb =
		/sqlite|postgres|drizzle|database|db|schema|migration|ddl|create table|alter table|table/.test(
			lower,
		);
	const hasTests = /vitest|playwright|test|e2e|unit|verify|検証/.test(lower);
	const hasRiskyBoundary =
		/auth|permission|migration|schema|queue|runtime|worker|external|payment|security|認証|権限|移行|マイグレーション/.test(
			lower,
		);
	const touchedLayers = [
		hasDb ? "DB/schema" : null,
		hasApi ? "API/backend" : null,
		hasUi ? "UI/frontend" : null,
		hasTests ? "test/verification" : null,
	].filter(Boolean);
	const hasSchemaChange =
		hasDb && /create table|alter table|migration|schema|ddl|table/.test(lower);
	const classification =
		hasSchemaChange && touchedLayers.length >= 3
			? "標準タスク（DB 変更部分は高リスク相当）"
			: hasRiskyBoundary && touchedLayers.length >= 3
				? "高リスクタスク"
				: touchedLayers.length >= 2
					? "標準タスク"
					: "軽量タスク";
	const lines = [
		`分類: ${classification}`,
		`理由: 変更候補レイヤーは ${touchedLayers.length > 0 ? touchedLayers.join(" / ") : "未検出"}。`,
		"出力方針: 重複説明を避け、実装者が進める順序と参照すべき artifact だけを短く書く。",
		"採用判断: Questionnaire Decisions を優先する。DDL reference に含まれる将来拡張や対象外要素は実装対象にしない。",
		"判断方針: 既存資料から合理的に決められることは前提として固定し、open question は実装不能または危険な欠落だけに限定する。",
		"契約詳細: API / UI / DB / validation / flow の詳細は各 Plan Mode artifact と assembled design context を正とし、Feature Plan 本文に再掲しない。",
	];

	if (classification === "軽量タスク") {
		lines.push(
			"計画粒度: 対象、非対象、変更ファイル候補、確認コマンドに絞る。",
			"実装計画: 既存パターンに合わせた最小差分で、検証可能な完了条件を短く書く。",
		);
	} else {
		lines.push(
			"計画粒度: 実装順、層ごとの契約、非対象、検証計画、完了条件を本文に分けて書く。",
			"実装計画: DB/API/UI/test をまたぐ場合は、依存する順に番号付きで作業を並べる。",
		);
	}

	if (hasSchemaChange) {
		lines.push(
			"DB 変更: Data Model DDL reference は設計根拠として扱う。実装では既存 tooling に従って schema/migration を作成し、適用と検証を独立した手順にする。",
			"DB 変更のテスト観点: migration適用、既存データ互換性、保存整合性のうち、このTaskで失敗を許容できない観点だけを完了条件に含める。具体的なtable/index/constraintやfixtureはrepository調査後に決める。",
		);
	}

	if (hasApi) {
		lines.push(
			"API: API Contract artifact を正として route / schema / error handling を実装する手順を短く書く。",
		);
	}
	if (hasUi) {
		lines.push(
			"UI: Blueprint artifact を正として route、主要 state、操作導線を実装する手順を短く書く。",
		);
	}
	lines.push(
		"完了条件: Taskの達成に不可欠な観点の最小集合だけを書く。主要動作、重要なvalidation・error、権限境界、永続化・状態遷移の不変条件から該当するものを選び、自動テストを要求するかはQuestionnaireの検証方針に従う。",
		`完了条件: ${SPECIFICATION_ACCEPTANCE_CRITERION_TITLE_GUIDANCE_JA}`,
		"完了条件: 類似ケースや同じ利用フローは、今回の仕様上の要点が伝わる1項目にまとめる。各titleは挙動と結果に集中させ、テスト対象、関数名、handler、repository、component、fixture、具体的な入力、操作、アサーションはCoding Agentのrepository調査後のテスト設計で具体化する。",
		"検証: 品質ゲートがPassした証跡を持つこと。具体的なcommandと品質ゲートの構成はProjectを観測したCoding Agentが判断する。",
		"禁止: 元資料、Evidence、Questionnaire の raw answer、API schema、DDL、Blueprint 詳細を本文に再掲しない。",
	);
	return lines.join("\n");
}

export function renderCompressedBlueprintNaturalLanguage(
	blueprint: JsonRecord | null,
) {
	if (!blueprint) return "Blueprint は未生成です。";
	const lines = [
		`Blueprint "${String(blueprint.name || blueprint.id || "App Blueprint")}" を採用しています。`,
	];
	if (blueprint.description) {
		lines.push(`全体方針: ${compactText(String(blueprint.description), 280)}`);
	}
	const screens = toRecordArray(blueprint.screens).slice(0, 4);
	for (const screen of screens) {
		const screenName = String(screen.name || screen.id || "Unnamed screen");
		const path = screen.path ? ` (${String(screen.path)})` : "";
		lines.push(
			`画面: ${screenName}${path}。画面種別は ${String(screen.componentName || "Page")}。`,
		);
		const sections = toRecordArray(screen.sections).slice(0, 8);
		for (const section of sections) {
			const props = isRecord(section.props) ? section.props : {};
			const label = String(
				section.name || props.title || section.id || "Unnamed section",
			);
			const component = String(section.componentName || "Section");
			const description = compactText(
				String(
					props.description || section.visualIntent || section.intent || "",
				).trim(),
				220,
			);
			const details = summarizeSectionProps(section);
			lines.push(
				`- 採用 section: ${label}。component は ${component}。${description || "この画面の主要確認対象です。"}${details ? ` ${details}` : ""}`,
			);
		}
	}
	const tasks = toRecordArray(blueprint.implementationTasks).slice(0, 6);
	if (tasks.length > 0) {
		lines.push("実装時に意識する作業:");
		for (const task of tasks) {
			lines.push(
				`- ${compactText(String(task.title || task.id || ""), 90)}: ${compactText(String(task.description || ""), 180)}`,
			);
		}
	}
	return lines.join("\n");
}

export function summarizeSectionProps(section: JsonRecord) {
	const props = isRecord(section.props) ? section.props : {};
	const parts: string[] = [];
	const reason = compactText(
		String(section.reason || section.visualIntent || "").trim(),
		120,
	);
	const copy = compactText(
		String(props.title || props.heading || props.copy || "").trim(),
		80,
	);
	const dataset = compactText(
		String(props.dataset || section.dataset || "").trim(),
		60,
	);
	const sample = summarizeSampleValue(
		props.sample || props.samples || section.sample,
	);
	if (reason) parts.push(`意図は ${reason}。`);
	if (copy) parts.push(`表示文言は ${copy}。`);
	if (dataset) parts.push(`データ種別は ${dataset}。`);
	if (sample) parts.push(`サンプルは ${sample}。`);
	if (Array.isArray(props.columns)) {
		const columns = props.columns
			.map((column: unknown) =>
				isRecord(column)
					? String(column.title || column.name || column.id || "")
					: "",
			)
			.filter(Boolean)
			.slice(0, 5);
		if (columns.length) parts.push(`列は ${columns.join(" / ")}。`);
	}
	if (Array.isArray(props.items)) {
		const items = props.items
			.map((item: unknown) =>
				isRecord(item)
					? String(item.label || item.title || item.name || "")
					: "",
			)
			.filter(Boolean)
			.slice(0, 5);
		if (items.length) parts.push(`表示項目は ${items.join(" / ")}。`);
	}
	if (Array.isArray(props.tabs)) {
		const tabs = props.tabs
			.map((item: unknown) =>
				isRecord(item)
					? String(item.label || item.title || item.id || "")
					: String(item),
			)
			.filter(Boolean)
			.slice(0, 5);
		if (tabs.length) parts.push(`タブは ${tabs.join(" / ")}。`);
	}
	if (Array.isArray(props.filters)) {
		const filters = props.filters
			.map((item: unknown) =>
				isRecord(item)
					? String(item.label || item.name || item.id || "")
					: String(item),
			)
			.filter(Boolean)
			.slice(0, 5);
		if (filters.length) parts.push(`フィルターは ${filters.join(" / ")}。`);
	}
	const interactions = summarizeInteractionHints(section, props);
	if (interactions.length > 0)
		parts.push(`操作は ${interactions.join(" / ")}。`);
	const states = summarizeStateHints(section, props);
	if (states.length > 0) parts.push(`状態表示は ${states.join(" / ")}。`);
	return parts.join(" ");
}

export function summarizeInteractionHints(
	section: JsonRecord,
	props: JsonRecord,
) {
	const values = [
		props.actions,
		props.rowActions,
		props.primaryAction,
		props.secondaryAction,
		props.submitLabel,
		props.cancelLabel,
		section.actions,
	];
	return values
		.flatMap((value) => labelArray(value))
		.filter(Boolean)
		.slice(0, 5);
}

export function summarizeStateHints(section: JsonRecord, props: JsonRecord) {
	const stateKeys = [
		["empty", props.emptyState || section.emptyState],
		["loading", props.loadingState || section.loadingState],
		["error", props.errorState || section.errorState],
		["validation", props.validation || section.validation],
	] as const;
	return stateKeys
		.map(([label, value]) => {
			const rendered = summarizeSampleValue(value);
			return rendered ? `${label}:${rendered}` : "";
		})
		.filter(Boolean)
		.slice(0, 4);
}

export function labelArray(value: unknown): string[] {
	if (!value) return [];
	if (typeof value === "string") return [compactText(value, 60)];
	if (Array.isArray(value)) {
		return value
			.map((item) =>
				isRecord(item)
					? String(item.label || item.title || item.name || item.id || "")
					: String(item || ""),
			)
			.filter(Boolean)
			.map((item) => compactText(item, 60));
	}
	if (isRecord(value)) {
		const label = String(
			value.label || value.title || value.name || value.id || "",
		);
		return label ? [compactText(label, 60)] : [];
	}
	return [];
}

export function summarizeSampleValue(value: unknown) {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return compactText(value, 100);
	if (Array.isArray(value)) {
		const items = value
			.map((item) => sampleItemLabel(item))
			.filter(Boolean)
			.slice(0, 3);
		return compactText(items.join(" / "), 120);
	}
	if (isRecord(value)) {
		const entries = Object.entries(value)
			.map(([key, item]) => `${key}:${sampleItemLabel(item)}`)
			.filter((entry) => !entry.endsWith(":"))
			.slice(0, 4);
		return compactText(entries.join(" / "), 120);
	}
	return compactText(String(value), 100);
}

export function sampleItemLabel(value: unknown) {
	if (value === null || value === undefined) return "";
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
	}
	if (isRecord(value)) {
		return String(
			value.label || value.title || value.name || value.value || value.id || "",
		);
	}
	return "";
}
