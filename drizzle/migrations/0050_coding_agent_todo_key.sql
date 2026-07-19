ALTER TABLE `task_run_todos` ADD `todo_key` text;

UPDATE `task_run_todos`
SET `todo_key` = `id`
WHERE `todo_key` IS NULL OR trim(`todo_key`) = '';

CREATE UNIQUE INDEX `task_run_todos_run_todo_key_uidx`
ON `task_run_todos` (`run_id`, `todo_key`);

CREATE TRIGGER `task_run_todos_todo_key_not_null_insert`
BEFORE INSERT ON `task_run_todos`
WHEN NEW.`todo_key` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'task_run_todos.todo_key must not be null');
END;

CREATE TRIGGER `task_run_todos_todo_key_not_null_update`
BEFORE UPDATE OF `todo_key` ON `task_run_todos`
WHEN NEW.`todo_key` IS NULL
BEGIN
	SELECT RAISE(ABORT, 'task_run_todos.todo_key must not be null');
END;
