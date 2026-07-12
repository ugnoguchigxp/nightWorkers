import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { applyAppLanguage } from "../../i18n/I18nProvider";
import type { GeneralSettings } from "../nightworkers/types";
import { SelectField } from "./SettingsFields";
import { fetchPricingRows, importPublicPricingRows } from "./settingsCommands";

const pricingProviderFilter = new Set([
	"codex",
	"openai",
	"anthropic",
	"google",
	"deepseek",
	"qwen",
]);
const pricingPageSize = 50;

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

type LlmPricingPageView = {
	rows: LlmPricingRowView[];
	totalCount: number;
	nextCursor: string | null;
};

function pricingProviderLabel(provider: string) {
	if (provider === "codex") return "OpenAI Codex";
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
	isRefreshingFx,
	onChange,
	onRefreshFx,
}: {
	value: GeneralSettings;
	isRefreshingFx: boolean;
	onChange: (next: GeneralSettings) => void;
	onRefreshFx: () => void;
}) {
	const { t } = useTranslation();
	const [pricingRows, setPricingRows] = useState<LlmPricingRowView[]>([]);
	const [pricingTotalCount, setPricingTotalCount] = useState(0);
	const [pricingNextCursor, setPricingNextCursor] = useState<string | null>(
		null,
	);
	const [pricingProvider, setPricingProvider] = useState("");
	const [pricingModelQuery, setPricingModelQuery] = useState("");
	const [pricingPage, setPricingPage] = useState(0);
	const [pricingLoading, setPricingLoading] = useState(false);
	const [pricingImporting, setPricingImporting] = useState(false);
	const [pricingMessage, setPricingMessage] = useState("");
	const [pricingMessageKind, setPricingMessageKind] = useState<
		"success" | "error"
	>("success");
	const loadPricingRows = useCallback(async () => {
		setPricingLoading(true);
		try {
			const res = await fetchPricingRows({
				provider: pricingProvider || undefined,
				model: pricingModelQuery.trim() || undefined,
				limit: pricingPageSize,
				cursor: pricingPage > 0 ? String(pricingPage * pricingPageSize) : null,
			});
			if (!res.ok) throw new Error(await res.text());
			const page = (await res.json()) as LlmPricingPageView;
			setPricingRows(page.rows);
			setPricingTotalCount(page.totalCount);
			setPricingNextCursor(page.nextCursor);
		} catch (err) {
			setPricingMessageKind("error");
			setPricingMessage(err instanceof Error ? err.message : String(err));
		} finally {
			setPricingLoading(false);
		}
	}, [pricingModelQuery, pricingPage, pricingProvider]);

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
			setPricingMessageKind("success");
			setPricingMessage(
				t("settings.general.pricing.importSucceeded", {
					count: result.imported,
					providers: result.providers.join(", "),
				}),
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
						{t("settings.general.fxStatus", {
							source: value.fx.source,
							updatedAt:
								value.fx.lastRefreshedAt || t("settings.general.notAvailable"),
						})}
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
						<div className="text-xs font-semibold text-zinc-100">
							{t("settings.general.pricing.title")}
						</div>
						<p className="mt-1 text-[10px] text-zinc-500">
							{t("settings.general.pricing.description")}
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
							{t("settings.general.pricing.refresh")}
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
							{t("settings.general.pricing.import")}
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
					<div className="flex flex-wrap gap-2 p-3">
						<label className="space-y-1 text-[10px] text-zinc-500">
							<span className="block">
								{t("settings.general.pricing.provider")}
							</span>
							<select
								aria-label={t("settings.general.pricing.provider")}
								value={pricingProvider}
								onChange={(event) => {
									setPricingProvider(event.target.value);
									setPricingPage(0);
								}}
								className="h-8 rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200"
							>
								<option value="">
									{t("settings.general.pricing.allProviders")}
								</option>
								{[...pricingProviderFilter].map((provider) => (
									<option key={provider} value={provider}>
										{pricingProviderLabel(provider)}
									</option>
								))}
							</select>
						</label>
						<label className="min-w-56 flex-1 space-y-1 text-[10px] text-zinc-500">
							<span className="block">
								{t("settings.general.pricing.model")}
							</span>
							<input
								aria-label={t("settings.general.pricing.modelSearch")}
								value={pricingModelQuery}
								onChange={(event) => {
									setPricingModelQuery(event.target.value);
									setPricingPage(0);
								}}
								placeholder={t("settings.general.pricing.modelSearch")}
								className="h-8 w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-200"
							/>
						</label>
					</div>
					<table className="min-w-[760px] w-full text-left text-xs">
						<thead className="text-[11px] uppercase text-zinc-500">
							<tr>
								<th className="px-3 py-2 font-semibold">
									{t("settings.general.pricing.provider")}
								</th>
								<th className="px-3 py-2 font-semibold">
									{t("settings.general.pricing.model")}
								</th>
								<th className="px-3 py-2 text-right font-semibold">
									{t("settings.general.pricing.inputPerMillion")}
								</th>
								<th className="px-3 py-2 text-right font-semibold">
									{t("settings.general.pricing.cachedInputPerMillion")}
								</th>
								<th className="px-3 py-2 text-right font-semibold">
									{t("settings.general.pricing.outputPerMillion")}
								</th>
								<th className="px-3 py-2 font-semibold">
									{t("settings.general.pricing.source")}
								</th>
								<th className="px-3 py-2 font-semibold">
									{t("settings.general.pricing.fetchedAt")}
								</th>
							</tr>
						</thead>
						<tbody>
							{pricingLoading ? (
								<tr>
									<td
										colSpan={7}
										className="px-3 py-6 text-center text-zinc-500"
									>
										{t("settings.general.pricing.loading")}
									</td>
								</tr>
							) : pricingRows.length ? (
								pricingRows.map((row) => (
									<tr key={row.id}>
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
											{row.sourceLabel ||
												(row.manualOverride
													? t("settings.general.pricing.manual")
													: "-")}
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
										{t("settings.general.pricing.empty")}
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
				<div className="flex items-center justify-between gap-3 text-[11px] text-zinc-500">
					<span>
						{pricingTotalCount === 0
							? t("settings.general.pricing.countEmpty")
							: t("settings.general.pricing.count", {
									from: pricingPage * pricingPageSize + 1,
									to: pricingPage * pricingPageSize + pricingRows.length,
									total: pricingTotalCount,
								})}
					</span>
					<div className="flex gap-2">
						<Button
							type="button"
							variant="ghost"
							disabled={pricingLoading || pricingPage === 0}
							onClick={() => setPricingPage((page) => Math.max(0, page - 1))}
							className="h-8 px-3 text-xs"
						>
							{t("settings.general.pricing.previous")}
						</Button>
						<Button
							type="button"
							variant="ghost"
							disabled={pricingLoading || !pricingNextCursor}
							onClick={() => setPricingPage((page) => page + 1)}
							className="h-8 px-3 text-xs"
						>
							{t("settings.general.pricing.next")}
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}
