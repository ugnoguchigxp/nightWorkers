import {
	type ApiErrorEnvelope,
	apiErrorEnvelopeSchema,
} from "../../shared/schemas/api-error.schema";

const INVALID_API_ERROR_RESPONSE = "INVALID_API_ERROR_RESPONSE";
const INVALID_JSON_RESPONSE = "INVALID_JSON_RESPONSE";

type ResponseSchema<T> = {
	safeParse: (
		value: unknown,
	) => { success: true; data: T } | { success: false; error: unknown };
};

export class ApiResponseError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly details?: unknown,
		public readonly requestId?: string,
	) {
		super(message);
		this.name = "ApiResponseError";
	}
}

function responseRequestId(response: Response): string | undefined {
	return response.headers.get("X-Request-Id") ?? undefined;
}

function invalidResponseError(
	response: Response,
	code: string,
	message: string,
	details?: unknown,
) {
	return new ApiResponseError(
		response.status,
		code,
		message,
		details,
		responseRequestId(response),
	);
}

function parseJson(response: Response): Promise<unknown> {
	return response.json().catch(() => {
		throw invalidResponseError(
			response,
			INVALID_JSON_RESPONSE,
			"Response body is not valid JSON",
		);
	});
}

function toApiResponseError(
	response: Response,
	payload: unknown,
): ApiResponseError {
	const canonical = apiErrorEnvelopeSchema.safeParse(payload);
	if (canonical.success) return canonicalError(response, canonical.data);

	return invalidResponseError(
		response,
		INVALID_API_ERROR_RESPONSE,
		"Error response does not match the API error contract",
	);
}

function canonicalError(
	response: Response,
	payload: ApiErrorEnvelope,
): ApiResponseError {
	return new ApiResponseError(
		response.status,
		payload.error.code,
		payload.error.message,
		payload.error.details,
		responseRequestId(response),
	);
}

export async function readJsonResponse<T>(
	response: Response,
	schema?: ResponseSchema<T>,
): Promise<T> {
	const payload = await parseJson(response);
	if (!response.ok) throw toApiResponseError(response, payload);
	if (!schema) return payload as T;

	const parsed = schema.safeParse(payload);
	if (parsed.success) return parsed.data;
	throw invalidResponseError(
		response,
		INVALID_API_ERROR_RESPONSE,
		"Success response does not match the expected schema",
		parsed.error,
	);
}

export const apiResponseErrorCodes = {
	INVALID_API_ERROR_RESPONSE,
	INVALID_JSON_RESPONSE,
} as const;
