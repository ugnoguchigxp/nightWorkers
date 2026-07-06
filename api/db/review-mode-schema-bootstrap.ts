import { client } from './client';
import { ensureColumn } from './schema-bootstrap-utils';

export async function ensureReviewModeTables() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_recommendations (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      level text NOT NULL,
      default_action text NOT NULL,
      reasons_json text NOT NULL,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_recommendations_run_uidx ON review_recommendations (run_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_recommendations_task_idx ON review_recommendations (task_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_recommendations_repository_level_idx ON review_recommendations (repository_id, level)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_sessions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      status text DEFAULT 'not_started' NOT NULL,
      recommendation_id text,
      started_at integer,
      completed_at integer,
      final_action text,
      final_note text,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (recommendation_id) REFERENCES review_recommendations(id) ON DELETE set null
    )
  `);
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_sessions_run_uidx ON review_sessions (run_id)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_sessions_task_status_idx ON review_sessions (task_id, status)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_artifacts (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      kind text NOT NULL,
      status text DEFAULT 'not_started' NOT NULL,
      artifact_json text,
      source_evidence_refs_json text NOT NULL,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_artifacts_session_kind_uidx ON review_artifacts (review_session_id, kind)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_artifacts_run_kind_idx ON review_artifacts (run_id, kind)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_findings (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      severity text NOT NULL,
      title text NOT NULL,
      body text,
      disposition text,
      disposition_status text DEFAULT 'unresolved' NOT NULL,
      disposition_note text,
      evidence_refs_json text NOT NULL,
      source_section text,
      created_goal_id text,
      created_task_proposal_id text,
      context_still_candidate_id text,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_findings_session_status_idx ON review_findings (review_session_id, disposition_status)'
  );
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_findings_run_severity_idx ON review_findings (run_id, severity)'
  );
  await ensureColumn('review_findings', 'disposition_note', 'disposition_note text');
  await ensureColumn('review_findings', 'source_section', 'source_section text');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_prompt_suggestions (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      finding_id text NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      title text NOT NULL,
      prompt text NOT NULL,
      expected_outcome text NOT NULL,
      acceptance_criteria text NOT NULL,
      verification_hint text NOT NULL,
      evidence_refs_json text NOT NULL,
      status text DEFAULT 'draft' NOT NULL,
      use_count integer DEFAULT 0 NOT NULL,
      last_used_at integer,
      dismissed_at integer,
      created_message_id text,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (finding_id) REFERENCES review_findings(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade,
      FOREIGN KEY (created_message_id) REFERENCES task_messages(id) ON DELETE set null
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_prompt_suggestions_session_status_idx ON review_prompt_suggestions (review_session_id, status)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_prompt_suggestions_finding_uidx ON review_prompt_suggestions (finding_id)'
  );

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_security_handoffs (
      id text PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      review_session_id text NOT NULL,
      finding_id text NOT NULL,
      run_id text NOT NULL,
      task_id text NOT NULL,
      repository_id text NOT NULL,
      title text NOT NULL,
      summary text NOT NULL,
      requested_integration text,
      status text DEFAULT 'needs_configuration' NOT NULL,
      changed_paths_json text NOT NULL,
      evidence_refs_json text NOT NULL,
      handoff_artifact_json text,
      FOREIGN KEY (review_session_id) REFERENCES review_sessions(id) ON DELETE cascade,
      FOREIGN KEY (finding_id) REFERENCES review_findings(id) ON DELETE cascade,
      FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE cascade,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE cascade,
      FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE cascade
    )
  `);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS review_security_handoffs_session_status_idx ON review_security_handoffs (review_session_id, status)'
  );
  await client.execute(
    'CREATE UNIQUE INDEX IF NOT EXISTS review_security_handoffs_finding_uidx ON review_security_handoffs (finding_id)'
  );
}
