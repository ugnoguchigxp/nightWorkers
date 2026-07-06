const publicApiPathPrefixes = [
	"/api/health",
	"/api/auth/login",
	"/api/auth/register",
	"/api/auth/refresh",
	"/api/auth/logout",
	"/api/auth/methods",
	"/api/auth/oauth",
	"/api/doc",
	"/api/ui",
];

export function isPublicApiPath(pathname: string) {
	return publicApiPathPrefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}
