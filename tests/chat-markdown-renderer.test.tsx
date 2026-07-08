import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChatMarkdown } from "../src/modules/nightworkers/components/ThreadTimelineMarkdown";

// Mock i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}));

// Mock CodeBlock
vi.mock("@/components/ui/CodeBlock", () => ({
	CodeBlock: ({
		data,
	}: {
		data: Array<{ language?: string; filename?: string; code?: string }>;
	}) => (
		<pre
			data-testid="code-block"
			data-lang={data[0]?.language}
			data-file={data[0]?.filename}
		>
			{data[0]?.code}
		</pre>
	),
}));

describe("ChatMarkdown component", () => {
	it("renders headings, blockquotes, tables and normal text", () => {
		const markdown = `
# Title H1
## Title H2
### Title H3
> Quote line

| Col 1 | Col 2 |
| ----- | ----- |
| Val 1 | Val 2 |
`;
		const markup = renderToStaticMarkup(<ChatMarkdown content={markdown} />);
		expect(markup).toContain("Title H1");
		expect(markup).toContain("Title H2");
		expect(markup).toContain("Title H3");
		expect(markup).toContain("blockquote");
		expect(markup).toContain("table");
		expect(markup).toContain("Val 1");
	});

	it("renders inline code and fenced code blocks", () => {
		const markdown = `
Here is \`inline code\`.
\`\`\`ts
const x = 42;
\`\`\`
`;
		const markup = renderToStaticMarkup(<ChatMarkdown content={markdown} />);
		expect(markup).toContain("inline code");
		expect(markup).toContain("code-block");
		expect(markup).toContain("const x = 42;");
	});

	it("identifies project file links and triggers onOpenProjectFile", () => {
		const onOpenProjectFile = vi.fn();
		const markdown = `Open [main.tsx](file:///Users/y.noguchi/Code/nightWorkers/src/main.tsx) to edit.`;
		const markup = renderToStaticMarkup(
			<ChatMarkdown content={markdown} onOpenProjectFile={onOpenProjectFile} />,
		);

		expect(markup).toContain("data-project-file-link");
		expect(markup).toContain("main.tsx");
	});

	it("identifies test mode artifact link and triggers onOpenTestModeArtifact", () => {
		const onOpenTestModeArtifact = vi.fn();
		const markdown = `Go to [Test Runner](http://localhost:3000/sessions/sess-1?artifact=test_mode).`;
		const markup = renderToStaticMarkup(
			<ChatMarkdown
				content={markdown}
				onOpenTestModeArtifact={onOpenTestModeArtifact}
			/>,
		);

		expect(markup).toContain('data-workbench-artifact-link="test_mode"');
	});
});
