import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const repositories = sqliteTable("repositories", {
	id: text("id").primaryKey(),
});

export const tasks = sqliteTable("tasks", {
	id: text("id").primaryKey(),
});

export const taskMessages = sqliteTable("task_messages", {
	id: text("id").primaryKey(),
});

export const taskRuns = sqliteTable("task_runs", {
	id: text("id").primaryKey(),
});

export const designQuestionnaireSessions = sqliteTable(
	"design_questionnaire_sessions",
	{
		id: text("id").primaryKey(),
	},
);
