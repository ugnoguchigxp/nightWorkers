import { createHash } from "node:crypto";
import {
	getMockBlueprintDatasetKindsForSection,
	type MockBlueprint,
	mockBlueprintSchema,
	type RenderableMockBlueprintSectionName,
	renderableMockBlueprintSectionNames,
} from "../../../../shared/schemas/mock-blueprint.schema";
import {
	createStructuredOutputContract,
	renderStructuredOutputRequirements,
} from "../../structured-llm/contract";

export const MOCK_BLUEPRINT_PROMPT_VERSION = "mock-blueprint-v4";

type SectionCatalogEntry = {
	componentName: RenderableMockBlueprintSectionName;
	usage: string;
	datasetKinds: readonly string[];
};

export function buildMockBlueprintSectionCatalog(): SectionCatalogEntry[] {
	return renderableMockBlueprintSectionNames.map((componentName) => ({
		componentName,
		usage: sectionUsage(componentName),
		datasetKinds: getMockBlueprintDatasetKindsForSection(componentName),
	}));
}

export function buildMockBlueprintSystemPrompt(input: {
	sectionCatalog?: SectionCatalogEntry[];
	jsonSchema: unknown;
}): string {
	const sectionCatalog =
		input.sectionCatalog || buildMockBlueprintSectionCatalog();
	return [
		"[SystemContext]",
		"目的は、実装前に確認できる軽量な Mock 表示用 JSON を作ることです。",
		"Task、Questionnaire、Specを根拠に、対象プロダクトの画面、Section、表示文言、サンプルデータを設計してください。",
		"",
		"[Workflow]",
		"- 実装後にユーザーが触る対象プロダクトの画面を設計し、NightWorkersの仕様確認・進行管理画面を作らないでください。",
		"- 入力から主要な利用者、目的、操作、状態を判断し、それを確認するために必要な画面とSectionを自由に選んでください。",
		"- QuestionnaireとSpecの確定事項を尊重し、技術情報は画面内容ではなく制約として扱ってください。",
		"- componentNameはSection Catalogから選び、対応するdatasetKindsのデータを作ってください。",
		"- meta.selectedSectionsは実際に生成したSectionと一致させてください。",
		"",
		"[Section Catalog]",
		renderSectionCatalog(sectionCatalog),
		"",
		"[Dataset Guide]",
		renderDatasetGuide(),
		"",
		"[Output Contract]",
		renderStructuredOutputRequirements(input.jsonSchema),
	].join("\n");
}

export function buildMockBlueprintUserPrompt(input: {
	task: {
		id: string;
		title: string;
		description?: string | null;
		objective?: string | null;
	};
	questionnaireMarkdown?: string | null;
	projectStackContext?: string | null;
	specContext?: string | null;
	prompt?: string | null;
	projectionPrompt?: string | null;
}) {
	if (input.projectionPrompt?.trim()) return input.projectionPrompt.trim();
	return [
		"次の context から Mock Blueprint JSON を1つ生成してください。",
		"",
		"## Task",
		`Task ID: ${input.task.id}`,
		`Title: ${input.task.title || "Untitled"}`,
		input.task.description ? `Description: ${input.task.description}` : "",
		input.task.objective ? `Objective: ${input.task.objective}` : "",
		"",
		"## Questionnaire / Decisions",
		input.questionnaireMarkdown?.trim() || "Questionnaire は未生成です。",
		"",
		"## Project Stack Context",
		input.projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## 仕様書 / Spec（制約として参照）",
		"この内容は画面に出す題材ではなく、Mock の制約としてだけ使ってください。",
		"仕様書（Spec）、仕様確認、進行メモ、実装手順、確認ノートの画面は生成しないでください。",
		input.specContext?.trim() || "仕様書（Spec）は未生成です。",
		"",
		"## User Prompt",
		input.prompt?.trim() ||
			input.task.objective ||
			input.task.description ||
			input.task.title,
	]
		.filter(Boolean)
		.join("\n");
}

