import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const artifactPaneActionsSource = readFileSync(
	new URL(
		"../src/modules/nightworkers/components/ArtifactPaneActions.tsx",
		import.meta.url,
	),
	"utf8",
);
const artifactPaneSource = readFileSync(
	new URL(
		"../src/modules/nightworkers/components/ArtifactPane.tsx",
		import.meta.url,
	),
	"utf8",
);
const utilityOverridesCss = readFileSync(
	new URL("../src/styles/nightworkers-utility-overrides.css", import.meta.url),
	"utf8",
);

afterEach(() => {
	vi.doUnmock("react");
	vi.doUnmock("react-i18next");
	vi.resetModules();
});

describe("ArtifactExportMenu", () => {
	it("groups image, Markdown download, and Markdown copy into one menu", async () => {
		vi.resetModules();
		vi.doMock("react", async () => {
			const actual = await vi.importActual<typeof import("react")>("react");
			return {
				...actual,
				useEffect: vi.fn(),
				useRef: <T,>(initial: T) => ({ current: initial }),
				useState: () => [true, vi.fn()] as const,
			};
		});
		vi.doMock("react-i18next", async () => ({
			...(await vi.importActual<typeof import("react-i18next")>(
				"react-i18next",
			)),
			useTranslation: () => ({ t: (key: string) => key }),
		}));
		const { ArtifactExportMenu } = await import(
			"../src/modules/nightworkers/components/ArtifactPaneActions"
		);
		const element = ArtifactExportMenu({
			onCopyMarkdown: vi.fn(),
			onDownloadMarkdown: vi.fn(),
			onDownloadImage: vi.fn(),
			isExportingImage: false,
			exportError: null,
		});
		const labels = collectPropValues(element, "label");

		expect(labels).toEqual([
			"artifact.downloadImage",
			"artifact.downloadMarkdown",
			"artifact.copyMarkdown",
		]);
		expect(collectPropValues(element, "role")).toContain("menu");
		expect(collectPropValues(element, "className")).toEqual(
			expect.arrayContaining([
				expect.stringContaining("nightworkers-artifact-export-trigger"),
				expect.stringContaining("nightworkers-artifact-export-menu"),
			]),
		);
	});

	it("adds CSV download when the artifact supplies CSV data", async () => {
		vi.resetModules();
		vi.doMock("react", async () => {
			const actual = await vi.importActual<typeof import("react")>("react");
			return {
				...actual,
				useEffect: vi.fn(),
				useRef: <T,>(initial: T) => ({ current: initial }),
				useState: () => [true, vi.fn()] as const,
			};
		});
		vi.doMock("react-i18next", async () => ({
			...(await vi.importActual<typeof import("react-i18next")>(
				"react-i18next",
			)),
			useTranslation: () => ({ t: (key: string) => key }),
		}));
		const { ArtifactExportMenu } = await import(
			"../src/modules/nightworkers/components/ArtifactPaneActions"
		);
		const element = ArtifactExportMenu({
			onCopyMarkdown: vi.fn(),
			onDownloadMarkdown: vi.fn(),
			onDownloadCsv: vi.fn(),
			onDownloadImage: vi.fn(),
			isExportingImage: false,
			exportError: null,
		});

		expect(collectPropValues(element, "label")).toEqual([
			"artifact.downloadImage",
			"artifact.downloadMarkdown",
			"artifact.downloadCsv",
			"artifact.copyMarkdown",
		]);
	});

	it("styles the complete menu through NightWorkers design tokens", () => {
		for (const className of [
			"nightworkers-artifact-export-trigger",
			"nightworkers-artifact-export-menu",
			"nightworkers-artifact-export-menu-item",
			"nightworkers-artifact-export-error",
		]) {
			expect(`${artifactPaneSource}\n${artifactPaneActionsSource}`).toContain(
				className,
			);
			expect(utilityOverridesCss).toContain(`.${className}`);
		}

		const menuSource = artifactPaneActionsSource.slice(
			artifactPaneActionsSource.indexOf("export function ArtifactExportMenu"),
			artifactPaneActionsSource.indexOf("function ArtifactExportMenuItem"),
		);
		expect(menuSource).not.toMatch(
			/bg-\[#181825\]|text-slate-200|text-slate-300|border-slate-700|text-rose-300/,
		);
		expect(utilityOverridesCss).toMatch(
			/\.nightworkers-artifact-export-menu\s*\{[^}]*background:\s*var\(--nw-panel\)/s,
		);
		expect(utilityOverridesCss).toMatch(
			/\.nightworkers-artifact-export-menu-item\s*\{[^}]*color:\s*var\(--nw-text\)/s,
		);
	});
});

function collectPropValues(node: unknown, key: string): unknown[] {
	if (!node || typeof node !== "object") return [];
	if (Array.isArray(node)) {
		return node.flatMap((child) => collectPropValues(child, key));
	}
	const props = (node as { props?: Record<string, unknown> }).props;
	if (!props) return [];
	return [
		...(key in props ? [props[key]] : []),
		...collectPropValues(props.children, key),
	];
}
