import { z } from "zod";
import {
	type PlanApiContractArtifact,
	planApiContractArtifactSchema,
} from "../../../shared/schemas/plan-mode-artifact.schema";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import {
	collectLocalComponentReferences,
	validateJsonSchemaValue,
} from "./plan-api-contract-json-schema";

const httpMethods = [
	"get",
	"post",
	"put",
	"patch",
	"delete",
	"options",
	"head",
] as const;
const httpMethodSet = new Set<string>(httpMethods);
const parameterLocations = new Set(["query", "path", "header", "cookie"]);
const componentNameSchema = z
	.string()
	.regex(/^[A-Za-z0-9._-]+$/, "Invalid OpenAPI component name");
const securityRequirementSchema = z.record(z.string(), z.array(z.string()));
const planApiContractOpenApiOperationSchema = z
	.object({
		operationId: z.string().min(1),
		summary: z.string().min(1).optional(),
		description: z.string().min(1).optional(),
		tags: z.array(z.string()).optional(),
		requestBody: z.record(z.string(), z.unknown()).optional(),
		responses: z
			.record(z.string(), z.unknown())
			.refine((responses) => Object.keys(responses).length > 0, {
				message: "responses must not be empty",
			}),
	})
	.passthrough();
const planApiContractOpenApiPathItemSchema = z
	.record(z.string(), planApiContractOpenApiOperationSchema)
	.refine((pathItem) => Object.keys(pathItem).length > 0, {
		message: "path item must contain an operation",
	});

export const planApiContractOpenApiSchema = z.strictObject({
	openapi: z.literal("3.1.0"),
	info: z.strictObject({
		title: z.string().min(1),
		version: z.string().min(1),
		summary: z.string().min(1),
	}),
	paths: z
		.record(z.string(), planApiContractOpenApiPathItemSchema)
		.refine((paths) => Object.keys(paths).length > 0, {
			message: "paths must not be empty",
		}),
	components: z.strictObject({
		schemas: z.record(componentNameSchema, z.unknown()),
		securitySchemes: z.record(componentNameSchema, z.unknown()).optional(),
	}),
	security: z.array(securityRequirementSchema).optional(),
});

type PlanApiContractOpenApi = z.infer<typeof planApiContractOpenApiSchema>;

export function parsePlanApiContractOutput(
	rawOutput: string,
): PlanApiContractArtifact {
	const parsed = parseRepairedJsonWithSchema(
		rawOutput,
		planApiContractOpenApiSchema,
	);
	if (!parsed.ok) {
		throw new Error(
			"Plan API contract output did not contain a valid OpenAPI 3.1 document.",
		);
	}
	validateOpenApiDocument(parsed.value);
	return createPlanApiContractArtifact(parsed.value);
}

export function createPlanApiContractArtifact(
	openapi: PlanApiContractOpenApi,
): PlanApiContractArtifact {
	return planApiContractArtifactSchema.parse({
		artifactKind: "plan_mode_api_contract",
		view: "api_io_contract",
		title: openapi.info.title,
		summary: openapi.info.summary,
		openapi,
		stateTransitions: [],
		openQuestions: [],
	});
}

export function validateOpenApiDocument(openapi: PlanApiContractOpenApi) {
	const componentSchemas = openapi.components.schemas;
	const componentNames = new Set(Object.keys(componentSchemas));
	const securitySchemeNames = new Set(
		Object.keys(openapi.components.securitySchemes ?? {}),
	);
	const operationIds = new Set<string>();
	validateSecurityRequirements(
		openapi.security,
		securitySchemeNames,
		"OpenAPI document",
	);
	for (const [schemaName, schema] of Object.entries(componentSchemas)) {
		validateJsonSchemaValue(schema, `schema ${schemaName}`);
		assertKnownSchemaReferences(schema, componentNames, `Schema ${schemaName}`);
	}

	for (const [path, pathItem] of Object.entries(openapi.paths)) {
		validateOpenApiPath(path);
		for (const [method, operation] of Object.entries(pathItem)) {
			if (!httpMethodSet.has(method)) {
				throw new Error(`Unsupported OpenAPI operation method: ${method}`);
			}
			if (operationIds.has(operation.operationId)) {
				throw new Error(`Duplicate operationId: ${operation.operationId}`);
			}
			operationIds.add(operation.operationId);
			validateOperation(path, operation, componentNames, securitySchemeNames);
		}
	}
}

