import { expect, test } from "@playwright/test";

test("imports Mermaid SVG containing HTML line breaks", async ({ page }) => {
	await page.goto("/");

	const result = await page.evaluate(async () => {
		const componentModulePath =
			"/src/modules/planMode/workspace-panels/MermaidDiagram.tsx";
		const mermaidModulePath = "/node_modules/.vite/deps/mermaid.js";
		const [{ replaceMermaidSvg }, { default: mermaid }] = await Promise.all([
			import(componentModulePath),
			import(mermaidModulePath),
		]);
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: "strict",
			theme: "dark",
		});
		const chart = [
			"flowchart TD",
			'  A["ユーザー"] --> B["スレッド詳細へ入る\\\\n/threads/42"]',
			'  B --> C["投稿中\\\\n送信ボタンを無効化"]',
		].join("\n");
		const rendered = await mermaid.render(
			"plan-mode-mermaid-regression",
			chart,
		);
		const target = document.createElement("button");
		const imported = replaceMermaidSvg(target, rendered.svg);

		return {
			imported,
			svgCount: target.querySelectorAll("svg").length,
			lineBreakCount: target.querySelectorAll("br").length,
			hasForeignObject: Boolean(target.querySelector("foreignObject")),
		};
	});

	expect(result).toEqual({
		imported: true,
		svgCount: 1,
		lineBreakCount: 2,
		hasForeignObject: true,
	});
});

test("rejects output that does not contain an SVG element", async ({
	page,
}) => {
	await page.goto("/");

	const imported = await page.evaluate(async () => {
		const componentModulePath =
			"/src/modules/planMode/workspace-panels/MermaidDiagram.tsx";
		const { replaceMermaidSvg } = await import(componentModulePath);
		return replaceMermaidSvg(
			document.createElement("button"),
			"<div>not svg</div>",
		);
	});

	expect(imported).toBe(false);
});
