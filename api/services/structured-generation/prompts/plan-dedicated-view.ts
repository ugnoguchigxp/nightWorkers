import type { DedicatedDesignView } from "../../../../shared/schemas/plan-mode-artifact.schema";

export const PLAN_DEDICATED_VIEW_PROMPT_VERSION = "plan-mode-dedicated-view-v2";

export const genericDedicatedViewSchema = {
	type: "object",
	additionalProperties: false,
	required: ["artifactKind", "view", "title", "markdown", "diagramKind"],
	properties: {
		artifactKind: { type: "string", const: "plan_mode_dedicated_view" },
		view: {
			type: "string",
			enum: ["user_flow", "activity_flow", "sequence_flow"],
		},
		title: { type: "string" },
		markdown: { type: "string" },
		diagramKind: {
			type: ["string", "null"],
			enum: ["stateDiagram-v2", "flowchart", "sequenceDiagram", null],
		},
	},
} as const;

export type GenericDedicatedViewArtifact = {
	artifactKind: "plan_mode_dedicated_view";
	view: Exclude<
		DedicatedDesignView,
		| "questionnaire"
		| "blueprint"
		| "data_model"
		| "api_io_contract"
		| "zod_schema_design"
	>;
	title: string;
	markdown: string;
	diagramKind?: "stateDiagram-v2" | "flowchart" | "sequenceDiagram";
};

export function buildPlanDedicatedViewSystemPrompt(
	view: GenericDedicatedViewArtifact["view"],
) {
	return [
		"[SystemContext]",
		`今回生成する view は ${view} だけです。複数 view をまとめて生成しないでください。`,
		"Feature Plan、Questionnaire、Blueprint、Data Model は入力 context として扱い、正本の責務を混ぜないでください。",
		"ユースケース図、journey、gantt は絶対に生成しないでください。",
		"",
		"[Output Contract]",
		"JSON object だけを返してください。markdown は JSON の markdown 文字列に入れてください。",
		'artifactKind は "plan_mode_dedicated_view"、view は選択された view 名にしてください。',
		"diagramKind は Mermaid を使う場合だけ種類を入れ、Mermaid を使わない場合は null にしてください。",
		"user_flow / activity_flow / sequence_flow は Markdown 文書ではなく Mermaid 作図を主出力にしてください。",
		"Mermaid 図にできない説明はこの View に詰め込まず、Feature Plan / spec 側の責務として扱ってください。",
		"",
		"[View Rules]",
		viewRules(view),
	].join("\n");
}

export function buildPlanDedicatedViewUserPrompt(input: {
	view: GenericDedicatedViewArtifact["view"];
	task: string;
	projectStackContext?: string | null;
	featurePlan: string;
	questionnaire: string;
	blueprint: string;
	dataModel: string;
	prompt: string;
	repairContext?: string | null;
}) {
	const sections = [
		`次の context から ${input.view} Plan View を1つ生成してください。`,
		"",
		"## Task",
		input.task,
		"",
		"## Project Stack Context",
		input.projectStackContext?.trim() || "Project stack は未検出です。",
		"",
		"## Feature Plan",
		input.featurePlan,
		"",
		"## Questionnaire / Decisions",
		input.questionnaire,
		"",
		"## Blueprint Context",
		input.blueprint,
		"",
		"## Data Model Context",
		input.dataModel,
		"",
		"## User Prompt",
		input.prompt,
	];
	if (input.repairContext?.trim()) {
		sections.push(
			"",
			"## Mermaid Parse Repair",
			"前回出力した Mermaid は parse に失敗しました。Error と前回 source を読み、同じ view と同じ intent のまま Mermaid として parse できるように最小修正してください。",
			input.repairContext.trim(),
		);
	}
	return sections.join("\n");
}

function viewRules(view: GenericDedicatedViewArtifact["view"]) {
	switch (view) {
		case "user_flow":
			return [
				"- Mermaid flowchart TD または flowchart LR だけを使い、diagramKind は flowchart にする。",
				"- markdown は Mermaid fenced code block を主にし、Spec と同じ手順説明を長文で繰り返さない。",
				"- User Flow は actor / entry point / screen or state / user action / system response / branch / success or cancellation を定義する。",
				"- ユーザー操作、画面遷移、user-visible state が実装判断に影響する範囲だけをノードと edge で表す。",
				"- ファイル名、CSS、実装タスク、内部関数、検証手順を User Flow のノードにしない。それらは Feature Plan または Activity Flow の責務にする。",
				"- ノード名は step1 / step2 のような番号だけにせず、ユーザーに見える状態や操作を短く書く。",
				"- UI がない作業、または user-visible flow が変わらない作業では、不要な画面や actor を足さない。",
				"- ユースケース図、journey、gantt は生成しない。",
			].join("\n");
		case "activity_flow":
			return [
				"- Mermaid flowchart TD または flowchart LR だけを使い、diagramKind は flowchart にする。",
				"- markdown は Mermaid fenced code block を主にし、Spec と同じ作業説明を長文で繰り返さない。",
				"- Acceptance Criteria と実装 branch に対応する activity だけをノードと edge で表す。",
			].join("\n");
		case "sequence_flow":
			return [
				"- Mermaid を使う場合は sequenceDiagram だけを使い、diagramKind は sequenceDiagram にする。",
				"- 実装に存在する actor だけを書く。",
			].join("\n");
	}
}
