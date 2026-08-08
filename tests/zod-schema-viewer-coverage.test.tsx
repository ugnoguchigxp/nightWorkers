import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let setter: ReturnType<typeof vi.fn>;

async function loadViewer(valuesOverride?: Record<string, unknown>) {
	vi.resetModules();
	vi.doMock("react", async () => {
		const actual = await vi.importActual<typeof import("react")>("react");
		return {
			...actual,
			useState: <T,>(initial: T | (() => T)) => {
				const initialValue =
					typeof initial === "function" ? (initial as () => T)() : initial;
				const value = (valuesOverride ?? initialValue) as T;
				setter = vi.fn((next: T | ((current: T) => T)) =>
					typeof next === "function"
						? (next as (current: T) => T)(value)
						: next,
				);
				return [value, setter] as const;
			},
		};
	});
	return import("../src/modules/planMode/workspace-panels/ZodSchemaViewer");
}

function visit(node: ReactNode, callback: (element: ReactElement) => void) {
	if (Array.isArray(node)) {
		for (const child of node) visit(child, callback);
		return;
	}
	if (!node || typeof node !== "object" || !("props" in node)) return;
	const element = node as ReactElement<{ children?: ReactNode }>;
	callback(element);
	visit(element.props.children, callback);
}

const fields = [
	{
		name: "profile",
		type: "object",
		description: "Nested profile",
		children: [
			{
				name: "email",
				type: "string",
				required: true,
				description: "Email address",
				rules: [
					{ name: "email", args: [] },
					{ name: "min", args: [6] },
					{ name: "max", args: [30] },
				],
			},
			{
				name: "website",
				type: "string",
				rules: [{ name: "url", args: [] }],
			},
		],
	},
	{ name: "identifier", type: "string", rules: [{ name: "uuid", args: [] }] },
	{ name: "code", type: "string", rules: [{ name: "length", args: [3] }] },
	{
		name: "short",
		type: "string",
		rules: [
			{ name: "min", args: [20] },
			{ name: "max", args: [5] },
		],
	},
	{
		name: "count",
		type: "number",
		required: true,
		rules: [
			{ name: "positive", args: [] },
			{ name: "nonnegative", args: [] },
			{ name: "min", args: [2] },
			{ name: "max", args: [8] },
			{ name: "int", args: [] },
		],
	},
	{ name: "enabled", type: "boolean", defaultValue: true },
	{
		name: "mode",
		type: "enum",
		enumOptions: ["quick", "deep"],
		required: false,
	},
	{ name: "requiredMode", type: "enum", enumOptions: [], required: true },
	{
		name: "tags",
		type: "array",
		rules: [
			{ name: "min", args: [2] },
			{ name: "max", args: [3] },
			{ name: "length", args: [2] },
		],
	},
	{ name: "emptyObject", type: "object", children: [] },
	{
		name: "reference",
		type: "reference",
		referencedSchema: "UserSchema",
		rules: [],
	},
	{
		name: "referenceExpr",
		type: "reference",
		zodExpression: "OtherSchema",
		rules: [],
	},
	{ name: "unknown", type: "unknown", zodExpression: "z.custom()", rules: [] },
	{ name: "date", type: "date", zodExpression: "z.date()", rules: [] },
];

const artifact = {
	id: "artifact-1",
	taskId: "task-1",
	artifactType: "zod_schema_design",
	title: "Artifact title",
	content: "",
	sourceMessageId: "message-123456789",
	createdAt: "2026-01-01",
};

