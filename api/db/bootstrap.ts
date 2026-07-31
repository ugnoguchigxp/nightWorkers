import { ensureBaseNightWorkersTables } from "./base-schema-bootstrap";
import { ensureRuntimeAndUsageTables } from "./bootstrap-runtime-tables";
import { ensureTaskWorkflowTables } from "./bootstrap-task-workflow-tables";
import { client } from "./client";
import { ensureCloseoutAdmissionTables } from "./closeout-admission-schema-bootstrap";
import { ensureEvidenceLedgerTables } from "./evidence-ledger-schema-bootstrap";
import { ensureFinalResponseEvidenceTables } from "./final-response-evidence-schema-bootstrap";
import { ensurePlanModeTables } from "./plan-mode-schema-bootstrap";
import {
	ensureMissionPlannerTables,
	ensureProjectDetailTables,
} from "./project-detail-schema-bootstrap";
import { ensureProjectEvaluationTables } from "./project-evaluation-schema-bootstrap";
import { ensureReviewModeTables } from "./review-mode-schema-bootstrap";
import { ensureColumn } from "./schema-bootstrap-utils";
import { ensureTaskArchiveTables } from "./task-archive-schema-bootstrap";
import { ensureTaskGenerationTables } from "./task-generation-schema-bootstrap";
import { ensureTechStackTables } from "./tech-stack-schema-bootstrap";
import { ensureVerificationTables } from "./verification-schema-bootstrap";

async function ensureNullableDesignQuestionnaireBlueprintSource() {
	const columns = await client.execute(
		"PRAGMA table_info(design_questionnaire_sessions)",
	);
	const sourceColumn = columns.rows.find(
		(row) => row.name === "source_blueprint_message_id",
	);
	if (sourceColumn?.notnull !== 1) return;

	await client.execute("PRAGMA foreign_keys = OFF");
	try {
		await client.execute(`
      CREATE TABLE IF NOT EXISTS design_questionnaire_sessions_next (
        id text PRIMARY KEY NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        task_id text NOT NULL,
        repository_id text NOT NULL,
        source_blueprint_message_id text,
        status text DEFAULT 'draft' NOT NULL,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
        FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
        FOREIGN KEY (source_blueprint_message_id) REFERENCES task_messages(id) ON DELETE cascade
      )
    `);
		await client.execute(`
      INSERT INTO design_questionnaire_sessions_next (
        id,
        created_at,
        updated_at,
        task_id,
        repository_id,
        source_blueprint_message_id,
        status
      )
      SELECT
        id,
        created_at,
        updated_at,
        task_id,
        repository_id,
        source_blueprint_message_id,
        status
      FROM design_questionnaire_sessions
    `);
		await client.execute("DROP TABLE design_questionnaire_sessions");
		await client.execute(
			"ALTER TABLE design_questionnaire_sessions_next RENAME TO design_questionnaire_sessions",
		);
		await client.execute(
			"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_task_idx ON design_questionnaire_sessions (task_id)",
		);
		await client.execute(
			"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_repository_idx ON design_questionnaire_sessions (repository_id)",
		);
		await client.execute(
			"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_source_blueprint_idx ON design_questionnaire_sessions (source_blueprint_message_id)",
		);
	} finally {
		await client.execute("PRAGMA foreign_keys = ON");
	}
}

async function removeLegacyProductAuthenticationState() {
	await client.execute("DROP TABLE IF EXISTS refresh_tokens");
	await client.execute("DROP TABLE IF EXISTS user_external_accounts");
	await client.execute("DROP TABLE IF EXISTS users");
	await client.execute("DELETE FROM application_settings WHERE scope = 'auth'");
	await client.execute(
		"DELETE FROM application_setting_secrets WHERE scope = 'auth'",
	);
}

