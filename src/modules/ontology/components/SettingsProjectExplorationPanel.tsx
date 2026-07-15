import { useTranslation } from "react-i18next";
import type { McpServerConfig, Repository } from "../../nightworkers/types";
import type { ProjectExplorationCatalogPilotSettings } from "../types";

export function SettingsProjectExplorationPanel({
	activeProject,
	value,
	mcpServers,
	isSaving,
	onChange,
}: {
	activeProject: Repository | null;
	value: ProjectExplorationCatalogPilotSettings | null;
	mcpServers: McpServerConfig[];
	isSaving: boolean;
	onChange: (next: ProjectExplorationCatalogPilotSettings) => void;
}) {
	const { t } = useTranslation();
	const disabled = !activeProject || !value || isSaving;
	const selectedServer = mcpServers.find(
		(server) => server.id === value?.mcpServerId,
	);
	const invalidEnabledConfiguration =
		Boolean(value?.enabled) && !selectedServer?.enabled;
	return (
		<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
			<div>
				<h2 className="text-sm font-semibold text-zinc-100">
					{t("settings.projectExploration.title")}
				</h2>
				<p className="mt-1 text-[10px] text-zinc-500">
					{t("settings.projectExploration.description")}
				</p>
			</div>

			<label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
				<input
					type="checkbox"
					checked={Boolean(value?.enabled)}
					disabled={disabled}
					onChange={(event) => {
						if (!value) return;
						onChange({ ...value, enabled: event.target.checked });
					}}
					className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900"
				/>
				<span>
					<span className="block text-xs font-semibold text-zinc-100">
						{t("settings.projectExploration.enabled")}
					</span>
					<span className="mt-1 block text-[10px] text-zinc-500">
						{t("settings.projectExploration.enabledHelp")}
					</span>
				</span>
			</label>

			<label className="block rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
				<span className="block text-xs font-semibold text-zinc-100">
					{t("settings.projectExploration.mcpServer")}
				</span>
				<select
					value={value?.mcpServerId ?? ""}
					disabled={disabled}
					onChange={(event) => {
						if (!value) return;
						onChange({
							...value,
							mcpServerId: event.target.value || null,
						});
					}}
					className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
				>
					<option value="">{t("settings.projectExploration.noServer")}</option>
					{mcpServers.map((server) => (
						<option key={server.id} value={server.id}>
							{server.name}{" "}
							{server.enabled
								? ""
								: t("settings.projectExploration.serverDisabledSuffix")}
						</option>
					))}
				</select>
				<span className="mt-1 block text-[10px] text-zinc-500">
					{t("settings.projectExploration.mcpServerHelp")}
				</span>
				{invalidEnabledConfiguration ? (
					<span className="mt-2 block text-[10px] text-amber-400">
						{t("settings.projectExploration.invalidServer")}
					</span>
				) : null}
			</label>
		</section>
	);
}
