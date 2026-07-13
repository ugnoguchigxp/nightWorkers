import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import { ThreadMessage } from "../src/modules/nightworkers/components/ThreadMessage";
import { DiffCodeBlock } from "../src/modules/nightworkers/components/ThreadTimelineDiffView";
import { ChatMarkdown } from "../src/modules/nightworkers/components/ThreadTimelineMarkdown";

type Rgb = [number, number, number];

const shellCss = readFileSync(
	new URL("../src/styles/nightworkers-shell.css", import.meta.url),
	"utf8",
);
const themeCss = readFileSync(
	new URL("../src/styles/nightworkers-themes.css", import.meta.url),
	"utf8",
);
const cardCss = readFileSync(
	new URL("../src/styles/nightworkers-utility-artifact.css", import.meta.url),
	"utf8",
);

const auditedCardSources = [
	"ThreadTimelineActivityTranscript.tsx",
	"ThreadTimelineAgentCards.tsx",
	"ThreadTimelineCodexToolCard.tsx",
	"ThreadTimelineContextStillCards.tsx",
	"ThreadTimelineImportProjectCard.tsx",
	"ThreadTimelineInspectionToolCard.tsx",
	"ThreadTimelineMessagePayload.tsx",
	"ThreadTimelineNormalTranscript.tsx",
	"ThreadTimelinePermissionDialog.tsx",
	"ThreadTimelineStreaming.tsx",
].map((filename) =>
	readFileSync(
		new URL(
			`../src/modules/nightworkers/components/${filename}`,
			import.meta.url,
		),
		"utf8",
	),
);

function selectorBlock(css: string, selector: string): string {
	const start = css.indexOf(selector);
	if (start < 0) throw new Error(`Missing CSS block: ${selector}`);
	const bodyStart = css.indexOf("{", start) + 1;
	const bodyEnd = css.indexOf("}", bodyStart);
	return css.slice(bodyStart, bodyEnd);
}

function themeBlock(css: string, theme?: string): string {
	const selector = theme
		? `.nightworkers-shell[data-theme="${theme}"]`
		: ".nightworkers-shell";
	return selectorBlock(css, selector);
}

