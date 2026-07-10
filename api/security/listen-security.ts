export type ListenSecurityInput = {
	nodeEnv: "development" | "production" | "test";
	host: string;
	authRequired: boolean;
	corsOrigins: string[];
	trustProxy: boolean;
	allowInsecureNonLoopback?: boolean;
};

export function isLoopbackHost(value: string) {
	const host = value
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "");
	if (host === "localhost" || host === "::1") return true;
	const octets = host.split(".");
	return octets.length === 4 && octets[0] === "127";
}

export function assessListenSecurity(input: ListenSecurityInput) {
	const loopback = isLoopbackHost(input.host);
	const exposedWithoutAuth = !loopback && !input.authRequired;
	const productionBlocked =
		input.nodeEnv === "production" && exposedWithoutAuth;
	const unsafeDevelopmentOverride =
		exposedWithoutAuth &&
		input.nodeEnv !== "production" &&
		input.allowInsecureNonLoopback === true;
	const status: "pass" | "warn" | "fail" = productionBlocked
		? "fail"
		: exposedWithoutAuth && !unsafeDevelopmentOverride
			? "warn"
			: "pass";
	const detail = productionBlocked
		? `HOST=${input.host} is non-loopback while API_AUTH_REQUIRED=false. Enable API authentication or bind to 127.0.0.1/::1.`
		: exposedWithoutAuth
			? unsafeDevelopmentOverride
				? `Unsafe non-loopback development binding explicitly acknowledged for HOST=${input.host}. Do not use this setting in production.`
				: `HOST=${input.host} exposes command and repository APIs without authentication. Set ALLOW_INSECURE_NON_LOOPBACK=true only for an isolated development container.`
			: `HOST=${input.host} is loopback-only${input.authRequired ? " with API authentication enabled" : ""}.`;
	return {
		status,
		detail,
		loopback,
		productionBlocked,
		exposedWithoutAuth,
		proxyHeadersTrusted: input.trustProxy,
		corsOrigins: input.corsOrigins,
	};
}
