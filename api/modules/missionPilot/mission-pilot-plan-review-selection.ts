export function selectCurrentPlanReviews<
	T extends {
		contextRevision: number;
		contextDigest: string;
		routingRevision: number;
	},
>(
	reviews: T[],
	session: {
		contextRevision: number;
		contextDigest: string;
		planRoutingRevision: number;
	} | null,
) {
	if (!session) return [];
	return reviews.filter(
		(review) =>
			review.contextRevision === session.contextRevision &&
			review.contextDigest === session.contextDigest &&
			review.routingRevision === session.planRoutingRevision,
	);
}
