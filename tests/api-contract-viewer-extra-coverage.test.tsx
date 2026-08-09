import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApiContractViewer } from "../src/modules/planMode/workspace-panels/ApiContractViewer";

function render(
	apiContract: Record<string, unknown>,
	artifact: Record<string, unknown> | null = null,
) {
	return renderToStaticMarkup(
		<ApiContractViewer
			artifact={artifact as never}
			apiContract={apiContract}
		/>,
	);
}

describe("ApiContractViewer extra coverage", () => {
	it("renders default, artifact, and explicit titles with empty or invalid paths", () => {
		const empty = render({});
		expect(empty).toContain("API Contract");
		expect(empty).toContain("api_io_contract");
		expect(empty).toContain("OpenAPI paths are empty.");
		expect(empty).toContain("Raw OpenAPI JSON");
		expect(empty).toContain("null");

		const artifactTitle = render(
			{ summary: "Artifact summary", openapi: { paths: null } },
			{
				title: "Artifact API",
				kind: "api_io_contract",
				sourceMessageId: "1234567890abcdef",
			},
		);
		expect(artifactTitle).toContain("Artifact API");
		expect(artifactTitle).toContain("Artifact summary");
		expect(artifactTitle).toContain("message 12345678");

		const explicit = render({
			title: "Explicit API",
			openapi: {
				paths: {
					"/invalid": "not-an-object",
					"/filtered": {
						trace: { operationId: "unsupported" },
						get: "not-an-operation",
					},
				},
			},
		});
		expect(explicit).toContain("Explicit API");
		expect(explicit).toContain("OpenAPI paths are empty.");
	});

	it("sorts all supported methods and renders operation metadata fallbacks", () => {
		const paths: Record<string, unknown> = {
			"/items": {
				HEAD: { responses: {} },
				options: { operationId: "options-items", responses: {} },
				DELETE: { operationId: "delete-items", responses: {} },
				patch: { operationId: "patch-items", responses: {} },
				put: { operationId: "put-items", responses: {} },
				post: { operationId: "post-items", responses: {} },
				GET: {
					operationId: "get-items",
					summary: "List items",
					description: "Returns all items",
					responses: { 200: { description: "OK" } },
				},
			},
		};
		const markup = render({ openapi: { paths } });
		const positions = [
			"GET",
			"POST",
			"PUT",
			"PATCH",
			"DELETE",
			"OPTIONS",
			"HEAD",
		].map((method) => markup.indexOf(`>${method}<`));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect(positions).toEqual([...positions].sort((a, b) => a - b));
		expect(markup).toContain("get-items");
		expect(markup).toContain("List items");
		expect(markup).toContain("Returns all items");
		expect(markup).toContain("HEAD-/items");
		expect(markup).toContain("OK");
	});

	it("renders parameters, request schema fields, responses, and state transitions", () => {
		const markup = render({
			title: "Orders API",
			stateTransitions: [
				{
					operationId: "create-order",
					fromState: "draft",
					toState: "submitted",
					successStatus: 201,
					conflictStatuses: [409, "not-a-number", 422],
					stateField: "status",
				},
				{
					operationId: "create-order",
					fromState: "",
					toState: null,
					successStatus: null,
					conflictStatuses: [],
				},
				{ operationId: "other", fromState: "ignored", toState: "ignored" },
				"invalid transition",
			],
			openapi: {
				components: {
					schemas: {
						CreateOrder: {
							required: ["name", "tags", 1],
							properties: {
								name: { type: "string", description: "Order name" },
								tags: {
									type: "array",
									items: { type: "string" },
								},
								children: { type: "array" },
								owner: { $ref: "#/components/schemas/User" },
								ignored: "not-a-schema",
							},
						},
					},
				},
				paths: {
					"/orders/{id}": {
						post: {
							operationId: "create-order",
							parameters: [
								{
									in: "path",
									name: "id",
									description: "Order id",
									required: true,
									schema: { type: "integer" },
								},
								{ in: "query", name: "filter", schema: { type: "array" } },
								{ schema: { $ref: "#/components/schemas/User" } },
								"invalid parameter",
							],
							requestBody: {
								required: true,
								description: "Order payload",
								content: {
									"application/json": {
										schema: {
											$ref: "#/components/schemas/CreateOrder",
										},
									},
								},
							},
							responses: {
								201: { description: "Created" },
								400: {},
								500: "invalid response",
							},
						},
					},
				},
			},
		});

		expect(markup).toContain("Parameters");
		expect(markup).toContain("path");
		expect(markup).toContain("id");
		expect(markup).toContain("integer required");
		expect(markup).toContain("param");
		expect(markup).toContain("name");
		expect(markup).toContain("unknown");
		expect(markup).toContain("Request body");
		expect(markup).toContain("CreateOrder");
		expect(markup).toContain("Order payload");
		expect(markup).toContain("string required");
		expect(markup).toContain("array&lt;string&gt; required");
		expect(markup).toContain("array</div>");
		expect(markup).toContain("User");
		expect(markup).toContain("Created");
		expect(markup).toContain("Response");
		expect(markup).toContain("State transitions");
		expect(markup).toContain("draft -&gt; submitted");
		expect(markup).toContain("conflicts 409, 422");
		expect(markup).toContain("; status");
		expect(markup).toContain("unknown -&gt; unknown");
		expect(markup).not.toContain("ignored -&gt; ignored");
	});

	it("handles request schemas without usable refs, fields, parameters, or responses", () => {
		const markup = render({
			openapi: {
				components: { schemas: { Empty: { properties: null } } },
				paths: {
					"/empty": {
						get: {
							parameters: null,
							requestBody: {
								required: false,
								description: "",
								content: {
									"application/json": { schema: { $ref: "external-ref" } },
								},
							},
							responses: null,
						},
						post: {
							requestBody: { content: null },
							responses: { default: { description: "" } },
						},
					},
				},
			},
		});
		expect(markup).toContain("GET");
		expect(markup).toContain("POST");
		expect(markup).toContain("Request body");
		expect(markup).not.toContain("Parameters");
		expect(markup).not.toContain(">required<");
		expect(markup).toContain("Response");
	});
});
