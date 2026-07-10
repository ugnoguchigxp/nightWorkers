import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildMarkdownFromValue,
	downloadBlob,
	markdownCodeBlock,
	resolveArtifactImagePixelRatio,
} from "../src/modules/nightworkers/artifactExport";
import { copyText } from "../src/modules/nightworkers/components/ArtifactPaneVersions";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("artifact export utilities", () => {
	it("uses a longer Markdown fence when exported content contains backticks", () => {
		const block = markdownCodeBlock(
			"before\n```ts\ninside\n```\nafter",
			"json",
		);
		expect(block).toMatch(/^````json\n/);
		expect(block).toMatch(/\n````$/);
		expect(
			buildMarkdownFromValue("Artifact", { note: "```nested```" }),
		).toContain("````json");
	});

	it("keeps PNG output within the conservative cross-webview limits", () => {
		expect(resolveArtifactImagePixelRatio(720, 10_000)).toBe(1.6);
		expect(() => resolveArtifactImagePixelRatio(720, 16_001)).toThrow(
			"artifact_image_too_large",
		);
	});

	it("attaches the download link before clicking and revokes its URL later", () => {
		vi.useFakeTimers();
		const click = vi.fn();
		const remove = vi.fn();
		const anchor = {
			href: "",
			download: "",
			style: { display: "" },
			click,
			remove,
		};
		const appendChild = vi.fn();
		const revokeObjectURL = vi.fn();
		vi.stubGlobal("document", {
			createElement: vi.fn(() => anchor),
			body: { appendChild },
		});
		vi.stubGlobal("URL", {
			createObjectURL: vi.fn(() => "blob:artifact"),
			revokeObjectURL,
		});

		downloadBlob(new Blob(["artifact"]), "artifact.md");

		expect(appendChild).toHaveBeenCalledWith(anchor);
		expect(click).toHaveBeenCalledOnce();
		expect(remove).toHaveBeenCalledOnce();
		expect(revokeObjectURL).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1_000);
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:artifact");
	});

	it("reports a failed legacy clipboard copy instead of treating it as success", async () => {
		const textarea = {
			value: "",
			style: { position: "", left: "" },
			setAttribute: vi.fn(),
			select: vi.fn(),
			remove: vi.fn(),
		};
		vi.stubGlobal("navigator", {});
		vi.stubGlobal("document", {
			createElement: vi.fn(() => textarea),
			execCommand: vi.fn(() => false),
			body: { appendChild: vi.fn() },
		});

		await expect(copyText("artifact markdown")).rejects.toThrow(
			"clipboard_copy_failed",
		);
		expect(textarea.remove).toHaveBeenCalledOnce();
	});
});
