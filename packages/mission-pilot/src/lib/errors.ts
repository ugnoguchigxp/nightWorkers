export class AppError extends Error {
	constructor(
		public readonly statusCode: number,
		public readonly code: string,
		message: string,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
	}
}

export function isAppError(error: unknown): error is AppError {
	return (
		error instanceof Error &&
		typeof (error as Partial<AppError>).statusCode === "number" &&
		typeof (error as Partial<AppError>).code === "string"
	);
}
