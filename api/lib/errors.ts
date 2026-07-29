export class AppError extends Error {
	constructor(
		public statusCode: number,
		public code: string,
		message: string,
		public details?: Record<string, unknown>,
	) {
		super(message);
		this.name = this.constructor.name;
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}

export class ValidationError extends AppError {
	constructor(message: string, details?: Record<string, unknown>) {
		super(400, "VALIDATION_ERROR", message, details);
	}
}

export class ForbiddenError extends AppError {
	constructor(message = "Forbidden") {
		super(403, "FORBIDDEN", message);
	}
}

export class NotFoundError extends AppError {
	constructor(message = "Resource not found") {
		super(404, "NOT_FOUND", message);
	}
}
