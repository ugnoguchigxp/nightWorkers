import {
	createElement,
	Fragment,
	isValidElement,
	type ReactElement,
	type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const markdownMocks = vi.hoisted(() => ({
	fallbackClick: vi.fn(),
	preventDefault: vi.fn(),
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("lucide-react", () => ({
	ChevronRight: (props: Record<string, unknown>) => (
		<span data-icon="chevron" {...props} />
	),
	File: (props: Record<string, unknown>) => (
		<span data-icon="file" {...props} />
	),
	Folder: (props: Record<string, unknown>) => (
		<span data-icon="folder" {...props} />
	),
}));

vi.mock("@/components/ui/CodeBlock", () => ({
	CodeBlock: ({
		className,
		data,
		maxHeight,
		showHeader,
		themes,
	}: {
		className: string;
		data: Array<{ code: string; filename: string; language: string }>;
		maxHeight: string;
		showHeader: boolean;
		themes: Record<string, string>;
	}) => (
		<pre
			className={className}
			data-code={data[0]?.code}
			data-filename={data[0]?.filename}
			data-language={data[0]?.language}
			data-max-height={maxHeight}
			data-show-header={String(showHeader)}
			data-theme={themes.dark}
		/>
	),
}));

vi.mock(
	"../src/modules/nightworkers/components/ThreadTimelineDiffView",
	() => ({
		DiffCodeBlock: ({
			className,
			code,
			label,
		}: {
			className: string;
			code: string;
			label: string;
		}) => (
			<pre className={className} data-label={label}>
				{code}
			</pre>
		),
	}),
);

vi.mock("react-markdown", () => ({
	default: ({
		children,
		components,
	}: {
		children: ReactNode;
		components: Record<string, unknown>;
	}) => {
		const component = (name: string) =>
			components[name] as (props: Record<string, unknown>) => ReactElement;
		const renderPrimitive = (name: string, value: ReactNode) =>
			createElement(component(name), { key: name }, value);
		const renderLink = (props: Record<string, unknown>) => {
			const link = component("a")(props);
			const onClick = link.props.onClick as
				| ((event: { preventDefault: () => void }) => void)
				| undefined;
			onClick?.({ preventDefault: markdownMocks.preventDefault });
			return link;
		};

		return createElement(
			Fragment,
			null,
			renderPrimitive("blockquote", "quote"),
			renderPrimitive("code", "inline"),
			renderPrimitive("h1", "one"),
			renderPrimitive("h2", "two"),
			renderPrimitive("h3", "three"),
			renderPrimitive("li", "item"),
			renderPrimitive("ol", "ordered"),
			renderPrimitive("p", children),
			renderPrimitive("pre", "code block"),
			renderPrimitive("table", "table"),
			renderPrimitive("td", "cell"),
			renderPrimitive("th", "header"),
			renderPrimitive("ul", "unordered"),
			renderLink({
				key: "direct",
				href: "src/direct.ts",
				title: "direct title",
				children: "direct",
				onClick: markdownMocks.fallbackClick,
			}),
			renderLink({
				key: "nested",
				href: undefined,
				children: ["src/nested", 2, createElement("span", null, ".tsx"), null],
			}),
			renderLink({
				key: "number",
				href: undefined,
				title: "number title",
				children: 7,
				onClick: markdownMocks.fallbackClick,
			}),
			renderLink({
				key: "external",
				href: "https://example.com",
				title: "external title",
				children: createElement("span"),
			}),
		);
	},
}));

vi.mock("remark-gfm", () => ({ default: "remark-gfm" }));

import {
	DiffViewer,
	FileViewer,
	MarkdownViewer,
	ProjectTree,
} from "../src/modules/nightworkers/components/ArtifactFileViewers";
import type {
	ProjectFileContent,
	ProjectFileEntry,
} from "../src/modules/nightworkers/types";

type HostElement = ReactElement<Record<string, unknown>, string>;

function collectHostElements(node: ReactNode, result: HostElement[] = []) {
	if (node === null || node === undefined || typeof node === "boolean")
		return result;
	if (Array.isArray(node)) {
		for (const child of node) collectHostElements(child, result);
		return result;
	}
	if (!isValidElement<Record<string, unknown>>(node)) return result;
	if (typeof node.type === "function") {
		return collectHostElements(node.type(node.props), result);
	}
	if (node.type === Fragment) {
		return collectHostElements(node.props.children as ReactNode, result);
	}
	if (typeof node.type === "string") {
		result.push(node as HostElement);
		collectHostElements(node.props.children as ReactNode, result);
	}
	return result;
}

function file(path: string, overrides: Partial<ProjectFileContent> = {}) {
	return {
		path,
		content: "file body",
		size: 9,
		truncated: false,
		...overrides,
	};
}

beforeEach(() => {
	markdownMocks.fallbackClick.mockClear();
	markdownMocks.preventDefault.mockClear();
});

describe("ArtifactFileViewers extra coverage", () => {
	it("renders Markdown, empty content, truncation, and project-file links", () => {
		const onOpenProjectFile = vi.fn();
		const markup = renderToStaticMarkup(
			<FileViewer
				file={file("README.MDX", { content: "", truncated: true })}
				onOpenProjectFile={onOpenProjectFile}
			/>,
		);

		expect(markup).toContain("artifact.truncated");
		expect(markup).toContain("artifact.noContent");
		expect(markup).toContain('data-project-file-link="src/direct.ts"');
		expect(markup).toContain('data-project-file-link="src/nested2.tsx"');
		expect(markup).toContain('title="external title"');
		expect(onOpenProjectFile).toHaveBeenCalledWith("src/direct.ts");
		expect(onOpenProjectFile).toHaveBeenCalledWith("src/nested2.tsx");
		expect(markdownMocks.preventDefault).toHaveBeenCalledTimes(2);
	});

	it("uses fallback Markdown link handlers when navigation is unavailable", () => {
		const markup = renderToStaticMarkup(<MarkdownViewer content="plain" />);

		expect(markup).toContain("plain");
		expect(markup).toContain("number title");
		expect(markdownMocks.fallbackClick).toHaveBeenCalledTimes(2);
		expect(markdownMocks.preventDefault).not.toHaveBeenCalled();
	});

	it("infers every supported code language and falls back for unknown paths", () => {
		const cases = [
			["file.js", "javascript"],
			["file.jsx", "jsx"],
			["file.ts", "typescript"],
			["file.tsx", "tsx"],
			["file.json", "json"],
			["file.css", "css"],
			["file.html", "html"],
			["file.yml", "yaml"],
			["file.yaml", "yaml"],
			["file.sh", "bash"],
			["file.sql", "sql"],
			["file.unknown", "text"],
			["", "text"],
		] as const;

		for (const [path, language] of cases) {
			const markup = renderToStaticMarkup(
				<FileViewer file={file(path, { content: "" })} />,
			);
			expect(markup).toContain(`data-language="${language}"`);
			expect(markup).toContain('data-code="artifact.noContent"');
			expect(markup).not.toContain("artifact.truncated");
		}
	});

	it("renders changed-file summaries, diff content, and both callback states", () => {
		const diff = [
			"diff --git a/src/App.tsx b/src/App.tsx",
			"--- a/src/App.tsx",
			"+++ b/src/App.tsx",
			"@@ -1 +1 @@",
			"-old",
			"+new",
		].join("\n");
		const onOpenProjectFile = vi.fn();
		const enabledTree = DiffViewer({ diff, onOpenProjectFile });
		const enabledButtons = collectHostElements(enabledTree).filter(
			(element) => element.type === "button",
		);
		for (const button of enabledButtons) {
			(button.props.onClick as () => void)();
		}
		const markup = renderToStaticMarkup(enabledTree);

		expect(markup).toContain("artifact.changedFiles");
		expect(markup).toContain('data-project-file-link="src/App.tsx"');
		expect(markup).toContain("+1");
		expect(markup).toContain("-1");
		expect(markup).toContain("nightworkers-artifact-diff-block");
		expect(onOpenProjectFile).toHaveBeenCalledWith("src/App.tsx");

		const disabledTree = DiffViewer({ diff });
		const disabledButton = collectHostElements(disabledTree).find(
			(element) => element.type === "button",
		);
		if (!disabledButton)
			throw new Error("Expected a disabled changed-file button");
		expect(disabledButton.props.disabled).toBe(true);
		(disabledButton.props.onClick as () => void)();

		const emptyMarkup = renderToStaticMarkup(<DiffViewer diff="" />);
		expect(emptyMarkup).toContain("artifact.noChangedFiles");
		expect(emptyMarkup).toContain("artifact.noDiff");
	});

	it("renders collapsed, loading, empty, nested, and selected project-tree nodes", () => {
		const entries: ProjectFileEntry[] = [
			{ name: "loading", path: "loading", type: "directory" },
			{ name: "empty", path: "empty", type: "directory" },
			{ name: "filled", path: "filled", type: "directory" },
			{ name: "collapsed", path: "collapsed", type: "directory" },
			{ name: "root.ts", path: "root.ts", type: "file", size: 12 },
		];
		const onToggleDirectory = vi.fn(async () => undefined);
		const onOpenFile = vi.fn();
		const tree = ProjectTree({
			entries,
			entriesByDirectory: {
				filled: [
					{ name: "child.ts", path: "filled/child.ts", type: "file" },
					{ name: "nested", path: "filled/nested", type: "directory" },
				],
			},
			expandedDirectories: { loading: true, empty: true, filled: true },
			loadingDirectories: { loading: true },
			selectedFilePath: "root.ts",
			onToggleDirectory,
			onOpenFile,
		});
		const hosts = collectHostElements(tree);
		const buttons = hosts.filter((element) => element.type === "button");
		for (const button of buttons) {
			(button.props.onClick as () => void)();
		}
		const markup = renderToStaticMarkup(tree);

		expect(markup).toContain("artifact.loading");
		expect(markup).toContain("artifact.empty");
		expect(markup).toContain("rotate-90");
		expect(markup).toContain("bg-slate-800 text-slate-100");
		expect(markup).toContain("padding-left:22px");
		expect(onToggleDirectory).toHaveBeenCalledWith("loading");
		expect(onToggleDirectory).toHaveBeenCalledWith("filled/nested");
		expect(onOpenFile).toHaveBeenCalledWith("root.ts");
		expect(onOpenFile).toHaveBeenCalledWith("filled/child.ts");
	});
});