function validateOpenApiPath(path: string) {
	if (!/^\/[^?#]*$/.test(path)) {
		throw new Error(`Invalid OpenAPI path template: ${path}`);
	}
	const withoutTemplates = path.replace(/\{[^{}]+\}/g, "");
	if (withoutTemplates.includes("{") || withoutTemplates.includes("}")) {
		throw new Error(`Invalid OpenAPI path template syntax: ${path}`);
	}
}

function validateOperation(
	path: string,
	operation: z.infer<typeof planApiContractOpenApiOperationSchema>,
	componentNames: Set<string>,
	securitySchemeNames: Set<string>,
) {
	validateSecurityRequirements(
		operation.security,
		securitySchemeNames,
		`Operation ${operation.operationId}`,
	);
	const parameters = operationParameters(operation);
	assertUnique(
		parameters.map(
			(parameter) =>
				`${stringValue(parameter.in)}:${stringValue(parameter.name)}`,
		),
		`parameter for ${operation.operationId}`,
	);
	const pathParameterNames = parameters
		.filter((parameter) => parameter.in === "path")
		.map((parameter) => stringValue(parameter.name));
	assertUnique(
		pathParameterNames,
		`path parameter for ${operation.operationId}`,
	);
	const templateNames = [...path.matchAll(/\{([^{}]+)\}/g)].map(
		(match) => match[1],
	);
	assertUnique(templateNames, `path template parameter for ${path}`);
	for (const name of templateNames) {
		const parameter = parameters.find(
			(candidate) => candidate.in === "path" && candidate.name === name,
		);
		if (!parameter) {
			throw new Error(
				`Operation ${operation.operationId} is missing path parameter: ${name}`,
			);
		}
		if (parameter.required !== true) {
			throw new Error(
				`Operation ${operation.operationId} path parameter must be required: ${name}`,
			);
		}
	}
	for (const name of pathParameterNames) {
		if (!templateNames.includes(name)) {
			throw new Error(
				`Operation ${operation.operationId} declares unused path parameter: ${name}`,
			);
		}
	}
	for (const parameter of parameters) {
		const name = stringValue(parameter.name);
		const location = stringValue(parameter.in);
		if (!name || !parameterLocations.has(location)) {
			throw new Error(
				`Operation ${operation.operationId} contains an invalid parameter.`,
			);
		}
		const schema = parameter.schema;
		if (schema === undefined) {
			throw new Error(
				`Parameter ${operation.operationId}.${name} requires a schema.`,
			);
		}
		validateJsonSchemaValue(
			schema,
			`parameter ${operation.operationId}.${name}`,
		);
		assertKnownSchemaReferences(
			schema,
			componentNames,
			`Parameter ${operation.operationId}.${name}`,
		);
	}

	if (operation.requestBody !== undefined && operation.requestBody !== null) {
		if (
			!isRecord(operation.requestBody) ||
			(operation.requestBody.required !== undefined &&
				typeof operation.requestBody.required !== "boolean")
		) {
			throw new Error(
				`Operation ${operation.operationId} contains an invalid request body.`,
			);
		}
		const schema = requiredJsonContentSchema(
			operation.requestBody,
			`Request body ${operation.operationId}`,
		);
		validateJsonSchemaValue(schema, `request body ${operation.operationId}`);
		assertKnownSchemaReferences(
			schema,
			componentNames,
			`Request body ${operation.operationId}`,
		);
	}
	for (const [status, response] of Object.entries(operation.responses)) {
		if (!/^(?:default|[1-5](?:\d{2}|XX))$/.test(status)) {
			throw new Error(
				`Operation ${operation.operationId} has invalid response status: ${status}`,
			);
		}
		if (
			!isRecord(response) ||
			typeof response.description !== "string" ||
			response.description.trim().length === 0
		) {
			throw new Error(
				`Operation ${operation.operationId} response ${status} requires a description.`,
			);
		}
		for (const schema of responseContentSchemas(
			response,
			`Response ${operation.operationId}.${status}`,
		)) {
			validateJsonSchemaValue(
				schema,
				`response ${operation.operationId}.${status}`,
			);
			assertKnownSchemaReferences(
				schema,
				componentNames,
				`Response ${operation.operationId}.${status}`,
			);
		}
	}
}

function validateSecurityRequirements(
	value: unknown,
	securitySchemeNames: Set<string>,
	label: string,
) {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		throw new Error(`${label} security must be an array.`);
	}
	for (const requirement of value) {
		if (!isRecord(requirement)) {
			throw new Error(`${label} contains an invalid security requirement.`);
		}
		for (const [schemeName, scopes] of Object.entries(requirement)) {
			if (!securitySchemeNames.has(schemeName)) {
				throw new Error(
					`${label} references unknown security scheme: ${schemeName}`,
				);
			}
			if (
				!Array.isArray(scopes) ||
				scopes.some((scope) => typeof scope !== "string")
			) {
				throw new Error(
					`${label} security scopes for ${schemeName} must be strings.`,
				);
			}
		}
	}
}

function requiredJsonContentSchema(
	value: Record<string, unknown>,
	label: string,
) {
	const content = value.content;
	if (!isRecord(content)) {
		throw new Error(`${label} requires content.application/json.schema.`);
	}
	const jsonMediaType = content["application/json"];
	if (!isRecord(jsonMediaType) || jsonMediaType.schema === undefined) {
		throw new Error(`${label} requires content.application/json.schema.`);
	}
	return jsonMediaType.schema;
}

function responseContentSchemas(
	value: Record<string, unknown>,
	label: string,
): unknown[] {
	if (value.content === undefined) return [];
	return [requiredJsonContentSchema(value, label)];
}

function assertKnownSchemaReferences(
	value: unknown,
	componentNames: Set<string>,
	label: string,
) {
	for (const referencedName of collectLocalComponentReferences(value)) {
		if (!componentNames.has(referencedName)) {
			throw new Error(`${label} references unknown schema: ${referencedName}`);
		}
	}
}

function assertUnique(values: string[], label: string) {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
		seen.add(value);
	}
}

function operationParameters(
	operation: z.infer<typeof planApiContractOpenApiOperationSchema>,
): Record<string, unknown>[] {
	if (operation.parameters === undefined) return [];
	if (
		!Array.isArray(operation.parameters) ||
		operation.parameters.some((parameter) => !isRecord(parameter))
	) {
		throw new Error(
			`Operation ${operation.operationId} contains invalid parameters.`,
		);
	}
	return operation.parameters;
}

function stringValue(value: unknown) {
	return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
