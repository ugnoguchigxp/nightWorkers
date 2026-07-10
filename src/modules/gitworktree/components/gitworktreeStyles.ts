import type React from "react";

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

export const primaryButtonStyle = {
	background: "var(--nw-primary)",
	borderColor: "var(--nw-primary)",
	borderRadius: "var(--nw-control-radius)",
	color: "var(--nw-primary-foreground, var(--nw-background))",
} satisfies React.CSSProperties;

export const tableBorderStyle = {
	borderColor: "var(--nw-border)",
} satisfies React.CSSProperties;
