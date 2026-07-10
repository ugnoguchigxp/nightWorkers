import { useTranslation } from "react-i18next";
import type { CoverageAxis } from "../model/qualityTypes";
import { subtleTextStyle } from "./qualityStyles";

export function CoverageBreakdown({ axes }: { axes: CoverageAxis[] }) {
	const { t } = useTranslation();
	if (axes.length === 0) {
		return (
			<span
				className="text-2xl font-bold"
				style={{ color: "var(--nw-muted-text)" }}
			>
				—
			</span>
		);
	}
	return (
		<div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
			{axes.map((axis) => (
				<div
					key={axis.labelKey}
					className="flex min-w-0 items-baseline justify-between gap-1 text-[10px]"
				>
					<span className="truncate" style={subtleTextStyle}>
						{t(axis.labelKey)}
					</span>
					<span className="font-semibold">{axis.value}%</span>
				</div>
			))}
		</div>
	);
}
