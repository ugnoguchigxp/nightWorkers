import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import "../src/i18n/setup";
import { DiffViewer } from "../src/modules/nightworkers/components/ArtifactFileViewers";
import { ChatMarkdown } from "../src/modules/nightworkers/components/ThreadTimelineMarkdown";
import { normalizeProjectFileLinkTarget } from "../src/modules/nightworkers/utils/projectFileLinks";

describe("project file links", () => {
	it("normalizes repository-relative file link targets", () => {
		expect(
			normalizeProjectFileLinkTarget("api/routes/todos.route.test.ts:42"),
		).toBe("api/routes/todos.route.test.ts");
		expect(normalizeProjectFileLinkTarget("./src/App.tsx#L10")).toBe(
			"src/App.tsx",
		);
	});

	it("does not treat external URLs or API routes as source files", () => {
		expect(
			normalizeProjectFileLinkTarget("https://example.com/src/App.ts"),
		).toBe(null);
		expect(normalizeProjectFileLinkTarget("/api/todos")).toBe(null);
		expect(normalizeProjectFileLinkTarget("../outside/file.ts")).toBe(null);
	});

	it("marks chat markdown repository file links for project tree navigation", () => {
		const markup = renderToStaticMarkup(
			<ChatMarkdown
				content="[api/routes/todos.route.test.ts](api/routes/todos.route.test.ts)"
				onOpenProjectFile={() => undefined}
			/>,
		);

		expect(markup).toContain(
			'data-project-file-link="api/routes/todos.route.test.ts"',
		);
		expect(markup).not.toContain('target="_blank"');
	});

	it("marks chat markdown Test Mode links for workbench artifact navigation", () => {
		const markup = renderToStaticMarkup(
			<ChatMarkdown
				content="[テストモードに入り、完了条件テストの構築をする](/sessions/task-1?artifact=test_mode)"
				onOpenTestModeArtifact={() => undefined}
			/>,
		);

		expect(markup).toContain('data-workbench-artifact-link="test_mode"');
		expect(markup).not.toContain('target="_blank"');
	});

	it("marks git diff changed files and renders colored diff lines", () => {
		const markup = renderToStaticMarkup(
			<DiffViewer
				diff={[
					"diff --git a/src/App.tsx b/src/App.tsx",
					"--- a/src/App.tsx",
					"+++ b/src/App.tsx",
					"@@ -1,2 +1,2 @@",
					"-old",
					"+new",
				].join("\n")}
				onOpenProjectFile={() => undefined}
			/>,
		);

		expect(markup).toContain('data-project-file-link="src/App.tsx"');
		expect(markup).toContain("nightworkers-diff-line-remove");
		expect(markup).toContain("nightworkers-diff-line-add");
	});
});
