import test from "node:test";
import assert from "node:assert/strict";
import { prioritizeOpenTickets } from "../src/tickets.mjs";

test("keeps open tickets and orders urgent work first", () => {
	const tickets = [
		{ id: "T-3", status: "open", priority: "normal", createdAt: "2026-07-01" },
		{ id: "T-1", status: "closed", priority: "urgent", createdAt: "2026-06-01" },
		{ id: "T-2", status: "open", priority: "urgent", createdAt: "2026-07-02" },
		{ id: "T-4", status: "open", priority: "high", createdAt: "2026-06-30" },
	];
	assert.deepEqual(
		prioritizeOpenTickets(tickets).map((ticket) => ticket.id),
		["T-2", "T-4", "T-3"],
	);
});

test("does not mutate provider input", () => {
	const tickets = [{ id: "T-1", status: "open", priority: "normal", createdAt: "2026-07-01" }];
	const snapshot = structuredClone(tickets);
	prioritizeOpenTickets(tickets);
	assert.deepEqual(tickets, snapshot);
});
