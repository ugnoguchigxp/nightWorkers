import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
	stateValue: "idle" as "idle" | "ai-copied" | "full-copied" | "failed",
	setters: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useMemo: <T,>(factory: () => T) => factory(),
		useState: <T,>(_initial: T) => {
			const setter = vi.fn();
			controls.setters.push(setter);
			return [controls.stateValue as T, setter] as const;
		},
	};
});

vi.mock("lucide-react", () => ({
	AlertTriangle: () => <mock-alert />,
	Clipboard: () => <mock-clipboard />,
	FileStack: () => <mock-file-stack />,
	RefreshCcw: () => <mock-refresh />,
}));

import { DevErrorPanel } from "../src/components/DevErrorPanel";

function errorProps(error: unknown, componentStack?: string, reset = vi.fn()) {
	return {
		error,
		info: componentStack === undefined ? undefined : { componentStack },
		reset,
	} as never;
}

function panelElement(
	error: unknown,
	componentStack?: string,
	reset = vi.fn(),
) {
	controls.setters = [];
	return DevErrorPanel(
		errorProps(error, componentStack, reset),
	) as ReactElement;
}

function renderPanel(error: unknown, componentStack?: string) {
	return renderToStaticMarkup(panelElement(error, componentStack));
}

function findButton(element: ReactElement, label: string) {
	const found = findElement(
		element,
		(node) => node.props?.["aria-label"] === label,
	);
	if (!found) throw new Error(`button not found: ${label}`);
	return found;
}

function setBrowserLocation(pathname: string) {
	vi.stubGlobal("window", {
		location: {
			href: `http://nightworkers.local${pathname}`,
			pathname,
			origin: "http://nightworkers.local",
		},
		setTimeout: vi.fn((callback: () => void) => {
			callback();
			return 1;
		}),
	});
}

