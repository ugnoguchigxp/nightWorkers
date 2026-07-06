export const getRelativeTimestamp = (dateValue: unknown) => {
	const date = new Date(String(dateValue));
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMin = Math.floor(diffMs / (1000 * 60));
	const diffHours = Math.floor(diffMin / 60);
	const diffDays = Math.floor(diffHours / 24);
	if (diffMin < 60) return `${Math.max(1, diffMin)}分`;
	if (diffHours < 24) return `${diffHours}時間`;
	if (diffDays < 30) return `${diffDays}日`;
	return `${Math.floor(diffDays / 30)}月`;
};
