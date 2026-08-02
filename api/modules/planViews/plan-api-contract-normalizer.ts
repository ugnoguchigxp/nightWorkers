import { z } from "zod";
import type { PlanApiContractArtifact } from "../../../shared/schemas/plan-mode-artifact.schema";
import { planApiContractArtifactSchema } from "../../../shared/schemas/plan-mode-artifact.schema";
import { parseRepairedJsonWithSchema } from "../../services/structured-llm/json";
import {
	collectLocalComponentReferences,
	inferJsonSchemaStrictness,
	parseJsonSchemaObject,
} from "./plan-api-contract-json-schema";

export { parseJsonSchemaObject } from "./plan-api-contract-json-schema";

const httpMethodSchema = z.enum([
	"get",
	"post",
	"put",
	"patch",
	"delete",
	"options",
	"head",
]);
const httpParameterLocationSchema = z.enum([
	"query",
	"path",
	"header",
	"cookie",
]);
const componentNameSchema = z
	.string()
	.regex(/^[A-Za-z0-9._-]+$/, "Invalid OpenAPI component name");
const optionalComponentNameSchema = z.union([
	z.literal(""),
	componentNameSchema,
]);

export const planApiContractDraftSchema = z.strictObject({
	title: z.string().min(1),
	summary: z.string().min(1),
	operations: z
		.array(
			z.strictObject({
				path: z
					.string()
					.min(1)
					.regex(/^\/[^?#]*$/, "Invalid OpenAPI path template"),
				method: httpMethodSchema,
				operationId: z.string().min(1),
				summary: z.string(),
				description: z.string(),
				tags: z.array(z.string()),
				parameters: z.array(
					z.strictObject({
						name: z.string().min(1),
						in: httpParameterLocationSchema,
						required: z.boolean(),
						description: z.string(),
						schemaJson: z.string().min(2),
					}),
				),
				requestBody: z.strictObject({
					description: z.string(),
					schemaName: optionalComponentNameSchema,
					required: z.boolean(),
				}),
				responses: z
					.array(
						z.strictObject({
							status: z.number().int().min(100).max(599),
							description: z.string(),
							schemaName: optionalComponentNameSchema,
						}),
					)
					.min(1),
			}),
		)
		.min(1),
	schemas: z.array(
		z.strictObject({
			name: componentNameSchema,
			schemaJson: z.string().min(2),
		}),
	),
	stateTransitions: z.array(
		z.strictObject({
			operationId: z.string().min(1),
			fromState: z.string(),
			toState: z.string(),
			successStatus: z.number().int().min(100).max(599),
			conflictStatuses: z.array(z.number().int().min(100).max(599)),
			stateField: z.string(),
			notes: z.array(z.string()),
		}),
	),
	validation: z.array(
		z.strictObject({
			schemaName: componentNameSchema,
			owner: z.enum(["request", "response", "error", "shared"]),
			examples: z.array(
				z.strictObject({
					name: z.string().min(1),
					valid: z.boolean(),
					payloadJson: z.string(),
					expectedIssues: z.array(z.string()),
				}),
			),
		}),
	),
	openQuestions: z.array(z.string()),
});

export function parsePlanApiContractOutput(
	rawOutput: string,
): PlanApiContractArtifact {
	const artifact = parseRepairedJsonWithSchema(
		rawOutput,
		planApiContractArtifactSchema,
	);
	if (artifact.ok) {
		validateApiContractOperationReferences(artifact.value);
		return artifact.value;
	}

	const draft = parseRepairedJsonWithSchema(
		rawOutput,
		planApiContractDraftSchema,
	);
	if (!draft.ok)
		throw new Error("Plan API contract output did not contain valid JSON.");
	const normalized = normalizePlanApiContractDraft(draft.value);
	validateApiContractOperationReferences(normalized);
	return normalized;
}

export function validateApiContractOperationReferences(
	artifact: PlanApiContractArtifact,
) {
	const operationIds = new Set(
		Object.values(artifact.openapi.paths).flatMap((methods) =>
			Object.values(methods).map((operation) => operation.operationId),
		),
	);
	for (const transition of artifact.stateTransitions) {
		if (!operationIds.has(transition.operationId)) {
			throw new Error(
				`State transition references unknown operationId: ${transition.operationId}`,
			);
		}
	}
}

export function normalizePlanApiContractDraft(
	draft: z.infer<typeof planApiContractDraftSchema>,
): PlanApiContractArtifact {
	validateUniqueDraftEntries(draft);
	const components = Object.fromEntries(
		draft.schemas.map((schema) => [
			schema.name,
			parseJsonSchemaObject(schema.schemaJson, `schema ${schema.name}`),
		]),
	);
	validateDraftSchemaReferences(draft, components);
	const paths: PlanApiContractArtifact["openapi"]["paths"] = {};
	for (const operationDraft of draft.operations) {
		const pathOperations = paths[operationDraft.path] ?? {};
		paths[operationDraft.path] = pathOperations;
		const requestSchemaName = operationDraft.requestBody.schemaName.trim();
		const operation: PlanApiContractArtifact["openapi"]["paths"][string][string] =
			{
				operationId: operationDraft.operationId,
				summary: blankToNull(operationDraft.summary),
				description: blankToNull(operationDraft.description),
				tags: operationDraft.tags,
				responses: Object.fromEntries(
					operationDraft.responses.map((response) => [
						String(response.status),
						{
							description: response.description,
							...contentForSchemaName(response.schemaName),
						},
					]),
				),
			};
		if (operationDraft.parameters.length > 0) {
			operation.parameters = operationDraft.parameters.map((parameter) => ({
				name: parameter.name,
				in: parameter.in,
				required: parameter.required,
				description: blankToUndefined(parameter.description),
				schema: parseJsonSchemaObject(
					parameter.schemaJson,
					`parameter ${operationDraft.operationId}.${parameter.name}`,
				),
			}));
		}
		if (requestSchemaName) {
			operation.requestBody = {
				required: operationDraft.requestBody.required,
				description: blankToUndefined(operationDraft.requestBody.description),
				...contentForSchemaName(requestSchemaName),
			};
		}
		pathOperations[operationDraft.method] = operation;
	}
	return planApiContractArtifactSchema.parse({
		artifactKind: "plan_mode_api_contract",
		view: "api_io_contract",
		title: draft.title,
		summary: draft.summary,
		openapi: {
			openapi: "3.1.0",
			info: { title: draft.title, version: "0.1.0" },
			paths,
			components: { schemas: components },
		},
		stateTransitions: draft.stateTransitions.map((transition) => ({
			operationId: transition.operationId,
			fromState: blankToNull(transition.fromState),
			toState: blankToNull(transition.toState),
			successStatus: transition.successStatus,
			conflictStatuses: transition.conflictStatuses,
			stateField: blankToNull(transition.stateField),
			notes: transition.notes,
		})),
		validation: draft.validation.map((entry) => ({
			schemaName: entry.schemaName,
			owner: entry.owner,
			zodOwnerFile: null,
			strictness: inferJsonSchemaStrictness(components[entry.schemaName]),
			examples: entry.examples.map((example) => ({
				name: example.name,
				valid: example.valid,
				payload: parsePayloadJson(
					example.payloadJson,
					`validation ${entry.schemaName}.${example.name}`,
				),
				expectedIssues: example.expectedIssues,
			})),
		})),
		openQuestions: draft.openQuestions,
	});
}

export function contentForSchemaName(schemaName: string) {
	const normalized = schemaName.trim();
	if (!normalized) return {};
	return {
		content: {
			"application/json": {
				schema: { $ref: `#/components/schemas/${normalized}` },
			},
		},
	};
}

function validateUniqueDraftEntries(
	draft: z.infer<typeof planApiContractDraftSchema>,
) {
	assertUnique(
		draft.schemas.map((schema) => schema.name),
		"schema name",
	);
	assertUnique(
		draft.operations.map(
			(operation) => `${operation.method.toUpperCase()} ${operation.path}`,
		),
		"operation route",
	);
	assertUnique(
		draft.operations.map((operation) => operation.operationId),
		"operationId",
	);
	assertUnique(
		draft.validation.map((entry) => `${entry.owner}:${entry.schemaName}`),
		"validation owner/schema",
	);
	for (const operation of draft.operations) {
		assertUnique(
			operation.responses.map((response) => String(response.status)),
			`response status for ${operation.operationId}`,
		);
		assertUnique(
			operation.parameters.map(
				(parameter) => `${parameter.in}:${parameter.name}`,
			),
			`parameter for ${operation.operationId}`,
		);
		validatePathParameters(operation);
	}
	for (const transition of draft.stateTransitions) {
		assertUnique(
			transition.conflictStatuses.map(String),
			`conflict status for ${transition.operationId}`,
		);
	}
	for (const validation of draft.validation) {
		assertUnique(
			validation.examples.map((example) => example.name),
			`validation example for ${validation.schemaName}`,
		);
	}
}

function assertUnique(values: string[], label: string) {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
		seen.add(value);
	}
}

function validateDraftSchemaReferences(
	draft: z.infer<typeof planApiContractDraftSchema>,
	components: Record<string, unknown>,
) {
	const schemaNames = new Set(Object.keys(components));
	const operationById = new Map(
		draft.operations.map((operation) => [operation.operationId, operation]),
	);
	for (const operation of draft.operations) {
		if (!operation.requestBody.schemaName && operation.requestBody.required) {
			throw new Error(
				`Operation ${operation.operationId} requires a request body without a schema.`,
			);
		}
		if (
			!operation.requestBody.schemaName &&
			operation.requestBody.description.trim()
		) {
			throw new Error(
				`Operation ${operation.operationId} describes a request body without a schema.`,
			);
		}
		const referencedNames = [
			operation.requestBody.schemaName,
			...operation.responses.map((response) => response.schemaName),
		]
			.map((name) => name.trim())
			.filter(Boolean);
		for (const schemaName of referencedNames) {
			if (!schemaNames.has(schemaName)) {
				throw new Error(
					`Operation ${operation.operationId} references unknown schema: ${schemaName}`,
				);
			}
		}
		for (const parameter of operation.parameters) {
			const parameterSchema = parseJsonSchemaObject(
				parameter.schemaJson,
				`parameter ${operation.operationId}.${parameter.name}`,
			);
			for (const referencedName of collectLocalComponentReferences(
				parameterSchema,
			)) {
				if (!schemaNames.has(referencedName)) {
					throw new Error(
						`Parameter ${operation.operationId}.${parameter.name} references unknown schema: ${referencedName}`,
					);
				}
			}
		}
	}
	for (const validation of draft.validation) {
		if (!schemaNames.has(validation.schemaName)) {
			throw new Error(
				`Validation references unknown schema: ${validation.schemaName}`,
			);
		}
	}
	for (const transition of draft.stateTransitions) {
		const operation = operationById.get(transition.operationId);
		if (!operation) {
			throw new Error(
				`State transition references unknown operationId: ${transition.operationId}`,
			);
		}
		const responseStatuses = new Set(
			operation.responses.map((response) => response.status),
		);
		if (!responseStatuses.has(transition.successStatus)) {
			throw new Error(
				`State transition ${transition.operationId} references missing success status: ${transition.successStatus}`,
			);
		}
		if (transition.conflictStatuses.includes(transition.successStatus)) {
			throw new Error(
				`State transition ${transition.operationId} uses success status as a conflict status: ${transition.successStatus}`,
			);
		}
		for (const status of transition.conflictStatuses) {
			if (!responseStatuses.has(status)) {
				throw new Error(
					`State transition ${transition.operationId} references missing conflict status: ${status}`,
				);
			}
		}
	}
	for (const [schemaName, schema] of Object.entries(components)) {
		for (const referencedName of collectLocalComponentReferences(schema)) {
			if (!schemaNames.has(referencedName)) {
				throw new Error(
					`Schema ${schemaName} references unknown schema: ${referencedName}`,
				);
			}
		}
	}
}

function validatePathParameters(
	operation: z.infer<typeof planApiContractDraftSchema>["operations"][number],
) {
	if (operation.path.includes("?") || operation.path.includes("#")) {
		throw new Error(
			`Operation ${operation.operationId} path must not contain a query or fragment.`,
		);
	}
	const templateParameters = [...operation.path.matchAll(/\{([^{}]+)\}/g)].map(
		(match) => match[1],
	);
	const unmatchedTemplateSyntax = operation.path.replace(/\{[^{}]+\}/g, "");
	if (
		unmatchedTemplateSyntax.includes("{") ||
		unmatchedTemplateSyntax.includes("}")
	) {
		throw new Error(
			`Operation ${operation.operationId} path contains invalid template syntax.`,
		);
	}
	const declaredParameters = operation.parameters
		.filter((parameter) => parameter.in === "path")
		.map((parameter) => parameter.name);
	assertUnique(
		templateParameters,
		`path template parameter for ${operation.path}`,
	);
	for (const parameterName of templateParameters) {
		if (!declaredParameters.includes(parameterName)) {
			throw new Error(
				`Operation ${operation.operationId} is missing path parameter: ${parameterName}`,
			);
		}
	}
	for (const parameterName of declaredParameters) {
		if (!templateParameters.includes(parameterName)) {
			throw new Error(
				`Operation ${operation.operationId} declares unused path parameter: ${parameterName}`,
			);
		}
	}
	for (const parameter of operation.parameters) {
		if (parameter.in === "path" && !parameter.required) {
			throw new Error(
				`Operation ${operation.operationId} path parameter must be required: ${parameter.name}`,
			);
		}
	}
}

export function parsePayloadJson(
	payloadJson: string,
	label = "validation payload",
): unknown {
	try {
		return JSON.parse(payloadJson);
	} catch {
		throw new Error(`${label} did not contain valid payload JSON.`);
	}
}

export function blankToNull(value: string) {
	const normalized = value.trim();
	return normalized ? normalized : null;
}

export function blankToUndefined(value: string) {
	const normalized = value.trim();
	return normalized ? normalized : undefined;
}
