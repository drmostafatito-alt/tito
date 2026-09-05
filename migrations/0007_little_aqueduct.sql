CREATE TABLE `announcement_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer NOT NULL,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcement_reads_uidx` ON `announcement_reads` (`announcement_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `announcement_reads_user_idx` ON `announcement_reads` (`user_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`body_ar` text DEFAULT '' NOT NULL,
	`body_en` text DEFAULT '' NOT NULL,
	`audience` text DEFAULT 'all' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`publish_at` integer,
	`expires_at` integer,
	`published_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `announcements_status_publish_idx` ON `announcements` (`status`,`publish_at`);--> statement-breakpoint
CREATE INDEX `watch_sessions_started_idx` ON `video_watch_sessions` (`started_at`);--> statement-breakpoint
CREATE INDEX `exam_attempts_started_idx` ON `exam_attempts` (`started_at`);--> statement-breakpoint
CREATE INDEX `orders_status_created_idx` ON `orders` (`status`,`created_at`);
--> statement-breakpoint
-- Phase 7: grant the admin role the platform-administration permission set.
-- Idempotent: role_permissions_pk unique index + INSERT OR IGNORE. super_admin (rank 4) bypasses in code.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`, `granted_at`) VALUES
  ('admin', 'users.read', (strftime('%s','now') * 1000)),
  ('admin', 'users.manage', (strftime('%s','now') * 1000)),
  ('admin', 'analytics.read', (strftime('%s','now') * 1000)),
  ('admin', 'security.read', (strftime('%s','now') * 1000)),
  ('admin', 'audit.read', (strftime('%s','now') * 1000)),
  ('admin', 'announcements.manage', (strftime('%s','now') * 1000));
