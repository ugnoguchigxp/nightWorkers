import { Activity, ClipboardCheck, TestTube2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { OverviewDashboard } from "../../../../shared/schemas/overview.schema";
import { formatDateTime } from "../../../i18n/format";
import type { OverviewRange } from "../../nightworkers/routing/workbench-route-state";
import { formatCompactNumber, formatExactNumber } from "../overviewFormat";
import {
	controlStyle,
	mutedTextStyle,
	panelStyle,
	primaryTextStyle,
	subtleTextStyle,
} from "../overviewStyles";
import { SectionTitle } from "./OverviewPrimitives";

export function OverviewContextBar({
	projectContext,
	range,
	activeProvider,
	activeModel,
}: {
	projectContext: OverviewDashboard["projectContext"];
	range: OverviewRange;
	activeProvider: string | null;
	activeModel: string | null;
}) {
	const { t } = useTranslation();
	if (!projectContext) {
		return (
			<div
				className="flex flex-wrap items-center justify-between gap-3 border px-4 py-3 text-xs"
				style={panelStyle}
			>
				<div>
					<div className="font-semibold">{t("overview.context.all")}</div>
					<div className="mt-0.5" style={subtleTextStyle}>
						{t(`overview.range.${range}`)}
					</div>
				</div>
				{activeProvider ? (
					<div className="font-mono" style={mutedTextStyle}>
						{activeProvider}
						{activeModel ? ` / ${activeModel}` : ""}
					</div>
				) : null}
			</div>
		);
	}

	const meta = projectContext.projectMeta;
	return (
		<div
			className="flex flex-wrap items-center justify-between gap-3 border px-4 py-3 text-xs"
			style={panelStyle}
		>
			<div className="min-w-0">
				<div className="truncate font-semibold">
					{projectContext.repository.name} / {projectContext.repository.branch}
				</div>
				<div className="mt-0.5 truncate" style={subtleTextStyle}>
					{projectContext.stackProfile.summary ||
						t("overview.context.stackUnknown")}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2" style={mutedTextStyle}>
				{meta?.git.shortHead ? (
					<span className="border px-2 py-1 font-mono" style={controlStyle}>
						{meta.git.shortHead}
					</span>
				) : null}
				{meta ? (
					<span className="border px-2 py-1" style={controlStyle}>
						{t(`projectDetail.meta.fileScale.${meta.fileScale.value}`)} ·{" "}
						{meta.files.source} files
					</span>
				) : null}
			</div>
		</div>
	);
}

export function ProjectSnapshotPanel({
	context,
	language,
	timezone,
}: {
	context: NonNullable<OverviewDashboard["projectContext"]>;
	language: "ja" | "en";
	timezone: string;
}) {
	const { t } = useTranslation();
	const snapshot = context.latestSnapshot;
	return (
		<section className="border p-4" style={panelStyle}>
			<div className="flex flex-wrap items-end justify-between gap-2">
				<SectionTitle
					icon={<Activity className="h-4 w-4" />}
					title={t("overview.section.projectSnapshot")}
				/>
				<div className="text-[10px]" style={subtleTextStyle}>
					{t("overview.projectSnapshot.independent")}
				</div>
			</div>
			<div className="mt-3 grid gap-3 lg:grid-cols-[0.35fr_1fr]">
				<div className="border p-3" style={controlStyle}>
					<div className="flex items-center gap-2 text-xs font-semibold">
						<ClipboardCheck className="h-4 w-4" style={primaryTextStyle} />
						{t("projectDetail.health.evaluation")}
					</div>
					<div className="mt-2 text-2xl font-bold">
						{snapshot.evaluationScore ?? "—"}
					</div>
					<div className="mt-1 text-[10px]" style={subtleTextStyle}>
						{formatDateTime(snapshot.evaluationAt, language, timezone)}
					</div>
				</div>
				<div className="border p-3" style={controlStyle}>
					<div className="flex items-center gap-2 text-xs font-semibold">
						<TestTube2 className="h-4 w-4" style={primaryTextStyle} />
						{t("projectDetail.health.coverageGate")}
					</div>
					{snapshot.coverageAxes.length > 0 ? (
						<div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
							{snapshot.coverageAxes.map((axis) => (
								<div
									key={axis.key}
									className="flex justify-between gap-2 text-xs"
								>
									<span style={subtleTextStyle}>
										{t(`projectDetail.coverage.${axis.key}`)}
									</span>
									<span
										className="font-semibold"
										title={`${formatExactNumber(axis.actualPercent, language)}%`}
									>
										{formatCompactNumber(axis.actualPercent)}%
									</span>
								</div>
							))}
						</div>
					) : (
						<div className="mt-2 text-sm font-semibold">—</div>
					)}
					<div className="mt-2 text-[10px]" style={subtleTextStyle}>
						{formatDateTime(snapshot.coverageAt, language, timezone)}
					</div>
				</div>
			</div>
		</section>
	);
}
