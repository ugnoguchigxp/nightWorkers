const SECRET_KEY_PATTERN =
	/(authorization|cookie|token|secret|api[-_]?key|password|passwd|credential|_auth)/i;
const SECRET_RECORD_KEY_PATTERN =
	/^(?:.*(?:api[-_]?key|password|passwd|secret|credential)|authorization|cookie|(?:access|refresh|auth|bearer|id)[-_]?token|token|_auth)$/i;

const FALLBACK_PATTERNS: Array<[RegExp, string]> = [
	[
		/(\b(?:authorization|proxy-authorization|x-auth-token|x-npm-token)\s*[:=]\s*)(?:Bearer\s+|Basic\s+)?[^\s,;]+/gi,
		"$1[REDACTED]",
	],
	[/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]"],
	[/\b(Basic)\s+[A-Za-z0-9+/=]+/gi, "$1 [REDACTED]"],
	[/([?&](?:access_token|token|api_key|key)=)[^&\s]+/gi, "$1[REDACTED]"],
	[
		/((?:^|[\s"'`{,])(?:(?:\/\/)?[^\s=:#]+(?::\d+)?\/?:)?(?:_authToken|npmAuthToken|npmAuthIdent|_auth|password|passwd|token|api[-_]?key)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\r\n]+)/gim,
		"$1[REDACTED]",
	],
	[
		/(\b[A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD|PASSWD|CREDENTIAL|_AUTH)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\r\n]+)/gim,
		"$1[REDACTED]",
	],
	[/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, "$1[REDACTED]@"],
	[/\b(npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g, "[REDACTED]"],
];

const RUNTIME_SECRET_ENVIRONMENT_KEY_PATTERN =
	/^(?:AWS_ACCESS_KEY_ID|AWS_SESSION_TOKEN)$/i;
const runtimeSecretValuesBySource = new Map<string, string[]>();

type SecretRedactionOptions = { secretValues?: Iterable<string> };

export function isSecretEnvironmentKey(key: string) {
	return SECRET_KEY_PATTERN.test(key);
}

export function isSecretRecordKey(key: string) {
	return SECRET_RECORD_KEY_PATTERN.test(key);
}

export function isRegistryCredentialEnvironmentKey(
	key: string,
	value?: string,
) {
	return (
		/(TOKEN|PASSWORD|PASSWD|SECRET|AUTH|CREDENTIAL|API_KEY)/i.test(key) ||
		/^(NPM_CONFIG_USERCONFIG|PIP_CONFIG_FILE|COMPOSER_AUTH|NUGET_AUTH_TOKEN)$/i.test(
			key,
		) ||
		/^POETRY_HTTP_BASIC_/i.test(key) ||
		(isRegistryUrlEnvironmentKey(key) &&
			typeof value === "string" &&
			hasEmbeddedUrlCredential(value))
	);
}

/**
 * Replace secret values known by one runtime configuration source.  The logger
 * reads this registry at write time, so updating a setting cannot leave its
 * previous value protected indefinitely or its new value unprotected.
 */
export function replaceRuntimeSecretValues(
	source: string,
	secretValues: Iterable<string>,
) {
	const values = [...secretValues]
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter(Boolean)
		.filter((value, index, all) => all.indexOf(value) === index);
	if (values.length === 0) {
		runtimeSecretValuesBySource.delete(source);
		return;
	}
	runtimeSecretValuesBySource.set(source, values);
}

export function redactRuntimeSecretText(value: string) {
	return redactSecretText(value, {
		secretValues: collectRuntimeSecretValues(),
	});
}

export function redactRuntimeSecretRecord(value: Record<string, unknown>) {
	return redactSecretRecord(value, {
		secretValues: collectRuntimeSecretValues(),
	});
}

export function redactRuntimeSecretValue(value: unknown): unknown {
	return redactSecretValue(
		value,
		{ secretValues: collectRuntimeSecretValues() },
		new WeakSet(),
	);
}

export function isCredentialFileEnvironmentKey(key: string) {
	return [
		"CARGO_HOME",
		"COMPOSER_HOME",
		"DOCKER_CONFIG",
		"GRADLE_USER_HOME",
		"NUGET_CREDENTIALPROVIDERS_PATH",
		"NUGET_PLUGIN_PATHS",
		"YARN_RC_FILENAME",
	].includes(key.toUpperCase());
}

function isRegistryUrlEnvironmentKey(key: string) {
	return /(REGISTRY|INDEX_URL|REPOSITORY_URL)/i.test(key);
}

function hasEmbeddedUrlCredential(value: string) {
	return (
		/^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+@/i.test(value) ||
		/[?&](?:access_token|token|api_key|key)=/i.test(value)
	);
}

export function redactSecretText(
	value: string,
	options: SecretRedactionOptions = {},
) {
	let redacted = value;
	const secrets = [...(options.secretValues ?? [])]
		.flatMap((secret) => {
			const trimmed = secret.trim();
			return [
				trimmed,
				encodeURIComponent(trimmed),
				Buffer.from(trimmed).toString("base64"),
			];
		})
		.filter((secret) => secret.length >= 6)
		.filter((secret, index, values) => values.indexOf(secret) === index)
		.sort((left, right) => right.length - left.length);
	for (const secret of secrets) {
		redacted = redacted.split(secret).join("[REDACTED]");
	}
	for (const [pattern, replacement] of FALLBACK_PATTERNS) {
		redacted = redacted.replace(pattern, replacement);
	}
	return redacted;
}

export function redactSecretRecord(
	value: Record<string, unknown>,
	options: SecretRedactionOptions = {},
): Record<string, unknown> {
	return redactSecretValue(value, options, new WeakSet()) as Record<
		string,
		unknown
	>;
}

function redactSecretValue(
	value: unknown,
	options: SecretRedactionOptions,
	seen: WeakSet<object>,
): unknown {
	if (typeof value === "string") return redactSecretText(value, options);
	if (!value || typeof value !== "object") return value;
	if (seen.has(value)) return "[REDACTED]";
	seen.add(value);
	if (value instanceof Error) {
		return {
			...Object.fromEntries(
				Object.entries(value).map(([key, item]) => [
					key,
					SECRET_RECORD_KEY_PATTERN.test(key)
						? "[REDACTED]"
						: redactSecretValue(item, options, seen),
				]),
			),
			type: redactSecretText(value.name, options),
			message: redactSecretText(value.message, options),
			...(value.stack ? { stack: redactSecretText(value.stack, options) } : {}),
			...("cause" in value
				? {
						cause: redactSecretValue(
							(value as Error & { cause?: unknown }).cause,
							options,
							seen,
						),
					}
				: {}),
		};
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactSecretValue(entry, options, seen));
	}
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			SECRET_RECORD_KEY_PATTERN.test(key)
				? "[REDACTED]"
				: redactSecretValue(item, options, seen),
		]),
	);
}

function collectRuntimeSecretValues(): string[] {
	const environmentValues = Object.entries(process.env).flatMap(
		([key, value]) => {
			if (
				typeof value !== "string" ||
				(!isSecretEnvironmentKey(key) &&
					!isRegistryCredentialEnvironmentKey(key, value) &&
					!RUNTIME_SECRET_ENVIRONMENT_KEY_PATTERN.test(key))
			)
				return [];
			return [value];
		},
	);
	return [...environmentValues, ...runtimeSecretValuesBySource.values()].flat();
}
