import { collectApplicationSettingSecretValues } from "../settings/application-settings-store";
import { isSecretRecordKey, redactSecretText } from "./secret-redaction";

export type PersistenceFirewallResult<T> =
	| { ok: true; value: T; redactionCount: number }
	| {
			ok: false;
			code: "SECRET_PERSISTENCE_REJECTED";
			paths: string[];
	  };

export function applySecretPersistenceFirewall<T>(
	value: T,
): PersistenceFirewallResult<T> {
	const secretValues = collectApplicationSettingSecretValues();
	let redactionCount = 0;
	const visit = (current: unknown, path: string): unknown => {
		if (typeof current === "string") {
			const redacted = redactSecretText(current, { secretValues });
			if (redacted !== current) redactionCount += 1;
			return redacted;
		}
		if (!current || typeof current !== "object") return current;
		if (current instanceof Date) return current;
		if (Array.isArray(current)) {
			return current.map((entry, index) => visit(entry, `${path}[${index}]`));
		}
		return Object.fromEntries(
			Object.entries(current).map(([key, entry]) => {
				if (isSecretRecordKey(key)) {
					if (entry !== null && entry !== undefined) redactionCount += 1;
					return [key, "[REDACTED]"];
				}
				return [key, visit(entry, path ? `${path}.${key}` : key)];
			}),
		);
	};
	return {
		ok: true,
		value: visit(value, "") as T,
		redactionCount,
	};
}

export function sanitizePersistenceValue<T>(value: T): T {
	const result = applySecretPersistenceFirewall(value);
	if (result.ok) return result.value;
	throw new Error(result.code);
}
