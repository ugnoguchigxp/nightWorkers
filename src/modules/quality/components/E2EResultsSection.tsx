import { TestTube2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { E2EResultRow } from "../model/qualityTypes";
import { EmptyTableRow, JestStatusLabel, SectionLabel } from "./QualityUi";
import { panelStyle, subtleTextStyle, tableBorderStyle } from "./qualityStyles";

export function E2EResultsSection({ rows }: { rows: E2EResultRow[] }) {
	const { t } = useTranslation();
	return (
		<div className="overflow-hidden border" style={panelStyle}>
			<div className="border-b p-3" style={tableBorderStyle}>
				<SectionLabel
					icon={<TestTube2 className="h-4 w-4" />}
					title={t("projectDetail.quality.e2eResults")}
				/>
			</div>
			<section
				className="nightworkers-scrollbar overflow-auto"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable report regions must be keyboard focusable.
				tabIndex={0}
				aria-label={t("projectDetail.quality.e2eResults")}
			>
				<table className="w-full min-w-[720px] text-xs">
					<thead style={subtleTextStyle}>
						<tr>
							<th className="py-2 pl-4 text-left">
								{t("projectDetail.field.status")}
							</th>
							<th className="py-2 text-left">
								{t("projectDetail.field.suite")}
							</th>
							<th className="py-2 text-right">
								{t("projectDetail.field.tests")}
							</th>
							<th className="py-2 text-right">
								{t("projectDetail.field.time")}
							</th>
							<th className="py-2 pr-4 text-left">
								{t("projectDetail.field.lastFailure")}
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.length > 0 ? (
							rows.map((row) => (
								<tr
									key={row.suite}
									className="border-t"
									style={tableBorderStyle}
								>
									<td className="py-3 pl-4">
										<JestStatusLabel status={row.status} />
									</td>
									<td className="py-3 font-semibold">{row.suite}</td>
									<td className="py-3 text-right">{row.tests}</td>
									<td className="py-3 text-right">{row.duration}</td>
									<td className="py-3 pr-4">{row.lastFailure}</td>
								</tr>
							))
						) : (
							<EmptyTableRow
								colSpan={5}
								message={t("projectDetail.empty.e2eResults")}
							/>
						)}
					</tbody>
				</table>
			</section>
		</div>
	);
}
