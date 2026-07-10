const priorityRank = new Map([
	["urgent", 0],
	["high", 1],
	["normal", 2],
	["low", 3],
]);

export function prioritizeOpenTickets(tickets) {
	return tickets
		.filter((ticket) => ticket.status === "open")
		.toSorted((left, right) => {
			const byPriority =
				(priorityRank.get(left.priority) ?? Number.MAX_SAFE_INTEGER) -
				(priorityRank.get(right.priority) ?? Number.MAX_SAFE_INTEGER);
			return byPriority || left.createdAt.localeCompare(right.createdAt);
		});
}
