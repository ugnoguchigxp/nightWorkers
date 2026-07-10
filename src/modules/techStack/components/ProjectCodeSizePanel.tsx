import { Database, LoaderCircle, RefreshCw, Ruler } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
	ProjectCodeSizeRootSummary,
	ProjectCodeSizeSnapshot,
	ProjectCodeSizeSourceBucket,
	ProjectCodeSizeTestBucket,
} from "../../../../shared/schemas/tech-stack.schema";

const panelStyle = {
	background: "var(--nw-panel)",
	borderColor: "var(--nw-border)",
	borderRadius: "var(--nw-radius)",
	boxShadow: "var(--nw-shadow)",
	color: "var(--nw-text)",
};
const subtleStyle = { color: "var(--nw-subtle-text)" };

function MetricCard({
	label,
	value,
	sub,
}: {
	label: string;
	value: number;
	sub: string;
}) {
	return (
		<div className="min-w-0 border p-3" style={panelStyle}>
			<div className="text-[10px] font-semibold uppercase" style={subtleStyle}>
				{label}
			</div>
			<div className="mt-2 text-xl font-bold" title={value.toLocaleString()}>
				{value.toLocaleString()}
			</div>
			<div className="mt-1 truncate text-[11px]" style={subtleStyle}>
				{sub}
			</div>
		</div>
	);
}

function rootsLabel(roots: ProjectCodeSizeRootSummary[]) {
	return roots.length > 0
		? roots
				.map(
					(root) =>
						`${root.path}: ${root.effectiveLines} steps / ${root.files} files`,
				)
				.join(", ")
		: "—";
}

function percentage(value: number, total: number) {
	return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}