export async function ensureNightWorkersSchema(
	_options: { includeMissionPilot?: boolean } = {},
) {
	await client.execute("PRAGMA foreign_keys = ON");
	await client.execute("PRAGMA busy_timeout = 10000");
	await client.execute("PRAGMA journal_mode = WAL");
	await client.execute(`
    CREATE TABLE IF NOT EXISTS application_settings (
      scope text PRIMARY KEY NOT NULL,
      value_json text NOT NULL,
      revision integer DEFAULT 1 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `);
	await client.execute(`
    CREATE TABLE IF NOT EXISTS application_setting_secrets (
      scope text PRIMARY KEY NOT NULL,
      value_json text NOT NULL,
      revision integer DEFAULT 1 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `);
	await client.execute(`
    CREATE TABLE IF NOT EXISTS application_setting_migrations (
      source text PRIMARY KEY NOT NULL,
      source_fingerprint text NOT NULL,
      imported_at integer NOT NULL,
      completed_at integer NOT NULL,
      result_json text NOT NULL
    )
  `);
	await client.execute(`
		CREATE TABLE IF NOT EXISTS task_operator_command_receipts (
			id text PRIMARY KEY NOT NULL,
			actor_kind text NOT NULL,
			actor_id text NOT NULL,
			task_id text NOT NULL,
			action_id text NOT NULL,
			idempotency_key text NOT NULL,
			arguments_digest text NOT NULL,
			status text NOT NULL,
			result_json text,
			failure_json text,
			created_at integer NOT NULL,
			updated_at integer NOT NULL
		)
	`);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS task_operator_command_receipts_actor_key_uidx ON task_operator_command_receipts (actor_kind, actor_id, idempotency_key)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS task_operator_command_receipts_status_idx ON task_operator_command_receipts (status)",
	);

	// Drop legacy BBS tables if they exist
	await client.execute("DROP TABLE IF EXISTS comments");
	await client.execute("DROP TABLE IF EXISTS threads");
	await removeLegacyProductAuthenticationState();

	await ensureBaseNightWorkersTables();
	await ensureTaskArchiveTables();
	await ensureTaskGenerationTables();
	await ensureNullableDesignQuestionnaireBlueprintSource();
	await ensurePlanModeTables();
	await ensureProjectEvaluationTables();
	await ensureProjectDetailTables();
	await ensureTechStackTables();
	await ensureMissionPlannerTables();
	await ensureReviewModeTables();
	await ensureVerificationTables();

	const taskRunColumns = await client.execute("PRAGMA table_info(task_runs)");
	const hasFinalJudgmentColumn = taskRunColumns.rows.some(
		(row) => row.name === "final_judgment",
	);
	if (taskRunColumns.rows.length > 0 && !hasFinalJudgmentColumn) {
		await client.execute(
			"ALTER TABLE task_runs ADD COLUMN final_judgment text",
		);
	}

	const repositoryColumns = await client.execute(
		"PRAGMA table_info(repositories)",
	);
	const hasQueueEnabledColumn = repositoryColumns.rows.some(
		(row) => row.name === "queue_enabled",
	);
	if (repositoryColumns.rows.length > 0 && !hasQueueEnabledColumn) {
		await client.execute(
			"ALTER TABLE repositories ADD COLUMN queue_enabled integer DEFAULT false NOT NULL",
		);
	}
	const hasMaxConcurrentSessionsColumn = repositoryColumns.rows.some(
		(row) => row.name === "max_concurrent_sessions",
	);
	if (repositoryColumns.rows.length > 0 && !hasMaxConcurrentSessionsColumn) {
		await client.execute(
			"ALTER TABLE repositories ADD COLUMN max_concurrent_sessions integer DEFAULT 1 NOT NULL",
		);
	}
	const hasProjectMetaColumn = repositoryColumns.rows.some(
		(row) => row.name === "project_meta",
	);
	if (repositoryColumns.rows.length > 0 && !hasProjectMetaColumn) {
		await client.execute(
			"ALTER TABLE repositories ADD COLUMN project_meta text",
		);
	}
	const hasFeatureSettingsColumn = repositoryColumns.rows.some(
		(row) => row.name === "feature_settings",
	);
	if (repositoryColumns.rows.length > 0 && !hasFeatureSettingsColumn) {
		await client.execute(
			"ALTER TABLE repositories ADD COLUMN feature_settings text",
		);
	}
	await ensureColumn(
		"repositories",
		"repository_kind",
		"repository_kind text DEFAULT 'non_git' NOT NULL",
	);
	await ensureColumn(
		"repositories",
		"repository_identity_status",
		"repository_identity_status text DEFAULT 'materialization_pending' NOT NULL",
	);
	await ensureColumn(
		"repositories",
		"registered_root_canonical",
		"registered_root_canonical text",
	);
	await ensureColumn(
		"repositories",
		"git_common_dir_canonical",
		"git_common_dir_canonical text",
	);
	await ensureColumn(
		"repositories",
		"base_worktree_path_canonical",
		"base_worktree_path_canonical text",
	);
	await ensureColumn(
		"repositories",
		"base_worktree_id",
		"base_worktree_id text",
	);
	await ensureColumn(
		"repositories",
		"base_worktree_branch",
		"base_worktree_branch text",
	);
	await ensureColumn(
		"repositories",
		"base_worktree_head_sha",
		"base_worktree_head_sha text",
	);
	await ensureColumn(
		"repositories",
		"base_worktree_dirty",
		"base_worktree_dirty integer",
	);
	await ensureColumn(
		"repositories",
		"repository_identity_digest",
		"repository_identity_digest text",
	);
	await ensureColumn(
		"repositories",
		"repository_identity_revision",
		"repository_identity_revision integer DEFAULT 0 NOT NULL",
	);
	await ensureColumn(
		"repositories",
		"repository_identity_verified_at",
		"repository_identity_verified_at integer",
	);

	await ensureRuntimeAndUsageTables();

	await ensureTaskWorkflowTables();
	await ensureEvidenceLedgerTables();
	await ensureFinalResponseEvidenceTables();
	await ensureCloseoutAdmissionTables();
	const queueColumns = await client.execute(
		"PRAGMA table_info(implementation_queue_entries)",
	);
	if (
		queueColumns.rows.some((row) => row.name === "mission_pilot_agent_json") &&
		!queueColumns.rows.some((row) => row.name === "request_provenance_json")
	) {
		await client.execute(
			"ALTER TABLE implementation_queue_entries RENAME COLUMN mission_pilot_agent_json TO request_provenance_json",
		);
	}
	await ensureColumn(
		"implementation_queue_entries",
		"request_provenance_json",
		"request_provenance_json text",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_design_settings (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      settings_json text NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);

	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS blueprint_design_settings_task_id_uidx ON blueprint_design_settings (task_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_artifact_adoptions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      message_id text NOT NULL,
      adopted integer DEFAULT false NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS blueprint_artifact_adoptions_task_id_idx ON blueprint_artifact_adoptions (task_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS blueprint_artifact_adoptions_message_uidx ON blueprint_artifact_adoptions (task_id, message_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS blueprint_design_token_adoptions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      message_id text NOT NULL,
      adopted integer DEFAULT false NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS blueprint_design_token_adoptions_task_id_idx ON blueprint_design_token_adoptions (task_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS blueprint_design_token_adoptions_message_uidx ON blueprint_design_token_adoptions (task_id, message_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_sessions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      source_blueprint_message_id text,
      status text DEFAULT 'draft' NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (source_blueprint_message_id) REFERENCES task_messages(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_task_idx ON design_questionnaire_sessions (task_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_repository_idx ON design_questionnaire_sessions (repository_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_sessions_source_blueprint_idx ON design_questionnaire_sessions (source_blueprint_message_id)",
	);
	await ensureColumn(
		"design_questionnaire_sessions",
		"mission_pilot_action_key",
		"mission_pilot_action_key text",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_question_sets (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      session_id text NOT NULL,
      sequence integer NOT NULL,
      questionnaire_json text,
      raw_output text,
      validation_status text DEFAULT 'valid' NOT NULL,
      FOREIGN KEY (session_id) REFERENCES design_questionnaire_sessions(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_question_sets_session_idx ON design_questionnaire_question_sets (session_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS design_questionnaire_question_sets_sequence_uidx ON design_questionnaire_question_sets (session_id, sequence)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_answers (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      session_id text NOT NULL,
      question_id text NOT NULL,
      answer_json text NOT NULL,
      answered_at integer NOT NULL,
      FOREIGN KEY (session_id) REFERENCES design_questionnaire_sessions(id) ON DELETE cascade
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_answers_session_idx ON design_questionnaire_answers (session_id)",
	);
	await client.execute(
		"CREATE UNIQUE INDEX IF NOT EXISTS design_questionnaire_answers_question_uidx ON design_questionnaire_answers (session_id, question_id)",
	);

	await client.execute(`
    CREATE TABLE IF NOT EXISTS design_questionnaire_reviews (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      session_id text NOT NULL,
      review_json text,
      published_message_id text,
      status text DEFAULT 'draft' NOT NULL,
      FOREIGN KEY (session_id) REFERENCES design_questionnaire_sessions(id) ON DELETE cascade,
      FOREIGN KEY (published_message_id) REFERENCES task_messages(id) ON DELETE set null
    )
  `);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_reviews_session_idx ON design_questionnaire_reviews (session_id)",
	);
	await client.execute(
		"CREATE INDEX IF NOT EXISTS design_questionnaire_reviews_published_message_idx ON design_questionnaire_reviews (published_message_id)",
	);
}
