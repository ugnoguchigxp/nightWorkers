ALTER TABLE `coding_agent_evidence_check_confirmations` ADD `policy_version` text;
--> statement-breakpoint
ALTER TABLE `coding_agent_evidence_check_confirmations` ADD `source_state_hash` text;
--> statement-breakpoint
ALTER TABLE `coding_agent_evidence_check_confirmations` ADD `verification_document_digest` text;
--> statement-breakpoint
ALTER TABLE `coding_agent_evidence_check_confirmations` ADD `authorized_verify_digest` text;
--> statement-breakpoint
ALTER TABLE `coding_agent_evidence_check_confirmations` ADD `receipt_digest` text;
--> statement-breakpoint
ALTER TABLE `coding_agent_evidence_readiness_settlements` ADD `confirmation_id` text;
--> statement-breakpoint
ALTER TABLE `coding_agent_evidence_readiness_settlements` ADD `receipt_digest` text;
