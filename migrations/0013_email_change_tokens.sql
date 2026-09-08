CREATE TABLE `email_change_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`new_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_change_token_uq` ON `email_change_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `email_change_user_idx` ON `email_change_tokens` (`user_id`);
