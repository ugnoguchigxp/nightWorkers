import { useTranslation } from "react-i18next";
import type { OverviewDashboard } from "../../../../shared/schemas/overview.schema";
import { formatDateTime } from "../../../i18n/format";
import { handleWorkbenchAnchorClick } from "../../nightworkers/routing/workbench-link-click";
import { serializeWorkbenchRoute } from "../../nightworkers/routing/workbench-route-state";
import type { NightWorkersCurrency } from "../../settings";
import {
	primaryTextStyle,
	subtleTextStyle,
	tableBorderStyle,
} from "../overviewStyles";
import { getUncachedInputTokens } from "../overviewViewModel";
import {
	CompactCostValue,
	CompactNumberValue,
	EmptyTableRow,
	formatTokensPerSecond,
	OverviewTable,
} from "./OverviewPrimitives";

export function OverviewTables({
	dashboard,
	language,
	timezone,
	currency,
	onOpenSession,
}: {
	dashboard: OverviewDashboard;
	language: "ja" | "en";
	timezone: string;
	currency: NightWorkersCurrency;
	onOpenSession: (sessionId: string) => void;
}) {
	const { t } = useTranslation();
	return (
		<section className="grid gap-4 xl:grid-cols-2">
			<OverviewTable title={t("overview.section.models")}>
				<thead style={subtleTextStyle}>
					<tr>
						<th className="py-2 text-left">{t("overview.table.model")}</th>
						<th className="py-2 text-right">{t("overview.table.input")}</th>
						<th className="py-2 text-right">
							{t("overview.table.cachedInput")}
						</th>
						<th className="py-2 text-right">{t("overview.table.output")}</th>
						<th className="py-2 text-right">
							{t("overview.table.outputSpeed")}
						</th>
						<th className="py-2 text-right">{t("overview.table.calls")}</th>
						<th className="py-2 text-right">{t("overview.table.cost")}</th>
						<th className="py-2 text-right">{t("overview.table.pricing")}</th>
					</tr>
				</thead>
				<tbody>
					{dashboard.modelBreakdown.length === 0 ? (
						<EmptyTableRow colSpan={8} />
					) : null}
					{dashboard.modelBreakdown.map((item) => (
						<tr
							key={JSON.stringify([item.provider, item.model])}
							className="border-t"
							style={tableBorderStyle}
						>
							<td className="max-w-[220px] truncate py-2">
								<div className="font-semibold">
									{item.model || t("overview.value.unknownModel")}
								</div>
								<div className="text-[10px]" style={subtleTextStyle}>
									{item.provider}
								</div>
							</td>
							<td className="py-2 text-right">
								<CompactNumberValue
									value={getUncachedInputTokens(item)}
									language={language}
								/>
							</td>
							<td className="py-2 text-right">
								<CompactNumberValue
									value={item.cachedInputTokens}
									language={language}
								/>
							</td>
							<td className="py-2 text-right">
								<CompactNumberValue
									value={item.outputTokens}
									language={language}
								/>
							</td>
							<td className="py-2 text-right">
								{formatTokensPerSecond(item.outputTokensPerSecond)}
							</td>
							<td className="py-2 text-right">{item.callCount}</td>
							<td className="py-2 text-right">
								<CompactCostValue
									estimatedCost={item.estimatedCost}
									estimatedCredits={item.estimatedCredits}
									currency={currency}
									language={language}
								/>
							</td>
							<td className="py-2 text-right">
								{t(`overview.pricingStatus.${item.pricingStatus}`)}
							</td>
						</tr>
					))}
				</tbody>
			</OverviewTable>

			<OverviewTable title={t("overview.section.recent")}>
				<thead style={subtleTextStyle}>
					<tr>
						<th className="py-2 text-left">{t("overview.table.call")}</th>
						<th className="py-2 text-right">{t("overview.table.input")}</th>
						<th className="py-2 text-right">
							{t("overview.table.cachedInput")}
						</th>
						<th className="py-2 text-right">{t("overview.table.output")}</th>
						<th className="py-2 text-right">
							{t("overview.table.outputSpeed")}
						</th>
						<th className="py-2 text-right">{t("overview.table.cost")}</th>
					</tr>
				</thead>
				<tbody>
					{dashboard.recentExpensiveCalls.length === 0 ? (
						<EmptyTableRow colSpan={6} />
					) : null}
					{dashboard.recentExpensiveCalls.map((call) => (
						<tr key={call.id} className="border-t" style={tableBorderStyle}>
							<td className="max-w-[280px] py-2">
								<a
									href={serializeWorkbenchRoute({
										kind: "session",
										sessionId: call.taskId,
										artifact: null,
									})}
									className="truncate text-left font-semibold"
									style={primaryTextStyle}
									onClick={(event) =>
										handleWorkbenchAnchorClick(event, () =>
											onOpenSession(call.taskId),
										)
									}
								>
									{call.taskTitle || call.label}
								</a>
								<div className="truncate text-[10px]" style={subtleTextStyle}>
									{call.provider} /{" "}
									{call.model || t("overview.value.unknownModel")} /{" "}
									{formatDateTime(call.createdAt, language, timezone)}
								</div>
							</td>
							<td className="py-2 text-right">
								<CompactNumberValue
									value={getUncachedInputTokens(call)}
									language={language}
								/>
							</td>
							<td className="py-2 text-right">
								<CompactNumberValue
									value={call.cachedInputTokens}
									language={language}
								/>
							</td>
							<td className="py-2 text-right">
								<CompactNumberValue
									value={call.outputTokens}
									language={language}
								/>
							</td>
							<td className="py-2 text-right">
								{formatTokensPerSecond(call.outputTokensPerSecond)}
							</td>
							<td className="py-2 text-right">
								<CompactCostValue
									estimatedCost={call.estimatedCost}
									estimatedCredits={call.estimatedCredits}
									currency={currency}
									language={language}
								/>
							</td>
						</tr>
					))}
				</tbody>
			</OverviewTable>
		</section>
	);
}
