export type ListenSecurityInput = {
	host: string;
	corsOrigins: string[];
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
	const status: "pass" | "fail" = loopback ? "pass" : "fail";
	const detail = loopback
		? `HOST=${input.host} is loopback-only.`
		: `HOST=${input.host} is not loopback. NightWorkers only supports local listeners.`;
	return {
		status,
		detail,
		loopback,
		corsOrigins: input.corsOrigins,
	};
}
