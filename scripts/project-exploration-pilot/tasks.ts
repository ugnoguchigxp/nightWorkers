export type PilotTask = {
	readonly id: string;
	readonly category: string;
	readonly title: string;
	readonly description: string;
	readonly objective: string;
	readonly acceptanceCriteria: string;
};

export const PILOT_TASKS = [
	{
		id: "p01",
		category: "frontend-routing",
		title: "Harden local login redirects",
		description:
			"Harden login redirect parsing so only safe same-origin absolute-path redirects are accepted. Reject redirects containing backslashes, ASCII control characters, encoded protocol-relative prefixes, or an authority component, while preserving valid local query strings and fragments. Add focused regression tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Prevent browser redirect ambiguity without changing valid local redirect behavior.",
		acceptanceCriteria:
			"Unsafe redirect variants are rejected; valid local paths with query/hash remain accepted; focused tests and typecheck pass.",
	},
	{
		id: "p02",
		category: "backend-configuration",
		title: "Normalize configured CORS origins",
		description:
			"Normalize configured CORS origins by trimming whitespace, ignoring blank entries, and removing duplicates while preserving first-seen order. Ensure the application URL origin appears exactly once. Add focused tests for blanks, duplicates, and ordering. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Make CORS origin configuration deterministic and resistant to harmless formatting differences.",
		acceptanceCriteria:
			"Normalized origins are unique and ordered; blank entries are ignored; the application origin is present once; focused tests and typecheck pass.",
	},
	{
		id: "p03",
		category: "shared-auth-contract",
		title: "Canonicalize login email input",
		description:
			"Canonicalize login email input at the shared validation boundary by trimming and lowercasing the address before backend and frontend consumers use it. Preserve validation errors for malformed addresses and add focused contract tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Give all authentication consumers one canonical email representation.",
		acceptanceCriteria:
			"Valid mixed-case padded email input parses to lowercase without padding; malformed email remains rejected; focused tests and typecheck pass.",
	},
	{
		id: "p04",
		category: "database-runtime",
		title: "Reject blank SQLite database paths",
		description:
			"Harden SQLite database path initialization so empty or whitespace-only database paths are rejected before directory creation or database opening. Keep memory databases and normal relative file paths working. Add focused regression tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective: "Fail early for ambiguous database path configuration.",
		acceptanceCriteria:
			"Blank paths throw a clear error; memory and normal file paths retain current behavior; focused tests and typecheck pass.",
	},
	{
		id: "p05",
		category: "security-policy",
		title: "Make CSP serialization deterministic",
		description:
			"Harden Content Security Policy serialization by omitting directives with no values and deduplicating repeated values while preserving their first-seen order. Preserve current directive ordering and kebab-case conversion. Add focused tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Produce stable CSP headers without empty or repeated policy tokens.",
		acceptanceCriteria:
			"Empty directives are absent, duplicate values occur once, existing policy serialization remains stable, and focused tests/typecheck pass.",
	},
	{
		id: "p06",
		category: "shared-auth-contract",
		title: "Reject blank authenticated display names",
		description:
			"Strengthen the shared authenticated-user response contract so display names containing only whitespace are rejected while meaningful names with surrounding whitespace remain valid without changing their returned value. Add focused schema tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Prevent semantically empty display names at the shared API boundary.",
		acceptanceCriteria:
			"Whitespace-only display names fail validation; meaningful padded names retain their original value; focused tests and typecheck pass.",
	},
	{
		id: "p07",
		category: "frontend-search",
		title: "Require canonical showcase page sizes",
		description:
			"Tighten showcase table query parsing so page-size values are accepted only as supported numbers or canonical decimal strings. Reject padded, exponent, fractional, signed, and leading-zero string forms instead of coercing them. Keep current defaults and add focused tests. Run the relevant tests and TypeScript typecheck before finishing.",
		objective: "Keep shareable showcase URLs canonical and predictable.",
		acceptanceCriteria:
			"Supported numeric and canonical string sizes parse; non-canonical coercible strings fall back; focused tests and typecheck pass.",
	},
	{
		id: "p08",
		category: "authentication-security",
		title: "Reject unknown JWT payload fields",
		description:
			"Make the JWT payload validation contract reject unknown top-level fields instead of silently stripping them. Preserve all valid access and refresh token behavior, and add focused unit coverage for valid payloads and unexpected claims. Run the relevant tests and TypeScript typecheck before finishing.",
		objective: "Keep the accepted JWT claim surface explicit.",
		acceptanceCriteria:
			"Known payloads still parse; an unexpected top-level claim is rejected; token service tests and typecheck pass.",
	},
	{
		id: "p09",
		category: "authentication-runtime",
		title: "Accept padded auth token durations",
		description:
			"Allow harmless leading and trailing whitespace in configured authentication token duration strings before converting them to cookie max-age values. Keep invalid, zero, and negative durations omitted. Add focused tests for padded valid and invalid values. Run the relevant tests and TypeScript typecheck before finishing.",
		objective:
			"Make cookie duration handling consistent with normalized environment input.",
		acceptanceCriteria:
			"Padded valid durations produce max-age; invalid/non-positive durations do not; existing cookie attributes remain unchanged; focused tests and typecheck pass.",
	},
	{
		id: "p10",
		category: "api-observability",
		title: "Mark health responses as non-cacheable",
		description:
			"Ensure the health endpoint explicitly sends a no-store cache policy so intermediaries cannot serve stale readiness information. Preserve its JSON response contract and add focused route and application-level tests for the header. Run the relevant tests and TypeScript typecheck before finishing.",
		objective: "Prevent cached health responses without changing the endpoint body.",
		acceptanceCriteria:
			"Health responses include Cache-Control: no-store; the existing status/service body is unchanged; focused tests and typecheck pass.",
	},
] as const satisfies readonly PilotTask[];