export function buildMockBlueprintStructuredOutputJsonSchema() {
	return createStructuredOutputContract({
		name: "mock_blueprint",
		runtimeSchema: mockBlueprintSchema,
	}).providerJsonSchema;
}

export function mockBlueprintPromptDiagnostics(input: {
	systemPrompt: string;
	userPrompt: string;
	schema: unknown;
}) {
	const systemPromptEstimatedTokens = estimatePromptTokens(input.systemPrompt);
	const userPromptEstimatedTokens = estimatePromptTokens(input.userPrompt);
	return {
		schemaName: "mock_blueprint" as const,
		systemPromptBytes: Buffer.byteLength(input.systemPrompt, "utf8"),
		userPromptBytes: Buffer.byteLength(input.userPrompt, "utf8"),
		systemPromptEstimatedTokens,
		userPromptEstimatedTokens,
		totalPromptEstimatedTokens:
			systemPromptEstimatedTokens + userPromptEstimatedTokens,
		sectionAllowlistCount: renderableMockBlueprintSectionNames.length,
		schemaDigest: createHash("sha256")
			.update(JSON.stringify(input.schema))
			.digest("hex"),
	};
}

function estimatePromptTokens(value: string) {
	return Math.ceil(Buffer.byteLength(value, "utf8") / 4);
}

function renderSectionCatalog(sectionCatalog: SectionCatalogEntry[]) {
	return sectionCatalog
		.map(
			(entry) =>
				`${entry.componentName}: ${entry.usage} dataset=${entry.datasetKinds.join("|")}`,
		)
		.join("\n");
}

function renderDatasetGuide() {
	return [
		"navigation: nav items with label/href/active.",
		"table: columns and row records for comparison/list management.",
		"form: fields and submitLabel for create/edit input.",
		"cards: rich summary cards.",
		"kanban: workflow columns and cards.",
		"timeline: chronological items.",
		"article: text body and meta.",
		"metrics: KPI labels, values, trends.",
		"media: visual/story items without real image generation.",
		"map: points or regions.",
		"code: file excerpts.",
		"chat: messages.",
		"generic: simple titled items.",
	].join("\n");
}

function sectionUsage(componentName: RenderableMockBlueprintSectionName) {
	const usage: Record<RenderableMockBlueprintSectionName, string> = {
		AccordionSection: "grouped details or FAQs",
		AnalyticsDashboardSection: "dashboard metrics and status overview",
		BlogPostSection: "article or long-form text screen",
		CalendarSection: "date-based planning or schedule preview",
		CardGridSection: "browseable cards or rich item summaries",
		CarouselSection: "media sequence",
		ChartSection: "chart or trend summary",
		ChatPanelSection: "conversation",
		CheckoutSummarySection: "checkout or order summary",
		CodeEditorSection: "code or config editing mock",
		ComparisonSection: "side-by-side comparison",
		ControlPanelSection: "settings or operational controls",
		DataTableSection: "records, lists, sorting, or comparison",
		EmailInboxSection: "inbox-style list workflow",
		ExplorerSidebarSection: "hierarchical navigation",
		FooterNavigationSection: "footer links",
		FormSection: "input flow",
		FullBleedHeroSection: "visual hero",
		ImageSection: "image-focused preview",
		KanbanSection: "board workflow",
		LeftSidebarSection: "left supporting column",
		MapSection: "location or region view",
		MediaTextSection: "media plus explanatory copy",
		NotificationCenterSection: "notifications and alerts",
		PaymentFormSection: "payment input form",
		RightSidebarLinksSection: "right supporting column",
		ScheduleSection: "schedule or upcoming items",
		SidebarMenuSection: "sidebar navigation",
		SplitHeroSection: "hero with media and text",
		TabNavigationSection: "tabbed navigation",
		TimelineSection: "events or history",
		TopMenuSection: "top navigation",
		VideoSection: "video or media preview",
	};
	return usage[componentName];
}

export type MockBlueprintPromptArtifact = MockBlueprint;
