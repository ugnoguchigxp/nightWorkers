DROP TABLE IF EXISTS `refresh_tokens`;
--> statement-breakpoint
DROP TABLE IF EXISTS `user_external_accounts`;
--> statement-breakpoint
DROP TABLE IF EXISTS `users`;
--> statement-breakpoint
DELETE FROM `application_settings` WHERE `scope` = 'auth';
--> statement-breakpoint
DELETE FROM `application_setting_secrets` WHERE `scope` = 'auth';