function hslVariable(block: string, name: string): Rgb {
	const match = block.match(
		new RegExp(`--${name}:\\s*hsl\\(\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
	);
	if (!match) throw new Error(`Missing HSL variable: --${name}`);
	const hue = Number(match[1]);
	const saturation = Number(match[2]) / 100;
	const lightness = Number(match[3]) / 100;
	const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const offset = lightness - chroma / 2;
	let channels: Rgb;
	if (hue < 60) channels = [chroma, x, 0];
	else if (hue < 120) channels = [x, chroma, 0];
	else if (hue < 180) channels = [0, chroma, x];
	else if (hue < 240) channels = [0, x, chroma];
	else if (hue < 300) channels = [x, 0, chroma];
	else channels = [chroma, 0, x];
	return channels.map((channel) => channel + offset) as Rgb;
}

function mix(first: Rgb, second: Rgb, firstWeight: number): Rgb {
	return first.map(
		(channel, index) =>
			channel * firstWeight + (second[index] ?? 0) * (1 - firstWeight),
	) as Rgb;
}

function luminance(rgb: Rgb): number {
	const linear = rgb.map((channel) =>
		channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
	);
	return (
		(linear[0] ?? 0) * 0.2126 +
		(linear[1] ?? 0) * 0.7152 +
		(linear[2] ?? 0) * 0.0722
	);
}

function contrast(first: Rgb, second: Rgb): number {
	const firstLuminance = luminance(first);
	const secondLuminance = luminance(second);
	return (
		(Math.max(firstLuminance, secondLuminance) + 0.05) /
		(Math.min(firstLuminance, secondLuminance) + 0.05)
	);
}

describe("chat information card theme", () => {
	it("renders chat, Markdown, and diff content through semantic classes", () => {
		const markup = renderToStaticMarkup(
			<ThreadMessage messageRole="assistant">
				<ChatMarkdown
					content={
						"## Result\n\n> Supporting text\n\n| Name | Value |\n| --- | --- |\n| file | changed |"
					}
				/>
				<DiffCodeBlock
					code={
						"diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new"
					}
					label="file.diff"
				/>
			</ThreadMessage>,
		);

		expect(markup).toContain("nightworkers-message-bubble-assistant");
		expect(markup).toContain("nightworkers-chat-markdown-heading");
		expect(markup).toContain("nightworkers-chat-markdown-muted");
		expect(markup).toContain("nightworkers-chat-markdown-header-cell");
		expect(markup).toContain("nightworkers-diff-file");
		expect(markup).toContain("nightworkers-diff-line-remove");
		expect(markup).toContain("nightworkers-diff-line-add");
	});

	it("does not mix fixed dark card surfaces with theme-dependent text", () => {
		const source = auditedCardSources.join("\n");
		expect(source).not.toMatch(/bg-\[#1f2030\]/);
		expect(source).not.toMatch(/bg-(?:slate|cyan|sky|amber)-9\d\d/);
		expect(source).not.toMatch(/bg-black\/30/);
		expect(source).not.toMatch(/text-(?:slate|zinc|cyan|sky|amber)-\d\d\d/);
		expect(cardCss).toContain("background: var(--nw-code-bg)");
		expect(cardCss).toContain("color: var(--nw-code-text)");
		expect(cardCss).toContain("color: var(--nw-code-muted-text)");
	});

	it("keeps card text roles above WCAG AA contrast in every theme", () => {
		const themes = [
			undefined,
			"light",
			"eclipse",
			"macosclassic",
			"campfire",
			"mint",
			"bloom",
			"mocha",
		];

		for (const theme of themes) {
			const block = theme ? themeBlock(themeCss, theme) : themeBlock(shellCss);
			const panel = hslVariable(block, "nw-panel");
			const surface = hslVariable(block, "nw-surface");
			const surfaceSoft = hslVariable(block, "nw-surface-soft");
			const text = hslVariable(block, "nw-text");
			const muted = hslVariable(block, "nw-muted-text");
			const subtle = hslVariable(block, "nw-subtle-text");
			const primary = hslVariable(block, "nw-primary");
			const warning = hslVariable(block, "nw-warning");
			const danger = hslVariable(block, "nw-danger");
			const success = hslVariable(block, "nw-success");
			const cardBackground = mix(surfaceSoft, panel, 0.68);
			const strongBackground = mix(surface, panel, 0.82);
			const accentBackground = mix(primary, cardBackground, 0.09);
			const warningBackground = mix(warning, cardBackground, 0.09);
			const dangerBackground = mix(danger, cardBackground, 0.09);
			const label = theme ?? "dark";

			const pairs: Array<[string, Rgb, Rgb]> = [
				["body", text, cardBackground],
				["supporting", mix(muted, text, 0.6), cardBackground],
				["subtle", mix(subtle, text, 0.55), cardBackground],
				["nested", text, strongBackground],
				["accent", mix(primary, text, 0.48), accentBackground],
				["warning", mix(warning, text, 0.48), warningBackground],
				["danger", mix(danger, text, 0.48), dangerBackground],
				["success", mix(success, text, 0.56), cardBackground],
			];
			for (const [role, foreground, background] of pairs) {
				expect(
					contrast(foreground, background),
					`${label} ${role}`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("keeps the fixed code and diff palette above WCAG AA contrast", () => {
		const block = selectorBlock(shellCss, ":root");
		const pairs: Array<[string, string, string]> = [
			["code body", "nw-code-text", "nw-code-bg"],
			["code header", "nw-code-muted-text", "nw-code-header-bg"],
			["line numbers", "nw-code-subtle-text", "nw-code-bg"],
			["added line", "nw-code-add-text", "nw-code-add-background"],
			["removed line", "nw-code-remove-text", "nw-code-remove-background"],
			["hunk", "nw-code-hunk-text", "nw-code-hunk-background"],
		];

		for (const [label, foreground, background] of pairs) {
			expect(
				contrast(
					hslVariable(block, foreground),
					hslVariable(block, background),
				),
				label,
			).toBeGreaterThanOrEqual(4.5);
		}
	});
});
