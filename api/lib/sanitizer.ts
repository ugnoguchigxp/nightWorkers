import { sanitizePlainText } from "../../shared/sanitize-plain-text";

export function sanitize(input: string): string {
	return sanitizePlainText(input);
}
