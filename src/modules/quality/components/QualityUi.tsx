import type React from "react";
import {
	mutedTextStyle,
	primaryTextStyle,
	tableBorderStyle,
} from "./qualityStyles";

export function EmptyTableRow({
	colSpan,
	message,
}: {
	colSpan: number;
	message: string;
}) {
	return (
		<tr className="border-t" style={tableBorderStyle}>
			<td
				colSpan={colSpan}
				className="px-4 py-6 text-center text-xs"
				style={mutedTextStyle}
			>
				{message}
			</td>
		</tr>
	);
}

export function SectionHeading({
	icon,
	title,
}: {
	icon: React.ReactNode;
	title: string;
}) {
	return (
		<h2 className="flex items-center gap-2 text-base font-bold">
			<span style={primaryTextStyle}>{icon}</span>
			{title}
		</h2>
	);
}

export function SectionLabel({
	icon,
	title,
}: {
	icon: React.ReactNode;
	title: string;
}) {
	return (
		<h3 className="flex items-center gap-2 text-sm font-bold">
			<span style={primaryTextStyle}>{icon}</span>
			{title}
		</h3>
	);
}

export function JestStatusLabel({ status }: { status: string }) {
	const failed = status === "FAIL" || status === "failed";
	const tone = failed ? "var(--nw-danger)" : "var(--nw-success)";
	return (
		<span
			className="inline-flex h-6 items-center border px-2 font-mono text-[11px] font-bold"
			style={{
				background: `color-mix(in srgb, ${tone} 12%, var(--nw-panel))`,
				borderColor: `color-mix(in srgb, ${tone} 42%, var(--nw-border))`,
				borderRadius: "var(--nw-control-radius)",
				color: tone,
			}}
		>
			{failed ? "FAIL" : "PASS"}
		</span>
	);
}
