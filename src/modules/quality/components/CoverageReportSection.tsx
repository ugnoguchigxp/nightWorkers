import {
	ClipboardCheck,
	ClipboardPlus,
	FileCode2,
	Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import type { ProjectQualityRun } from "../../../../shared/schemas/quality.schema";
import type {
	CoverageDisplayValue,
	CoverageFileRow,
} from "../model/qualityRows";
import { EmptyTableRow, SectionLabel } from "./QualityUi";
import {
	mutedTextStyle,
	panelStyle,
	primaryButtonStyle,
	subtleTextStyle,
	tableBorderStyle,
} from "./qualityStyles";

export function CoverageReportSection({
	coverageRun,
	coverageRows,
	selectedFileKeys,
	busy,
	creatingTask,
	notice,
	onToggleFile,
	onOpenFile,
	onCreateTask,
}: {
	coverageRun: ProjectQualityRun | null;
	coverageRows: CoverageFileRow[];
	selectedFileKeys: string[];
	busy: boolean;
	creatingTask: boolean;
	notice: string;
	onToggleFile?: (fileKey: string) => void;
	onOpenFile?: (row: CoverageFileRow) => void;
	onCreateTask?: () => void;
}) {
	const { t } = useTranslation();
	const selectionLimitReached = selectedFileKeys.length >= 20;

	return (
		<div className="overflow-hidden border" style={panelStyle}>
			<div
				className="flex items-center justify-between gap-3 border-b p-3"
				style={tableBorderStyle}
			>
				<div>
					<SectionLabel
						icon={<ClipboardCheck className="h-4 w-4" />}
						title={t("projectDetail.quality.coverageReport")}
					/>
					<div className="mt-1 text-xs" style={mutedTextStyle}>
						{t("projectDetail.quality.coverageSubtitle")}
					</div>
				</div>
				<Button
					type="button"
					onClick={onCreateTask}
					disabled={busy || selectedFileKeys.length === 0 || !coverageRun}
					className="h-8 px-3 text-xs font-semibold"
					style={primaryButtonStyle}
				>
					{creatingTask ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
					) : (
						<ClipboardPlus className="h-3.5 w-3.5" />
					)}
					{creatingTask
						? t("projectDetail.quality.coverageTaskCreating")
						: t("projectDetail.quality.createCoverageTask", {
								count: selectedFileKeys.length,
							})}
				</Button>
			</div>
			{notice ? (
				<div
					className="border-b px-3 py-2 text-xs"
					style={mutedTextStyle}
					aria-live="polite"
				>
					{notice}
				</div>
			) : null}
			<section
				className="nightworkers-scrollbar overflow-auto"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable report regions must be keyboard focusable.
				tabIndex={0}
				aria-label={t("projectDetail.quality.coverageReport")}
			>
				<table className="w-full min-w-[1040px] border-collapse font-mono text-xs">
					<thead>
						<tr style={subtleTextStyle}>
							<th
								className="border-b py-2 pl-4 text-left"
								style={tableBorderStyle}
							>
								{t("projectDetail.quality.select")}
							</th>
							<th className="border-b py-2 text-left" style={tableBorderStyle}>
								{t("projectDetail.field.file")}
							</th>
							<th
								className="border-b px-2 py-2 text-right"
								style={tableBorderStyle}
							>
								{t("projectDetail.field.statements")}
							</th>
							<th
								className="border-b px-2 py-2 text-right"
								style={tableBorderStyle}
							>
								{t("projectDetail.field.branches")}
							</th>
							<th
								className="border-b px-2 py-2 text-right"
								style={tableBorderStyle}
							>
								{t("projectDetail.field.functions")}
							</th>
							<th
								className="border-b px-2 py-2 text-right"
								style={tableBorderStyle}
							>
								{t("projectDetail.field.lines")}
							</th>
							<th
								className="border-b py-2 pr-4 text-left"
								style={tableBorderStyle}
							>
								{t("projectDetail.field.uncoveredLines")}
							</th>
						</tr>
					</thead>
					<tbody>
						{coverageRows.length > 0 ? (
							coverageRows.map((row) => {
								const selected = selectedFileKeys.includes(row.key);
								const rowSelectionDisabled =
									busy || (selectionLimitReached && !selected);

								return (
									<tr
										key={row.key}
										className={row.summary ? "font-bold" : undefined}
										style={
											row.summary
												? {
														background:
															"color-mix(in srgb, var(--nw-primary) 7%, var(--nw-panel))",
													}
												: undefined
										}
									>
										<td className="border-b py-2 pl-4" style={tableBorderStyle}>
											{row.summary ? null : (
												<input
													type="checkbox"
													checked={selected}
													disabled={rowSelectionDisabled}
													aria-label={t(
														"projectDetail.quality.selectCoverageFile",
														{ file: row.file },
													)}
													onChange={() => onToggleFile?.(row.key)}
												/>
											)}
										</td>
										<td className="border-b py-2" style={tableBorderStyle}>
											{row.summary ? (
												<span className="block max-w-[360px] truncate">
													{row.file}
												</span>
											) : (
												<button
													type="button"
													className="inline-flex max-w-[360px] cursor-pointer items-center gap-1.5 truncate rounded-sm px-1 py-0.5 text-left font-semibold underline decoration-current underline-offset-4 hover:bg-[color-mix(in_srgb,var(--nw-primary)_12%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nw-primary)]"
													title={t("projectDetail.quality.openCoverageViewer", {
														file: row.file,
													})}
													onClick={() => onOpenFile?.(row)}
													style={{ color: "var(--nw-primary)" }}
												>
													<FileCode2 className="h-3.5 w-3.5 shrink-0" />
													<span className="truncate">{row.file}</span>
												</button>
											)}
										</td>
										<CoverageCell value={row.statements} />
										<CoverageCell value={row.branches} />
										<CoverageCell value={row.functions} />
										<CoverageCell value={row.lines} />
										<td className="border-b py-2 pr-4" style={tableBorderStyle}>
											<span
												className="block max-w-[360px] truncate"
												style={subtleTextStyle}
											>
												{row.uncovered}
											</span>
										</td>
									</tr>
								);
							})
						) : (
							<EmptyTableRow
								colSpan={7}
								message={t("projectDetail.empty.coverageReport")}
							/>
						)}
					</tbody>
				</table>
			</section>
		</div>
	);
}

function CoverageCell({ value }: { value: CoverageDisplayValue }) {
	if (value === null) {
		return (
			<td
				className="border-b px-2 py-2 text-right font-bold"
				style={tableBorderStyle}
			>
				—
			</td>
		);
	}
	const tone =
		value >= 85
			? "var(--nw-success)"
			: value >= 80
				? "var(--nw-warning)"
				: "var(--nw-danger)";
	return (
		<td
			className="border-b px-2 py-2 text-right font-bold"
			style={{
				...tableBorderStyle,
				background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
				color: tone,
			}}
		>
			{value.toFixed(1)}
		</td>
	);
}
