-- Security migration: invalidate every pre-existing outstanding reset link before
-- enforcing the one-active-token invariant. Users can request a fresh link.
UPDATE `password_reset_tokens` SET `used_at` = `created_at` WHERE `used_at` IS NULL;
--> statement-breakpoint
UPDATE `settings`
SET `value` = json_set(`value`, '$.resetTokenMinutes', 30)
WHERE `key` = 'security' AND CAST(json_extract(`value`, '$.resetTokenMinutes') AS INTEGER) > 30;
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_one_active_user_uq` ON `password_reset_tokens` (`user_id`) WHERE "password_reset_tokens"."used_at" IS NULL;