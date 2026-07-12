import {
	Bot,
	ClipboardList,
	Globe,
	Palette,
	PlugZap,
	type Settings,
	ShieldCheck,
	Workflow,
} from "lucide-react";
import type { GeneralSettings } from "../nightworkers/types";

export type SettingsSectionId =
	| "general"
	| "plan-mode"
	| "appearance"
	| "llm-providers"
	| "llm-routing"
	| "security-intelligence"
	| "hooks"
	| "mcp";

export const defaultGeneralSettings: GeneralSettings = {
	timezone: "Asia/Tokyo",
	language: "ja",
	currency: "JPY",
	fx: {
		source: "ecb",
		autoRefresh: true,
		lastRefreshedAt: null,
	},
	planMode: {
		capabilities: {
			feature_plan: true,
			questionnaire: true,
			user_flow: true,
			blueprint: true,
			data_model: true,
			api_io_contract: true,
			activity_flow: true,
			sequence_flow: true,
			zod_schema_design: true,
		},
	},
	llmUsage: {
		promptPartObservabilityEnabled: true,
	},
};

export function mergeGeneralSettings(
	input: Partial<GeneralSettings> = {},
): GeneralSettings {
	return {
		...defaultGeneralSettings,
		...input,
		fx: {
			...defaultGeneralSettings.fx,
			...input.fx,
		},
		planMode: {
			...defaultGeneralSettings.planMode,
			...input.planMode,
			capabilities: {
				...defaultGeneralSettings.planMode.capabilities,
				...input.planMode?.capabilities,
			},
		},
		llmUsage: {
			...defaultGeneralSettings.llmUsage,
			...input.llmUsage,
		},
	};
}

export const settingsSections: Array<{
	id: SettingsSectionId;
	labelKey: string;
	descriptionKey: string;
	icon: typeof Settings;
}> = [
	{
		id: "general",
		labelKey: "settings.section.general",
		descriptionKey: "settings.section.generalDescription",
		icon: Globe,
	},
	{
		id: "plan-mode",
		labelKey: "settings.section.planMode",
		descriptionKey: "settings.section.planModeDescription",
		icon: ClipboardList,
	},
	{
		id: "appearance",
		labelKey: "settings.section.appearance",
		descriptionKey: "settings.section.appearanceDescription",
		icon: Palette,
	},
	{
		id: "llm-providers",
		labelKey: "settings.section.llmProviders",
		descriptionKey: "settings.section.llmProvidersDescription",
		icon: Bot,
	},
	{
		id: "llm-routing",
		labelKey: "settings.section.llmRouting",
		descriptionKey: "settings.section.llmRoutingDescription",
		icon: Workflow,
	},
	{
		id: "security-intelligence",
		labelKey: "settings.section.securityIntelligence",
		descriptionKey: "settings.section.securityIntelligenceDescription",
		icon: ShieldCheck,
	},
	{
		id: "hooks",
		labelKey: "settings.section.hooks",
		descriptionKey: "settings.section.hooksDescription",
		icon: Workflow,
	},
	{
		id: "mcp",
		labelKey: "settings.section.mcp",
		descriptionKey: "settings.section.mcpDescription",
		icon: PlugZap,
	},
];
