import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { Repository } from "../../nightworkers/types";
import type { ProjectSecurityIntelligenceSettingsResponse } from "../types";

export function SettingsOntologyPanel({
	activeProject,
	value,
	message,
	messageStatus,
	isSaving,
	onChange,
	onSave,
}: {
	activeProject: Repository | null;
	value: ProjectSecurityIntelligenceSettingsResponse | null;
	message: string;
	messageStatus: "idle" | "success" | "error";
	isSaving: boolean;
	onChange: (next: ProjectSecurityIntelligenceSettingsResponse) => void;
	onSave: () => void;
}) {
	const { t } = useTranslation();
	const eligibility = value?.eligibility;
	const securityOracle = value?.securityOracle;
	const ontology = value?.ontology;
	const securityToggleDisabled =
		!activeProject || isSaving || !eligibility?.eligible;
	const ontologyToggleDisabled =
		securityToggleDisabled || !value?.settings.securityOracleEnabled;
	return (
		<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
						<ShieldCheck className="h-4 w-4 text-indigo-400" />
						{t("settings.securityIntelligence.title")}
					</h2>
					<p className="mt-1 text-xs text-zinc-500">
						{activeProject?.name ?? t("settings.test.noProject")}
					</p>
				</div>
				<Button
					type="button"
					onClick={onSave}
					disabled={!activeProject || !value || isSaving}
					className="h-9 px-4 text-xs"
				>
					{isSaving
						? t("settings.saving")
						: t("settings.securityIntelligence.save")}
				</Button>
			</div>

			<div className="grid gap-3 md:grid-cols-2">
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<div className="text-xs font-semibold text-zinc-100">
						{t("settings.securityIntelligence.securityOracle")}:{" "}
						{securityOracle?.effectiveEnabled ? "ON" : "OFF"}
					</div>
					<div className="mt-1 text-[10px] text-zinc-400">
						{securityOracle?.configured
							? t("settings.securityIntelligence.configured")
							: t("settings.securityIntelligence.notConfigured")}
						{" · "}
						{securityOracle?.reason ?? "measurement_unavailable"}
					</div>
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
					<div className="text-xs font-semibold text-zinc-100">
						{ontology?.toolProfile ?? "standard"}
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
					disabled={securityToggleDisabled}
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
						{eligibility?.eligible
							? t("settings.securityIntelligence.securityOracleHelp")
							: t("settings.securityIntelligence.belowThreshold")}
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
					disabled={ontologyToggleDisabled}
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
						{eligibility?.eligible && value?.settings.securityOracleEnabled
							? t("settings.securityIntelligence.ontologyToolsHelp")
							: eligibility?.eligible
								? t("settings.securityIntelligence.oracleDisabled")
								: t("settings.securityIntelligence.belowThreshold")}
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

			{message ? (
				<p
					role={messageStatus === "error" ? "alert" : "status"}
					className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
						messageStatus === "success"
							? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
							: "border-rose-500/40 bg-rose-500/10 text-rose-200"
					}`}
				>
					{messageStatus === "success" ? (
						<CheckCircle2 className="h-4 w-4" />
					) : (
						<XCircle className="h-4 w-4" />
					)}
					{message}
				</p>
			) : null}
		</section>
	);
}
