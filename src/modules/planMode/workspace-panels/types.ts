import type { PlanModeRoutingView } from "../../../../shared/schemas/plan-mode-routing.schema";
import type {
	PlanModeCapability,
	PlanModeViewDecision,
} from "../../nightworkers/types";

export type AdditionalPlanView = Exclude<
	PlanModeCapability,
	"feature_plan" | "questionnaire" | "blueprint" | "data_model"
>;

const ADDITIONAL_PLAN_VIEWS: readonly AdditionalPlanView[] = [
	"user_flow",
	"api_io_contract",
	"activity_flow",
	"sequence_flow",
	"zod_schema_design",
];

export type PlanViewDecision = PlanModeViewDecision;

export type PlanWorkspaceStatusStep = {
	view: PlanModeRoutingView;
	progressKey: string;
	number: number;
	title: string;
	detail: string;
	badges?: string[];
	done: boolean;
	buttonLabel: string;
	busy: boolean;
	disabled: boolean;
	disabledReason?: string | null;
	onClick: () => void | Promise<void>;
	secondaryAction?: {
		label: string;
		busy: boolean;
		disabled: boolean;
		onClick: () => void | Promise<void>;
	} | null;
	autoGenerate: boolean;
	autoGenerateKey: string;
	progressStatus?: "pending" | "running" | "completed" | "failed" | "skipped";
	progressError?: string | null;
};

export function isAdditionalView(value: string): value is AdditionalPlanView {
	return (ADDITIONAL_PLAN_VIEWS as readonly string[]).includes(value);
}

export function formatViewLabel(value: string) {
	const labels: Record<string, string> = {
		questionnaire: "Questionnaire",
		feature_plan: "仕様書",
		blueprint: "Blueprint",
		data_model: "Data Model",
		api_io_contract: "API Contract",
		activity_flow: "Activity",
		sequence_flow: "Sequence",
		zod_schema_design: "Zod",
		user_flow: "User Flow",
	};
	return labels[value] || value;
}