async function settleCopy() {
	for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

beforeEach(() => {
	controls.stateValue = "idle";
	controls.setters = [];
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("DevErrorPanel extra coverage", () => {
	it("renders Error fallbacks, normalized app frames, unique limits, and component stack", () => {
		setBrowserLocation("/tasks/task-1");
		const error = new Error("Broken render");
		error.name = "RenderFailure";
		error.stack = [
			"RenderFailure: Broken render",
			"    at App (http://nightworkers.local/src/App.tsx?cache=1:10:2)",
			"    at App (http://nightworkers.local/src/App.tsx?cache=1:10:2)",
			"    at Api (/api/router.ts:2:1)",
			"    at Shared (/shared/value.ts:3:1)",
			"    at More (/src/more.ts:4:1)",
			"    at Last (/src/last.ts:5:1)",
			"    at Omitted (/src/omitted.ts:6:1)",
		].join("\n");
		const markup = renderPanel(
			error,
			"\n at First\n at Second\n at Third\n at Fourth\n at Fifth\n at Sixth\n at Seventh ",
		);

		expect(markup).toContain("Broken render");
		expect(markup).toContain("RenderFailure");
		expect(markup).toContain("Suspect app frames");
		expect(markup).toContain("App (/src/App.tsx:10:2)");
		expect(markup.match(/App \(\/src\/App.tsx:10:2\)/g)).toHaveLength(3);
		expect(markup).toContain("src/routes/tasks.$id.tsx");
		expect(markup).toContain("Full React component stack");
		expect(markup).toContain("at Sixth");
		expect(markup.match(/at Seventh/g)).toHaveLength(1);

		const empty = new Error("");
		empty.name = "";
		empty.stack = "";
		const fallbackMarkup = renderPanel(empty, "   ");
		expect(fallbackMarkup).toContain("Unknown error");
		expect(fallbackMarkup).toContain(">Error<");
		expect(fallbackMarkup).not.toContain("Full React component stack");
	});

	it("renders non-Error strings, objects, undefined, circular values, and top frame fallback", () => {
		setBrowserLocation("/repositories");
		let markup = renderPanel(
			"Thrown string\n at Vendor (vendor.js:1:1)\n at Vendor (vendor.js:1:1)\n at Next (next.js:2:2)",
		);
		expect(markup).toContain("Thrown value");
		expect(markup).toContain("Top stack frames");
		expect(markup).toContain("Vendor (vendor.js:1:1)");
		expect(markup).toContain("src/routes/repositories.tsx");

		markup = renderPanel({ code: 500, message: "object failure" });
		expect(markup).toContain("A non-Error value was thrown.");
		expect(markup).toContain("&quot;code&quot;: 500");

		markup = renderPanel(undefined);
		expect(markup).toContain("undefined");

		const circular: Record<string, unknown> = {};
		circular.self = circular;
		markup = renderPanel(circular);
		expect(markup).toContain("[object Object]");
	});

	it("infers every route hint and handles server-side unknown location", () => {
		const cases = [
			["/", "src/routes/index.tsx"],
			["/repositories/active", "src/routes/repositories.tsx"],
			["/tasks/task-1", "src/routes/tasks.$id.tsx"],
			["/showcase/ui", "src/routes/showcase.tsx"],
			["/blueprint-showcase/demo", "src/routes/blueprint-showcase.tsx"],
			["/unknown", "src/routes/__root.tsx"],
		] as const;
		for (const [pathname, hint] of cases) {
			setBrowserLocation(pathname);
			expect(renderPanel(new Error("route error"))).toContain(hint);
		}

		vi.unstubAllGlobals();
		const serverMarkup = renderPanel(new Error("server error"));
		expect(serverMarkup).toContain("<span>URL</span><strong>unknown</strong>");
		expect(serverMarkup).toContain("Route: unknown");
	});

	it("renders every copy status and invokes retry", () => {
		setBrowserLocation("/");
		for (const [status, text] of [
			["idle", "Copy AI context"],
			["ai-copied", "AI context copied"],
			["failed", "Copy failed"],
			["full-copied", "Full stack copied"],
		] as const) {
			controls.stateValue = status;
			const markup = renderPanel(new Error("status"));
			expect(markup).toContain(text);
		}

		controls.stateValue = "idle";
		const reset = vi.fn();
		const element = panelElement(new Error("retry"), undefined, reset);
		findButton(element, "Retry render").props.onClick();
		expect(reset).toHaveBeenCalledOnce();
	});

	it("copies AI and full details with the modern clipboard and resets success state", async () => {
		setBrowserLocation("/showcase");
		const writeText = vi.fn(async () => undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		const error = new Error("copy modern");
		error.stack = "Error: copy modern\n at Feature (/src/feature.ts:1:1)";
		const element = panelElement(error, " at FeatureComponent ");

		findButton(element, "Copy AI context").props.onClick();
		await settleCopy();
		expect(writeText).toHaveBeenCalledWith(
			expect.stringContaining("## Suspect app frames"),
		);
		expect(controls.setters[0]).toHaveBeenCalledWith("ai-copied");
		expect(controls.setters[0]).toHaveBeenCalledWith("idle");

		findButton(element, "Copy full error details").props.onClick();
		await settleCopy();
		expect(writeText).toHaveBeenCalledWith(
			expect.stringContaining("React component stack:"),
		);
		expect(controls.setters[0]).toHaveBeenCalledWith("full-copied");
	});

	it("reports modern and server clipboard failures and supports the legacy textarea path", async () => {
		setBrowserLocation("/");
		vi.stubGlobal("navigator", {
			clipboard: {
				writeText: vi.fn(async () => Promise.reject(new Error("denied"))),
			},
		});
		let element = panelElement(new Error("modern failure"));
		findButton(element, "Copy AI context").props.onClick();
		await settleCopy();
		expect(controls.setters[0]).toHaveBeenCalledWith("failed");

		vi.stubGlobal("navigator", {});
		vi.stubGlobal("document", undefined);
		element = panelElement(new Error("server clipboard"));
		findButton(element, "Copy AI context").props.onClick();
		await settleCopy();
		expect(controls.setters[0]).toHaveBeenCalledWith("failed");

		const textarea = {
			value: "",
			style: { position: "", left: "" },
			setAttribute: vi.fn(),
			select: vi.fn(),
		};
		const appendChild = vi.fn();
		const removeChild = vi.fn();
		const execCommand = vi.fn(() => true);
		vi.stubGlobal("document", {
			createElement: vi.fn(() => textarea),
			body: { appendChild, removeChild },
			execCommand,
		});
		element = panelElement(new Error("legacy copy"));
		findButton(element, "Copy full error details").props.onClick();
		await settleCopy();
		expect(textarea.value).toContain("legacy copy");
		expect(textarea.setAttribute).toHaveBeenCalledWith("readonly", "");
		expect(textarea).toMatchObject({
			style: { position: "fixed", left: "-9999px" },
		});
		expect(appendChild).toHaveBeenCalledWith(textarea);
		expect(textarea.select).toHaveBeenCalled();
		expect(execCommand).toHaveBeenCalledWith("copy");
		expect(removeChild).toHaveBeenCalledWith(textarea);
	});
});

type ElementLike = {
	props?: Record<string, unknown>;
};

function findElement(
	node: unknown,
	predicate: (node: ElementLike) => boolean,
): ElementLike | null {
	if (!node || typeof node !== "object") return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const result = findElement(child, predicate);
			if (result) return result;
		}
		return null;
	}
	const element = node as ElementLike;
	if (predicate(element)) return element;
	return findElement(element.props?.children, predicate);
}
