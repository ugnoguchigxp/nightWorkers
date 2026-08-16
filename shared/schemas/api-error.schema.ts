import { z } from "@hono/zod-openapi";

export const apiErrorDetailsSchema = z.unknown();

export const apiErrorSchema = z
	.object({
		code: z.string().trim().min(1),
		message: z.string(),
		details: apiErrorDetailsSchema.optional(),
	})
	.openapi("ApiError");

export const apiErrorEnvelopeSchema = z
	.object({ error: apiErrorSchema })
	.openapi("ApiErrorEnvelope");

export type ApiError = z.infer<typeof apiErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;

export function apiErrorOpenApiResponse(description: string) {
	return {
		content: {
			"application/json": { schema: apiErrorEnvelopeSchema },
		},
		description,
	};
}
