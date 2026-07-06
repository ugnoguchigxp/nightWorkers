import { CheckCircle2, Globe, RefreshCw, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { applyAppLanguage } from "../../i18n/I18nProvider";
import type { GeneralSettings } from "../nightworkers/types";
import { SelectField } from "./SettingsFields";
import { fetchPricingRows, importPublicPricingRows } from "./settingsCommands";

const pricingProviderFilter = new Set([
	"openai",
	"anthropic",
	"google",
	"xai",
	"deepseek",
	"z-ai",
	"qwen",
]);

type LlmPricingRowView = {
	id: string;
	provider: string;
	model: string;
	currencyCode: string;
	inputPer1m: number | null;
	cachedInputPer1m: number | null;
	outputPer1m: number | null;
	sourceLabel: string | null;
	fetchedAt: string | number | Date | null;
	manualOverride: boolean;
	enabled: boolean;
};

type PublicPricingImportView = {
	imported: number;
	skipped: number;
	providers: string[];
	rows: LlmPricingRowView[];
	fetchedAt: string;
	sourceUrl: string;
};

function pricingProviderLabel(provider: string) {
	if (provider === "xai") return "xAI / SpaceX";
	if (provider === "z-ai") return "Z.ai";
	if (provider === "qwen") return "Qwen";
	return provider;
}

function formatPerMillionPrice(value: number | null, currencyCode: string) {
	if (value === null || value === undefined) return "-";
	const amount = value.toLocaleString(undefined, {
		maximumFractionDigits: 6,
	});
	return currencyCode === "USD" ? `$${amount}` : `${amount} ${currencyCode}`;
}

function formatPricingDate(value: LlmPricingRowView["fetchedAt"]) {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "-";
	return date.toLocaleString();
}

export function GeneralSettingsPanel({
	value,
	message,
	messageStatus,
	isRefreshingFx,
	onChange,
	onSave,
	onRefreshFx,
}: {
	value: GeneralSettings;
	message: string;
	messageStatus: "idle" | "success" | "error";
	isRefreshingFx: boolean;
	onChange: (next: GeneralSettings) => void;
	onSave: () => void;
	onRefreshFx: () => void;
}) {
	const { t } = useTranslation();
	const [pricingRows, setPricingRows] = useState<LlmPricingRowView[]>([]);
	const [pricingLoading, setPricingLoading] = useState(false);
	const [pricingImporting, setPricingImporting] = useState(false);
	const [pricingMessage, setPricingMessage] = useState("");
	const [pricingMessageKind, setPricingMessageKind] = useState<
		"success" | "error"
	>("success");
	const visiblePricingRows = pricingRows
		.filter((row) => row.enabled && pricingProviderFilter.has(row.provider))
		.slice()
		.sort((a, b) => {
			const providerCompare = a.provider.localeCompare(b.provider);
			return providerCompare || a.model.localeCompare(b.model);
		});

	const loadPricingRows = useCallback(async () => {
		setPricingLoading(true);
		try {
			const res = await fetchPricingRows();
			if (!res.ok) throw new Error(await res.text());
			setPricingRows((await res.json()) as LlmPricingRowView[]);
		} catch (err) {
			setPricingMessageKind("error");
			setPricingMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setPricingLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadPricingRows();
	}, [loadPricingRows]);

	const importPricingRows = async () => {
		setPricingImporting(true);
		setPricingMessage("");
		try {
			const res = await importPublicPricingRows();
			if (!res.ok) throw new Error(await res.text());
			const result = (await res.json()) as PublicPricingImportView;
			setPricingRows(result.rows);
			setPricingMessageKind("success");
			setPricingMessage(
				`API使用料を ${result.imported} 件取得しました: ${result.providers.join(", ")}`,
			);
			await loadPricingRows();
		} catch (err) {
			setPricingMessageKind("error");
			setPricingMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setPricingImporting(false);
		}
	};

	return (
		<section className="space-y-4 rounded-2xl border border-zinc-800/60 bg-[#16161a] p-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h2 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
						<Globe className="h-4 w-4 text-cyan-400" />
						{t("settings.general.title")}
					</h2>
					<p className="mt-1 text-xs text-zinc-500">
						{t("settings.general.panelDescription")}
					</p>
				</div>
				<Button type="button" onClick={onSave} className="h-9 px-4 text-xs">
					{t("settings.general.save")}
				</Button>
			</div>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
				<SelectField
					id="general-timezone"
					label={t("settings.general.timezone")}
					value={value.timezone}
					options={[
						{ value: "Asia/Tokyo", label: "Asia/Tokyo" },
						{ value: "UTC", label: "UTC" },
						{ value: "America/Los_Angeles", label: "America/Los_Angeles" },
						{ value: "Europe/London", label: "Europe/London" },
					]}
					onChange={(timezone) => onChange({ ...value, timezone })}
				/>
				<SelectField
					id="general-language"
					label={t("settings.general.language")}
					value={value.language}
					options={[
						{ value: "ja", label: "日本語" },
						{ value: "en", label: "English" },
					]}
					onChange={(language) => {
						const nextLanguage = language as "ja" | "en";
						void applyAppLanguage(nextLanguage);
						onChange({ ...value, language: nextLanguage });
					}}
				/>
				<SelectField
					id="general-currency"
					label={t("settings.general.currency")}
					value={value.currency}
					options={[
						{ value: "JPY", label: "JPY" },
						{ value: "USD", label: "USD" },
						{ value: "EUR", label: "EUR" },
					]}
					onChange={(currency) =>
						onChange({
							...value,
							currency: currency as GeneralSettings["currency"],
						})
					}
				/>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
				<div>
					<div className="text-xs font-semibold text-zinc-100">
						{t("settings.general.fx")}
					</div>
					<p className="mt-1 text-[10px] text-zinc-500">
						Source: {value.fx.source} / Last refresh:{" "}
						{value.fx.lastRefreshedAt || "N/A"}
					</p>
				</div>
				<Button
					type="button"
					variant="ghost"
					onClick={onRefreshFx}
					disabled={isRefreshingFx}
					className="h-8 px-3 text-xs"
				>
					{isRefreshingFx ? (
						<RefreshCw className="h-3 w-3 animate-spin" />
					) : null}
					{t("settings.general.refreshFx")}
				</Button>
			</div>
			<label className="flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
				<input
					type="checkbox"
					checked={value.llmUsage?.promptPartObservabilityEnabled ?? true}
					onChange={(event) =>
						onChange({
							...value,
							llmUsage: {
								...value.llmUsage,
								promptPartObservabilityEnabled: event.target.checked,
							},
						})
					}
					className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-900"
				/>
				<span>
					<span className="block text-xs font-semibold text-zinc-100">
						{t("settings.general.promptPartObservability")}
					</span>
					<span className="mt-1 block text-[10px] text-zinc-500">
						{t("settings.general.promptPartObservabilityHelp")}
					</span>
				</span>
			</label>
			<div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="text-xs font-semibold text-zinc-100">API使用料</div>
						<p className="mt-1 text-[10px] text-zinc-500">
							取得した価格表は Overview の LLM 使用料見積もりに使われます。
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => void loadPricingRows()}
							disabled={pricingLoading || pricingImporting}
							className="h-8 px-3 text-xs"
						>
							{pricingLoading ? (
								<RefreshCw className="h-3 w-3 animate-spin" />
							) : null}
							表を更新
						</Button>
						<Button
							type="button"
							onClick={() => void importPricingRows()}
							disabled={pricingImporting}
							className="h-8 px-3 text-xs"
						>
							{pricingImporting ? (
								<RefreshCw className="h-3 w-3 animate-spin" />
							) : null}
							API使用料を取得
						</Button>
					</div>
				</div>
				{pricingMessage ? (
					<div
						role={pricingMessageKind === "error" ? "alert" : "status"}
						className={`rounded-lg border px-3 py-2 text-xs ${
							pricingMessageKind === "error"
								? "border-rose-500/40 bg-rose-500/10 text-rose-200"
								: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
						}`}
					>
						{pricingMessage}
					</div>
				) : null}
				<div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/30">
					<table className="min-w-[760px] w-full text-left text-xs">
						<thead className="border-zinc-800 border-b text-[11px] uppercase text-zinc-500">
							<tr>
								<th className="px-3 py-2 font-semibold">Provider</th>
								<th className="px-3 py-2 font-semibold">Model</th>
								<th className="px-3 py-2 text-right font-semibold">
									Input / 1M
								</th>
								<th className="px-3 py-2 text-right font-semibold">
									Cached / 1M
								</th>
								<th className="px-3 py-2 text-right font-semibold">
									Output / 1M
								</th>
								<th className="px-3 py-2 font-semibold">Source</th>
								<th className="px-3 py-2 font-semibold">Fetched</th>
							</tr>
						</thead>
						<tbody>
							{pricingLoading ? (
								<tr>
									<td
										colSpan={7}
										className="px-3 py-6 text-center text-zinc-500"
									>
										価格表を読み込み中...
									</td>
								</tr>
							) : visiblePricingRows.length ? (
								visiblePricingRows.map((row) => (
									<tr
										key={row.id}
										className="border-zinc-900 border-b last:border-0"
									>
										<td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-200">
											{pricingProviderLabel(row.provider)}
										</td>
										<td className="max-w-[18rem] truncate px-3 py-2 text-zinc-300">
											{row.model}
										</td>
										<td className="whitespace-nowrap px-3 py-2 text-right text-zinc-300">
											{formatPerMillionPrice(row.inputPer1m, row.currencyCode)}
										</td>
										<td className="whitespace-nowrap px-3 py-2 text-right text-zinc-300">
											{formatPerMillionPrice(
												row.cachedInputPer1m,
												row.currencyCode,
											)}
										</td>
										<td className="whitespace-nowrap px-3 py-2 text-right text-zinc-300">
											{formatPerMillionPrice(row.outputPer1m, row.currencyCode)}
										</td>
										<td className="max-w-[14rem] truncate px-3 py-2 text-zinc-500">
											{row.sourceLabel || (row.manualOverride ? "Manual" : "-")}
										</td>
										<td className="whitespace-nowrap px-3 py-2 text-zinc-500">
											{formatPricingDate(row.fetchedAt)}
										</td>
									</tr>
								))
							) : (
								<tr>
									<td
										colSpan={7}
										className="px-3 py-6 text-center text-zinc-500"
									>
										まだ価格表は取得されていません。
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
				<div className="text-[11px] text-zinc-500">
					対象 provider {visiblePricingRows.length} 件 / 保存済み価格行{" "}
					{pricingRows.length} 件
				</div>
			</div>
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
						<CheckCircle2 className="h-4 w-4 shrink-0" />
					) : (
						<XCircle className="h-4 w-4 shrink-0" />
					)}
					<span>{message}</span>
				</p>
			) : null}
		</section>
	);
}
