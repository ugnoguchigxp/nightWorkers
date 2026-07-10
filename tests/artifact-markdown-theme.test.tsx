import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import { MarkdownViewer } from "../src/modules/nightworkers/components/ArtifactFileViewers";

type Rgb = [number, number, number];

const shellCss = readFileSync(
	new URL("../src/styles/nightworkers-shell.css", import.meta.url),
	"utf8",
);
const themeCss = readFileSync(
	new URL("../src/styles/nightworkers-themes.css", import.meta.url),
	"utf8",
);

function themeBlock(css: string, theme?: string): string {
	const selector = theme
		? `.nightworkers-shell[data-theme="${theme}"]`
		: ".nightworkers-shell";
	const start = css.indexOf(`${selector} {`);
	if (start < 0) throw new Error(`Missing theme block: ${selector}`);
	const bodyStart = css.indexOf("{", start) + 1;
	const bodyEnd = css.indexOf("}", bodyStart);
	return css.slice(bodyStart, bodyEnd);
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

describe("artifact Markdown theme", () => {
	it("renders every Markdown primitive through semantic artifact classes", () => {
		const markup = renderToStaticMarkup(
			<MarkdownViewer
				content={[
					"# Heading",
					"## Section",
					"> Supporting detail",
					"",
					"Body with `inline code` and [a link](https://example.com).",
					"",
					"```ts",
					"const value = true;",
					"```",
					"",
					"| Name | Value |",
					"| --- | --- |",
					"| token | applied |",
				].join("\n")}
			/>,
		);

		expect(markup).toContain("nightworkers-artifact-markdown");
		expect(markup).toContain("nightworkers-artifact-markdown-heading");
		expect(markup).toContain("nightworkers-artifact-markdown-blockquote");
		expect(markup).toContain("nightworkers-artifact-markdown-code");
		expect(markup).toContain("nightworkers-artifact-markdown-pre");
		expect(markup).toContain("nightworkers-artifact-markdown-link");
		expect(markup).toContain("nightworkers-artifact-markdown-header-cell");
		expect(markup).toContain("nightworkers-artifact-markdown-cell");
		expect(markup).not.toMatch(
			/#(?:181825|1e1e2e|313244|89b4fa|cdd6f4|f5c2e7|f5e0dc)/i,
		);
	});

	it("keeps artifact text roles above WCAG AA contrast in every theme", () => {
		const base = themeBlock(shellCss);
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
			const block = theme ? themeBlock(themeCss, theme) : base;
			const background = hslVariable(block, "nw-panel");
			const text = hslVariable(block, "nw-text");
			const muted = mix(hslVariable(block, "nw-muted-text"), text, 0.75);
			const accent = mix(hslVariable(block, "nw-primary"), text, 0.58);
			const codeBackground = mix(
				hslVariable(block, "nw-surface-soft"),
				background,
				0.88,
			);
			const label = theme ?? "dark";

			expect(
				contrast(text, background),
				`${label} body`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(muted, background),
				`${label} supporting text`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(accent, background),
				`${label} links and inline code`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(text, codeBackground),
				`${label} code and table headers`,
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("keeps structured artifact cards and status tones above WCAG AA contrast", () => {
		const base = themeBlock(shellCss);
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
			const block = theme ? themeBlock(themeCss, theme) : base;
			const background = hslVariable(block, "nw-panel");
			const text = hslVariable(block, "nw-text");
			const cardBackground = mix(
				hslVariable(block, "nw-surface-soft"),
				background,
				0.72,
			);
			const muted = mix(hslVariable(block, "nw-muted-text"), text, 0.6);
			const accent = mix(hslVariable(block, "nw-primary"), text, 0.5);
			const successBackground = mix(
				hslVariable(block, "nw-success"),
				background,
				0.1,
			);
			const successText = mix(hslVariable(block, "nw-success"), text, 0.68);
			const primary = hslVariable(block, "nw-primary");
			const warningBase = hslVariable(block, "nw-warning");
			const warning = mix(warningBase, text, 0.5);
			const warningBackground = mix(warningBase, background, 0.1);
			const activeTabBackground = mix(primary, background, 0.1);
			const label = theme ?? "dark";

			expect(
				contrast(text, cardBackground),
				`${label} structured body`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(muted, cardBackground),
				`${label} structured supporting text`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(accent, cardBackground),
				`${label} structured accent`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(successText, successBackground),
				`${label} structured success`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(warning, cardBackground),
				`${label} structured warning`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(warning, warningBackground),
				`${label} structured warning pill`,
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(accent, activeTabBackground),
				`${label} active artifact tab`,
			).toBeGreaterThanOrEqual(4.5);
		}
	});
});
