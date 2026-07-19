import { client } from "./client";
import { ensureColumn } from "./schema-bootstrap-utils";

export async function ensureTaskRunTodoKey() {
	await ensureColumn("task_run_todos", "todo_key", "todo_key text");
	await client.execute(`
		UPDATE task_run_todos
		SET todo_key = id
		WHERE todo_key IS NULL OR trim(todo_key) = ''
	`);
	const duplicateTodoKeys = await client.execute(`
		SELECT run_id, todo_key, count(*) AS duplicate_count
		FROM task_run_todos
		GROUP BY run_id, todo_key
		HAVING count(*) > 1
		LIMIT 1
	`);
	if (duplicateTodoKeys.rows.length > 0) {
		throw new Error(
			"task_run_todos todo_key backfill conflict: duplicate (run_id, todo_key)",
		);
	}
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_run_todos_run_todo_key_uidx ON task_run_todos (run_id, todo_key)",
	);
	await client.execute(`
		CREATE TRIGGER IF NOT EXISTS task_run_todos_todo_key_not_null_insert
		BEFORE INSERT ON task_run_todos
		WHEN NEW.todo_key IS NULL
		BEGIN
			SELECT RAISE(ABORT, 'task_run_todos.todo_key must not be null');
		END
	`);
	await client.execute(`
		CREATE TRIGGER IF NOT EXISTS task_run_todos_todo_key_not_null_update
		BEFORE UPDATE OF todo_key ON task_run_todos
		WHEN NEW.todo_key IS NULL
		BEGIN
			SELECT RAISE(ABORT, 'task_run_todos.todo_key must not be null');
		END
	`);
}
