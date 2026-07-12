import { useTranslation } from "react-i18next";
import type {
	GeneralSettings,
	PlanModeCapability,
} from "../nightworkers/types";

const planModeCapabilities: Array<{
	key: PlanModeCapability;
	labelKey: string;
	descriptionKey: string;
}> = [
	{
		key: "feature_plan",
		labelKey: "settings.planMode.featurePlan",
		descriptionKey: "settings.planMode.featurePlanHelp",
	},
	{
		key: "questionnaire",
		labelKey: "settings.planMode.questionnaire",
		descriptionKey: "settings.planMode.questionnaireHelp",
	},
	{
		key: "user_flow",
		labelKey: "settings.planMode.userFlow",
		descriptionKey: "settings.planMode.userFlowHelp",
	},
	{
		key: "blueprint",
		labelKey: "settings.planMode.blueprint",
		descriptionKey: "settings.planMode.blueprintHelp",
	},
	{
		key: "data_model",
		labelKey: "settings.planMode.dataModel",
		descriptionKey: "settings.planMode.dataModelHelp",
	},
	{
		key: "api_io_contract",
		labelKey: "settings.planMode.apiIoContract",
		descriptionKey: "settings.planMode.apiIoContractHelp",
	},
	{
		key: "activity_flow",
		labelKey: "settings.planMode.activityFlow",
		descriptionKey: "settings.planMode.activityFlowHelp",
	},
	{
		key: "sequence_flow",
		labelKey: "settings.planMode.sequenceFlow",
		descriptionKey: "settings.planMode.sequenceFlowHelp",
	},
	{
		key: "zod_schema_design",
		labelKey: "settings.planMode.zodSchemaDesign",
		descriptionKey: "settings.planMode.zodSchemaDesignHelp",
	},
];

export function SettingsPlanModePanel({
	value,
	onChange,
}: {
	value: GeneralSettings;
	onChange: (next: GeneralSettings) => void;
}) {
	const { t } = useTranslation();

	return (
		<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
			<div className="grid gap-3">
				{planModeCapabilities.map((capability) => (
					<label
						key={capability.key}
						className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3"
					>
						<input
							type="checkbox"
							checked={value.planMode.capabilities[capability.key]}
							onChange={(event) =>
								onChange({
									...value,
									planMode: {
										...value.planMode,
										capabilities: {
											...value.planMode.capabilities,
											[capability.key]: event.target.checked,
										},
									},
								})
							}
							className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900"
						/>
						<span>
							<span className="block text-xs font-semibold text-zinc-100">
								{t(capability.labelKey)}
							</span>
							<span className="mt-1 block text-[10px] text-zinc-500">
								{t(capability.descriptionKey)}
							</span>
						</span>
					</label>
				))}
			</div>
		</section>
	);
}
