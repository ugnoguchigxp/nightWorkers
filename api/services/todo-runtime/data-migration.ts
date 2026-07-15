export type DataMigrationTodoMarker = {
	taskType?: unknown;
	procedureId?: unknown;
};

export function isDataMigrationTodoMarker(todo: DataMigrationTodoMarker) {
	const taskType =
		typeof todo.taskType === "string" ? todo.taskType.trim() : "";
	const procedureId =
		typeof todo.procedureId === "string" ? todo.procedureId.trim() : "";
	return (
		taskType === "data_migration" ||
		taskType === "migration" ||
		procedureId === "data_migration" ||
		procedureId.startsWith("data_migration.")
	);
}
