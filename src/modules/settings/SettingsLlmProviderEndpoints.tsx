import { Activity, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type {
	LlmProviderEndpoint,
	LlmProviderEndpointKind,
	LlmProviderHealthResult,
} from "../nightworkers/types";
import { buildProviderEndpointKindPatch } from "./llmProviderEndpointKind";
import { Field, SelectField } from "./SettingsFields";

function formatModelDisplayNames(value: Record<string, string> | undefined) {
	return Object.entries(value || {})
		.map(([model, label]) => `${model}=${label}`)
		.join("\n");
}

function parseModelDisplayNames(text: string) {
	return Object.fromEntries(
		text
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [model, ...rest] = line.split("=");
				return [model.trim(), rest.join("=").trim()];
			})
			.filter(([model, label]) => model && label),
	);
}

function pruneModelDisplayNames(
	labels: Record<string, string> | undefined,
	models: string[],
) {
	const modelSet = new Set(models);
	return Object.fromEntries(
		Object.entries(labels || {}).filter(
			([model, label]) => modelSet.has(model) && label.trim(),
		),
	);
}

export function SettingsLlmProviderEndpoints({
	genericProviderEndpoints,
	healthResults,
	healthBusyEndpointId,
	addEndpoint,
	updateEndpoint,
	removeEndpoint,
	checkEndpointHealth,
}: {
	genericProviderEndpoints: LlmProviderEndpoint[];
	healthResults: Record<string, LlmProviderHealthResult>;
	healthBusyEndpointId: string | null;
	addEndpoint: () => void;
	updateEndpoint: (id: string, patch: Partial<LlmProviderEndpoint>) => void;
	removeEndpoint: (id: string) => void;
	checkEndpointHealth: (endpoint: LlmProviderEndpoint) => Promise<void>;
}) {
	const { t } = useTranslation();
	const endpointKindOptions: Array<{
		value: LlmProviderEndpointKind;
		label: string;
	}> = [
		{ value: "azure", label: "Azure OpenAI" },
		{ value: "openai", label: "OpenAI" },
		{
			value: "openai-compatible",
			label: t("settings.llm.endpoint.kind.openaiCompatible"),
		},
		{ value: "bedrock", label: "AWS Bedrock" },
		{ value: "local", label: t("settings.llm.endpoint.kind.local") },
	];

	return (
		<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
			<div className="flex items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold text-zinc-100">
						{t("settings.llm.endpoint.title")}
					</h2>
					<p className="mt-1 text-xs text-zinc-500">
						{t("settings.llm.endpoint.description")}
					</p>
				</div>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					icon={Plus}
					onClick={addEndpoint}
				>
					{t("settings.llm.endpoint.add")}
				</Button>
			</div>
			<div className="grid gap-3">
				{genericProviderEndpoints.map((endpoint) => {
					const healthResult = healthResults[endpoint.id];
					const healthBusy = healthBusyEndpointId === endpoint.id;
					return (
						<div
							key={endpoint.id}
							className="grid gap-4 rounded-xl border border-zinc-800 bg-zinc-950/30 p-4"
						>
							<div className="flex items-center justify-between gap-3">
								<label className="inline-flex items-center gap-2 text-xs text-zinc-300">
									<input
										type="checkbox"
										checked={endpoint.enabled}
										onChange={(event) =>
											updateEndpoint(endpoint.id, {
												enabled: event.target.checked,
											})
										}
									/>
									{t("settings.llm.endpoint.enabled")}
								</label>
								<div className="flex items-center gap-2">
									<Button
										type="button"
										size="sm"
										variant="secondary"
										icon={Activity}
										loading={healthBusy}
										title={t("settings.llm.endpoint.healthHint")}
										onClick={() => void checkEndpointHealth(endpoint)}
									>
										{t("settings.llm.endpoint.health")}
									</Button>
									<Button
										type="button"
										size="icon"
										variant="ghost"
										title={t("settings.llm.endpoint.remove")}
										onClick={() => removeEndpoint(endpoint.id)}
									>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</div>
							{healthResult ? (
								<div
									className={`grid gap-1 rounded-lg border px-3 py-2 text-xs ${
										healthResult.ok
											? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
											: healthResult.reachable
												? "border-amber-500/30 bg-amber-500/10 text-amber-200"
												: "border-rose-500/30 bg-rose-500/10 text-rose-200"
									}`}
								>
									<div>
										{healthResult.reachable
											? t("settings.llm.endpoint.reachable")
											: t("settings.llm.endpoint.unreachable")}{" "}
										/ {healthResult.message}
									</div>
									{healthResult.url ? (
										<div className="truncate text-[11px] opacity-80">
											{healthResult.url} ({healthResult.durationMs}ms)
										</div>
									) : null}
									{healthResult.targetDigest ? (
										<div className="truncate font-mono text-[11px] opacity-70">
											{healthResult.probeKind || "connectivity"} ·{" "}
											{healthResult.model || "-"} ·{" "}
											{healthResult.targetDigest.slice(0, 12)}
										</div>
									) : null}
								</div>
							) : null}
							<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
								<Field
									id={`${endpoint.id}-name`}
									label={t("settings.field.name")}
									value={endpoint.name}
									onChange={(value) =>
										updateEndpoint(endpoint.id, { name: value })
									}
								/>
								<SelectField
									id={`${endpoint.id}-kind`}
									label={t("settings.llm.endpoint.kind")}
									value={endpoint.kind}
									options={endpointKindOptions}
									onChange={(value) =>
										updateEndpoint(
											endpoint.id,
											buildProviderEndpointKindPatch(
												endpoint,
												value as LlmProviderEndpointKind,
											),
										)
									}
								/>
								{endpoint.kind === "azure" ? (
									<>
										<Field
											id={`${endpoint.id}-endpoint`}
											label={t("settings.llm.endpoint.url")}
											value={endpoint.endpoint || ""}
											onChange={(value) =>
												updateEndpoint(endpoint.id, { endpoint: value })
											}
										/>
										<Field
											id={`${endpoint.id}-api-version`}
											label={t("settings.field.apiVersion")}
											value={endpoint.apiVersion || ""}
											onChange={(value) =>
												updateEndpoint(endpoint.id, { apiVersion: value })
											}
										/>
									</>
								) : null}
								{endpoint.kind === "openai" ||
								endpoint.kind === "openai-compatible" ||
								endpoint.kind === "local" ? (
									<Field
										id={`${endpoint.id}-base-url`}
										label={t("settings.field.baseUrl")}
										value={endpoint.baseUrl || ""}
										onChange={(value) =>
											updateEndpoint(endpoint.id, { baseUrl: value })
										}
									/>
								) : null}
								{endpoint.kind === "bedrock" ? (
									<Field
										id={`${endpoint.id}-region`}
										label={t("settings.field.awsRegion")}
										value={endpoint.region || ""}
										onChange={(value) =>
											updateEndpoint(endpoint.id, { region: value })
										}
									/>
								) : null}
								{endpoint.kind !== "bedrock" ? (
									<Field
										id={`${endpoint.id}-api-key`}
										label={t("settings.field.apiKey")}
										type="password"
										value={endpoint.apiKey || ""}
										onChange={(value) =>
											updateEndpoint(endpoint.id, { apiKey: value })
										}
									/>
								) : null}
								<Field
									id={`${endpoint.id}-models`}
									label={t("settings.llm.endpoint.models")}
									value={endpoint.models.join(", ")}
									onChange={(value) => {
										const models = value
											.split(",")
											.map((model) => model.trim())
											.filter(Boolean);
										updateEndpoint(endpoint.id, {
											models,
											modelDisplayNames: pruneModelDisplayNames(
												endpoint.modelDisplayNames,
												models,
											),
										});
									}}
								/>
								<div className="space-y-1.5 md:col-span-2">
									<label
										htmlFor={`${endpoint.id}-model-display-names`}
										className="block text-[11px] font-semibold text-zinc-400"
									>
										{t("settings.llm.endpoint.modelLabels")}
									</label>
									<textarea
										id={`${endpoint.id}-model-display-names`}
										value={formatModelDisplayNames(endpoint.modelDisplayNames)}
										onChange={(event) =>
											updateEndpoint(endpoint.id, {
												modelDisplayNames: parseModelDisplayNames(
													event.target.value,
												),
											})
										}
										placeholder="gpt-5.5=Plan High (Codex)"
										className="min-h-20 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-100"
									/>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}
