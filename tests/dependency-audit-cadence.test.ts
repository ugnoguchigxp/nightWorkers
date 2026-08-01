import { describe, expect, it } from "vitest";
import {
	createDependencyAuditFingerprint,
	createDependencyAuditState,
	evaluateDependencyAuditCadence,
} from "../scripts/dependency-audit-cadence.mjs";

const fingerprint = createDependencyAuditFingerprint({
	"bun.lock": "lockfile",
	"config/dependency-audit-allowlist.json": '{"minimumSeverity":"moderate"}',
});

describe("weekly dependency audit cadence", () => {
	it("changes the fingerprint when an audited dependency input changes", () => {
		const changedFingerprint = createDependencyAuditFingerprint({
			"bun.lock": "updated-lockfile",
			"config/dependency-audit-allowlist.json":
				'{"minimumSeverity":"moderate"}',
		});

		expect(changedFingerprint).not.toBe(fingerprint);
	});

	it("skips a recent successful audit when dependencies are unchanged", () => {
		const state = createDependencyAuditState(
			fingerprint,
			new Date("2026-07-30T00:00:00.000Z"),
		);

		expect(
			evaluateDependencyAuditCadence({
				state,
				fingerprint,
				now: new Date("2026-08-01T00:00:00.000Z"),
			}),
		).toMatchObject({ shouldRun: false, reason: "recent-success" });
	});

	it("runs after seven days or when dependencies change", () => {
		const state = createDependencyAuditState(
			fingerprint,
			new Date("2026-07-25T00:00:00.000Z"),
		);

		expect(
			evaluateDependencyAuditCadence({
				state,
				fingerprint,
				now: new Date("2026-08-01T00:00:00.000Z"),
			}),
		).toMatchObject({ shouldRun: true, reason: "weekly-interval-elapsed" });
		expect(
			evaluateDependencyAuditCadence({
				state,
				fingerprint: `${fingerprint}-changed`,
				now: new Date("2026-07-26T00:00:00.000Z"),
			}),
		).toEqual({
			shouldRun: true,
			reason: "dependency-or-policy-changed",
		});
	});

	it("runs for missing, invalid, future, or explicitly forced state", () => {
		const now = new Date("2026-08-01T00:00:00.000Z");
		for (const state of [
			null,
			{ schemaVersion: 99, fingerprint, auditedAt: now.toISOString() },
			{ schemaVersion: 1, fingerprint, auditedAt: "invalid" },
			{
				schemaVersion: 1,
				fingerprint,
				auditedAt: "2026-08-02T00:00:00.000Z",
			},
		]) {
			expect(
				evaluateDependencyAuditCadence({ state, fingerprint, now }),
			).toMatchObject({
				shouldRun: true,
				reason: "missing-or-invalid-state",
			});
		}
		expect(
			evaluateDependencyAuditCadence({
				state: createDependencyAuditState(fingerprint, now),
				fingerprint,
				now,
				force: true,
			}),
		).toEqual({ shouldRun: true, reason: "forced" });
	});
});
