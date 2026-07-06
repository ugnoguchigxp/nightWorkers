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

export const formatRunDuration = (
	startedAt: unknown,
	endedAt?: unknown | null,
) => {
	const start = new Date(String(startedAt)).getTime();
	const end = endedAt ? new Date(String(endedAt)).getTime() : Date.now();
	const diffSec = Math.floor((end - start) / 1000);
	if (diffSec < 60) return `${Math.max(1, diffSec)}s`;
	const diffMin = Math.floor(diffSec / 60);
	return `${diffMin}m ${diffSec % 60}s`;
};

export const formatFinishedTime = (dateValue?: unknown | null) => {
	if (!dateValue) return "";
	const date = new Date(String(dateValue));
	const hours = date.getHours().toString().padStart(2, "0");
	const minutes = date.getMinutes().toString().padStart(2, "0");
	const daysOfWeek = [
		"日曜日",
		"月曜日",
		"火曜日",
		"水曜日",
		"木曜日",
		"金曜日",
		"土曜日",
	];
	return `${hours}:${minutes} (${daysOfWeek[date.getDay()]})`;
};