function BreakdownTable({
	title,
	total,
	rows,
}: {
	title: string;
	total: number;
	rows: Array<{
		key: string;
		label: string;
		files: number;
		effectiveLines: number;
		roots: ProjectCodeSizeRootSummary[];
	}>;
}) {
	const { t } = useTranslation();
	return (
		<div className="overflow-hidden border" style={panelStyle}>
			<div
				className="border-b px-3 py-2 text-xs font-semibold"
				style={{ borderColor: "var(--nw-border)" }}
			>
				{title}
			</div>
			<div className="nightworkers-scrollbar overflow-auto">
				<table className="w-full min-w-[520px] text-xs">
					<thead style={subtleStyle}>
						<tr>
							<th className="px-3 py-2 text-left">
								{t("techStack.codeSize.field.category")}
							</th>
							<th className="px-2 py-2 text-right">
								{t("techStack.codeSize.field.steps")}
							</th>
							<th className="px-2 py-2 text-right">%</th>
							<th className="px-2 py-2 text-right">
								{t("techStack.codeSize.field.files")}
							</th>
							<th className="px-3 py-2 text-left">
								{t("techStack.codeSize.field.roots")}
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr
								key={row.key}
								className="border-t"
								style={{ borderColor: "var(--nw-border)" }}
							>
								<td className="px-3 py-2 font-semibold">{row.label}</td>
								<td className="px-2 py-2 text-right font-mono">
									{row.effectiveLines.toLocaleString()}
								</td>
								<td className="px-2 py-2 text-right">
									{percentage(row.effectiveLines, total)}
								</td>
								<td className="px-2 py-2 text-right">
									{row.files.toLocaleString()}
								</td>
								<td
									className="max-w-[320px] px-3 py-2"
									title={rootsLabel(row.roots)}
								>
									{row.roots.length > 0 ? (
										<div className="space-y-1">
											{row.roots.map((root) => (
												<div key={root.path} className="min-w-0">
													<div className="truncate font-mono">{root.path}</div>
													<div className="text-[10px]" style={subtleStyle}>
														{root.effectiveLines.toLocaleString()}{" "}
														{t("techStack.codeSize.field.steps")} ·{" "}
														{root.files.toLocaleString()}{" "}
														{t("techStack.codeSize.field.files")}
													</div>
												</div>
											))}
										</div>
									) : (
										"—"
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function skippedTotal(snapshot: ProjectCodeSizeSnapshot) {
	return Object.values(snapshot.inventory.skipped).reduce(
		(sum, value) => sum + value,
		0,
	);
}

function skippedDetails(
	snapshot: ProjectCodeSizeSnapshot,
	t: (key: string) => string,
) {
	return Object.entries(snapshot.inventory.skipped)
		.filter(([, count]) => count > 0)
		.map(
			([reason, count]) =>
				`${t(`techStack.codeSize.skipReason.${reason}`)} ${count}`,
		)
		.join(" / ");
}

export function ProjectCodeSizePanel({
	snapshot,
	currentGitHead,
	busy,
	onMeasure,
}: {
	snapshot: ProjectCodeSizeSnapshot | null;
	currentGitHead: string | null;
	busy: boolean;
	onMeasure: () => void;
}) {
	const { t, i18n } = useTranslation();
	const sourceRows = (snapshot?.sourceBuckets ?? []).map(
		(bucket: ProjectCodeSizeSourceBucket) => ({
			key: bucket.category,
			label: t(`techStack.codeSize.source.${bucket.category}`),
			...bucket,
		}),
	);
	const testRows = (snapshot?.testBuckets ?? []).map(
		(bucket: ProjectCodeSizeTestBucket) => ({
			key: bucket.kind,
			label: t(`techStack.codeSize.test.${bucket.kind}`),
			...bucket,
		}),
	);
	const isHeadStale = Boolean(
		snapshot?.git.head &&
			currentGitHead &&
			snapshot.git.head !== currentGitHead,
	);
	return (
		<section className="space-y-3 border p-3" style={panelStyle}>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="flex items-center gap-2 text-sm font-bold">
						<Ruler className="h-4 w-4" />
						{t("techStack.codeSize.title")}
					</h3>
					<p className="mt-1 text-xs" style={subtleStyle}>
						{t("techStack.codeSize.description")}
					</p>
				</div>
				<button
					type="button"
					disabled={busy}
					onClick={onMeasure}
					className="inline-flex h-9 items-center gap-2 border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
					style={{
						background: "var(--nw-primary)",
						borderColor: "var(--nw-primary)",
						borderRadius: "var(--nw-control-radius)",
						color: "var(--nw-primary-foreground, var(--nw-background))",
					}}
				>
					{busy ? (
						<LoaderCircle className="h-3.5 w-3.5 animate-spin" />
					) : (
						<RefreshCw className="h-3.5 w-3.5" />
					)}
					{busy
						? t("techStack.codeSize.measuring")
						: snapshot
							? t("techStack.codeSize.remeasure")
							: t("techStack.codeSize.measure")}
				</button>
			</div>

			{snapshot ? (
				<>
					<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
						<MetricCard
							label={t("techStack.codeSize.total")}
							value={snapshot.totals.totalEffectiveLines}
							sub={t("techStack.codeSize.effectiveLines")}
						/>
						<MetricCard
							label={t("techStack.codeSize.sourceTotal")}
							value={snapshot.totals.sourceEffectiveLines}
							sub={t("techStack.codeSize.sourceSub")}
						/>
						<MetricCard
							label={t("techStack.codeSize.testTotal")}
							value={snapshot.totals.testEffectiveLines}
							sub={t("techStack.codeSize.testSub")}
						/>
						<MetricCard
							label={t("techStack.codeSize.files")}
							value={snapshot.totals.totalFiles}
							sub={t("techStack.codeSize.filesSub")}
						/>
					</div>
					<div className="text-center text-xs font-semibold">
						{snapshot.totals.totalEffectiveLines.toLocaleString()} ={" "}
						{snapshot.totals.sourceEffectiveLines.toLocaleString()} +{" "}
						{snapshot.totals.testEffectiveLines.toLocaleString()}
					</div>
					<div
						className="flex h-2 overflow-hidden"
						style={{
							borderRadius: "var(--nw-control-radius)",
							background: "var(--nw-border)",
						}}
						role="img"
						aria-label={t("techStack.codeSize.equationAria", {
							total: snapshot.totals.totalEffectiveLines,
							source: snapshot.totals.sourceEffectiveLines,
							tests: snapshot.totals.testEffectiveLines,
						})}
					>
						{snapshot.totals.totalEffectiveLines > 0 ? (
							<>
								<div
									style={{
										width: `${(snapshot.totals.sourceEffectiveLines / snapshot.totals.totalEffectiveLines) * 100}%`,
										background: "var(--nw-primary)",
									}}
								/>
								<div
									style={{
										width: `${(snapshot.totals.testEffectiveLines / snapshot.totals.totalEffectiveLines) * 100}%`,
										background: "var(--nw-warning)",
									}}
								/>
							</>
						) : null}
					</div>
					<div className="grid gap-3 xl:grid-cols-2">
						<BreakdownTable
							title={t("techStack.codeSize.sourceBreakdown")}
							total={snapshot.totals.sourceEffectiveLines}
							rows={sourceRows}
						/>
						<BreakdownTable
							title={t("techStack.codeSize.testBreakdown")}
							total={snapshot.totals.testEffectiveLines}
							rows={testRows}
						/>
					</div>
					<div
						className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]"
						style={subtleStyle}
					>
						<span>
							{t("techStack.codeSize.measuredAt")}:{" "}
							{new Date(snapshot.measuredAt).toLocaleString(i18n.language)}
						</span>
						<span>
							{t("techStack.codeSize.duration")}:{" "}
							{snapshot.scanDurationMs.toLocaleString()}ms
						</span>
						<span>
							{snapshot.git.shortHead ?? t("techStack.codeSize.gitUnavailable")}
						</span>
						{snapshot.git.dirty ? (
							<span>{t("techStack.codeSize.dirty")}</span>
						) : null}
						{isHeadStale ? (
							<span style={{ color: "var(--nw-warning)" }}>
								{t("techStack.codeSize.staleHead")}
							</span>
						) : null}
						{skippedTotal(snapshot) > 0 ? (
							<span title={skippedDetails(snapshot, t)}>
								{t("techStack.codeSize.skipped", {
									count: skippedTotal(snapshot),
								})}
								: {skippedDetails(snapshot, t)}
							</span>
						) : null}
					</div>
				</>
			) : (
				<div
					className="flex min-h-28 items-center justify-center border border-dashed px-4 py-6 text-center text-xs"
					style={{ borderColor: "var(--nw-border)" }}
				>
					<div>
						<Database className="mx-auto mb-2 h-5 w-5" style={subtleStyle} />
						<span style={subtleStyle}>{t("techStack.codeSize.empty")}</span>
					</div>
				</div>
			)}
		</section>
	);
}