describe("Zod schema viewer coverage", () => {
	it("derives defaults and renders every supported field kind", async () => {
		const { ZodSchemaViewer } = await loadViewer();
		const element = ZodSchemaViewer({
			artifact: artifact as never,
			zodSchema: {
				title: "Interactive schema",
				summary: "Try realistic values",
				schemaName: "ProfileSchema",
				owner: "settings",
				fields,
				zodSource: "const ProfileSchema = z.object({});",
			},
		}) as ReactElement;
		const html = renderToStaticMarkup(element);
		expect(html).toContain("Interactive schema");
		expect(html).toContain("message message-");
		expect(html).toContain("sample@example.com");
		expect(html).toContain("https://example.com");
		expect(html).toContain("123e4567-e89b-42d3-a456-426614174000");
		expect(html).toContain("Referenced schema");
		expect(html).toContain("Unsupported expression");
		expect(html).toContain("Object schema without extracted child fields");
		expect(html).toContain("Input has validation issues");
		expect(html).toContain("enum(quick, deep)");
		expect(html).toContain("ref(UserSchema)");

		visit(element, (child) => {
			const props = child.props as Record<string, unknown>;
			if (
				typeof child.type === "function" &&
				child.type.name === "ZodFieldInput" &&
				typeof props.onChange === "function"
			) {
				(props.onChange as (path: string, value: unknown) => void)(
					"manual",
					"changed",
				);
			}
			if (typeof props.onChange !== "function") return;
			if (props.type === "radio") {
				(props.onChange as () => void)();
			} else {
				(props.onChange as (event: unknown) => void)({
					currentTarget: {
						checked: false,
						value: "changed",
						valueAsNumber: 4,
					},
				});
			}
		});
		expect(setter).toHaveBeenCalled();
		expect(
			setter.mock.results.some(
				(result) =>
					typeof result.value === "object" &&
					result.value !== null &&
					Object.values(result.value as object).includes("changed"),
			),
		).toBe(true);
	});

	it("renders all validation issue types for invalid values", async () => {
		const invalidValues = {
			profile: "",
			"profile.email": "x",
			"profile.website": "not a URL",
			identifier: "not-a-uuid",
			code: "too-long",
			short: "123456789",
			count: -1.5,
			enabled: false,
			mode: "unknown",
			requiredMode: "",
			tags: "not-json",
			emptyObject: "",
			reference: "",
			referenceExpr: "",
			unknown: "",
			date: "",
		};
		const { ZodSchemaViewer } = await loadViewer(invalidValues);
		const html = renderToStaticMarkup(
			ZodSchemaViewer({
				artifact: null,
				zodSchema: { fields, zodSource: "", title: "", schemaName: "" },
			}),
		);
		expect(html).toContain("Input has validation issues");
		for (const issue of [
			"email",
			"min length 6",
			"url",
			"uuid",
			"length 3",
			"max length 5",
			"min 2",
			"integer",
			"positive",
			"nonnegative",
			"must match enum option",
			"required",
			"must be a JSON array",
		]) {
			expect(html).toContain(issue);
		}
	});

	it("validates array bounds and non-number inputs", async () => {
		const { ZodSchemaViewer } = await loadViewer({
			count: "not-number",
			tags: '["one", "two", "three", "four"]',
		});
		let html = renderToStaticMarkup(
			ZodSchemaViewer({
				artifact: null,
				zodSchema: {
					fields: [fields[4], fields[8]],
				},
			}),
		);
		expect(html).toContain("must be a number");
		expect(html).toContain("max items 3");
		expect(html).toContain("items length 2");

		const next = await loadViewer({ count: 20, tags: [] });
		html = renderToStaticMarkup(
			next.ZodSchemaViewer({
				artifact: null,
				zodSchema: { fields: [fields[4], fields[8]] },
			}),
		);
		expect(html).toContain("max 8");
		expect(html).toContain("min items 2");
	});

	it("falls back to artifact/default labels with no extracted fields", async () => {
		const { ZodSchemaViewer } = await loadViewer({});
		const html = renderToStaticMarkup(
			ZodSchemaViewer({ artifact: artifact as never, zodSchema: {} }),
		);
		expect(html).toContain("Artifact title");
		expect(html).toContain("Schema");
		expect(html).toContain("No form-compatible fields were extracted");
	});
});
