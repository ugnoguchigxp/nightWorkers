ALTER TABLE `mission_pilot_plan_routing_revisions` ADD `idempotency_key` text;
--> statement-breakpoint
ALTER TABLE `mission_pilot_plan_routing_revisions` ADD `request_hash` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_pilot_plan_routing_revisions_idempotency_uidx` ON `mission_pilot_plan_routing_revisions` (`session_id`,`idempotency_key`);
