import { useTranslation } from "react-i18next";
import type { Repository } from "../../nightworkers/types";
import type { ProjectSecurityIntelligenceSettingsResponse } from "../types";

export function SettingsOntologyPanel({
	activeProject,
	value,
	isSaving,
	onChange,
}: {
	activeProject: Repository | null;
	value: ProjectSecurityIntelligenceSettingsResponse | null;
	isSaving: boolean;
	onChange: (next: ProjectSecurityIntelligenceSettingsResponse) => void;
}) {
	const { t } = useTranslation();
	const eligibility = value?.eligibility;
	const securityOracle = value?.securityOracle;
	const ontology = value?.ontology;
	// Eligibility controls runtime behavior, not whether a Project preference can
	// be saved. This preserves a user's intended settings until it is eligible.
	const toggleDisabled = !activeProject || !value || isSaving;
	const isRuntimeEligible = Boolean(eligibility?.eligible);
	const securityStatus = securityOracle?.effectiveEnabled
		? t("settings.securityIntelligence.enabled")
		: t("settings.securityIntelligence.disabled");
	const toolProfile =
		ontology?.toolProfile === "ontology_extended"
			? t("settings.securityIntelligence.ontologyExtended")
			: t("settings.securityIntelligence.standard");
	return (
		<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
			<div className="grid gap-3 md:grid-cols-2">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<div className="text-xs font-semibold text-zinc-100">
						{t("settings.securityIntelligence.securityOracle")}:{" "}
						{securityStatus}
					</div>
					<div className="mt-1 text-[10px] text-zinc-400">
						{securityOracle?.configured
							? t("settings.securityIntelligence.configured")
							: t("settings.securityIntelligence.notConfigured")}
						{!isRuntimeEligible ? (
							<>
								{" · "}
								{t("settings.securityIntelligence.notEligible")}
							</>
						) : null}
					</div>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<div className="text-xs font-semibold text-zinc-100">
						{toolProfile}
					</div>
					<div className="mt-1 text-[10px] text-zinc-500">
						{t("settings.securityIntelligence.size", {
							loc: eligibility?.measuredSourceLoc?.toLocaleString() ?? "—",
							threshold:
								eligibility?.thresholdSourceLoc.toLocaleString() ?? "50,000",
						})}
					</div>
				</div>
			</div>

			<label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
				<input
					type="checkbox"
					checked={Boolean(value?.settings.securityOracleEnabled)}
					disabled={toggleDisabled}
					onChange={(event) => {
						if (!value) return;
						onChange({
							...value,
							settings: {
								...value.settings,
								securityOracleEnabled: event.target.checked,
							},
						});
					}}
					className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900"
				/>
				<span>
					<span className="block text-xs font-semibold text-zinc-100">
						{t("settings.securityIntelligence.securityOracle")}
					</span>
					<span className="mt-1 block text-[10px] text-zinc-500">
						{isRuntimeEligible
							? t("settings.securityIntelligence.securityOracleHelp")
							: t("settings.securityIntelligence.notEligibleHelp")}
					</span>
					<span className="mt-1 block text-[10px] text-zinc-600">
						{t("settings.securityIntelligence.storedPreference", {
							value: value?.settings.securityOracleEnabled ? "ON" : "OFF",
							effective: securityOracle?.effectiveEnabled ? "ON" : "OFF",
						})}
					</span>
				</span>
			</label>

			<label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
				<input
					type="checkbox"
					checked={Boolean(value?.settings.ontologyToolsEnabled)}
					disabled={toggleDisabled}
					onChange={(event) => {
						if (!value) return;
						onChange({
							...value,
							settings: {
								...value.settings,
								ontologyToolsEnabled: event.target.checked,
							},
						});
					}}
					className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900"
				/>
				<span>
					<span className="block text-xs font-semibold text-zinc-100">
						{t("settings.securityIntelligence.ontologyTools")}
					</span>
					<span className="mt-1 block text-[10px] text-zinc-500">
						{!isRuntimeEligible
							? t("settings.securityIntelligence.notEligibleHelp")
							: value?.settings.securityOracleEnabled
								? t("settings.securityIntelligence.ontologyToolsHelp")
								: t("settings.securityIntelligence.oracleDisabled")}
					</span>
					<span className="mt-1 block text-[10px] text-zinc-600">
						{t("settings.securityIntelligence.storedPreference", {
							value: value?.settings.ontologyToolsEnabled ? "ON" : "OFF",
							effective: ontology?.effectiveEnabled ? "ON" : "OFF",
						})}
					</span>
				</span>
			</label>

			<label className="block rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
				<span className="block text-xs font-semibold text-zinc-100">
					{t("settings.securityIntelligence.maxIterations")}
				</span>
				<input
					type="number"
					min={1}
					max={10}
					value={value?.settings.securityMaxIterations ?? 3}
					disabled={!activeProject || !value || isSaving}
					onChange={(event) => {
						if (!value) return;
						onChange({
							...value,
							settings: {
								...value.settings,
								securityMaxIterations: Math.min(
									10,
									Math.max(1, Number(event.target.value) || 1),
								),
							},
						});
					}}
					className="mt-2 h-9 w-28 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-100"
				/>
				<span className="mt-1 block text-[10px] text-zinc-500">
					{t("settings.securityIntelligence.maxIterationsHelp")}
				</span>
			</label>
		</section>
	);
}
