import type React from "react";

export const overviewShellStyle = {
	background: "var(--nw-background)",
	color: "var(--nw-text)",
} satisfies React.CSSProperties;

export const panelStyle = {
	background: "var(--nw-panel)",
	borderColor: "var(--nw-border)",
	borderRadius: "var(--nw-radius)",
	boxShadow: "var(--nw-shadow)",
	color: "var(--nw-text)",
} satisfies React.CSSProperties;

export const controlStyle = {
	background: "var(--nw-panel)",
	borderColor: "var(--nw-border)",
	borderRadius: "var(--nw-control-radius)",
	color: "var(--nw-text)",
} satisfies React.CSSProperties;

export const mutedTextStyle = {
	color: "var(--nw-muted-text)",
} satisfies React.CSSProperties;

export const subtleTextStyle = {
	color: "var(--nw-subtle-text)",
} satisfies React.CSSProperties;

export const primaryTextStyle = {
	color: "var(--nw-primary)",
} satisfies React.CSSProperties;

export const tokenSegmentStyles = {
	input: {
		background: "var(--nw-primary)",
		color: "var(--nw-primary)",
	},
	cachedInput: {
		background: "var(--nw-success)",
		color: "var(--nw-success)",
	},
	output: {
		background: "var(--nw-warning)",
		color: "var(--nw-warning)",
	},
} satisfies Record<string, React.CSSProperties>;

export const tableBorderStyle = {
	borderColor: "var(--nw-border)",
} satisfies React.CSSProperties;
