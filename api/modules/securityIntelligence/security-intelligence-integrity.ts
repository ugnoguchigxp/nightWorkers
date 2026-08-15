import { AppError } from "../../lib/errors";

export class SecurityIntelligenceIntegrityError extends AppError {
	constructor(
		public readonly reasonCode: string,
		public readonly currentRef?: string,
	) {
		super(
			409,
			"SECURITY_INTELLIGENCE_INTEGRITY_CONFLICT",
			`security_intelligence:${reasonCode}`,
			{ reasonCode, currentRef },
		);
	}
}
