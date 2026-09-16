CREATE TABLE `academic_years` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`start_year` integer NOT NULL,
	`end_year` integer NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `academic_years_slug_unique` ON `academic_years` (`slug`);--> statement-breakpoint
CREATE INDEX `academic_years_status_idx` ON `academic_years` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `academic_years_start_year_idx` ON `academic_years` (`start_year`);--> statement-breakpoint
CREATE TABLE `terms` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terms_slug_unique` ON `terms` (`slug`);--> statement-breakpoint
CREATE INDEX `terms_status_idx` ON `terms` (`status`,`sort_order`);--> statement-breakpoint
ALTER TABLE `courses` ADD `academic_year_id` text;--> statement-breakpoint
ALTER TABLE `courses` ADD `term_id` text;--> statement-breakpoint
CREATE INDEX `courses_year_term_idx` ON `courses` (`academic_year_id`,`term_id`);--> statement-breakpoint
ALTER TABLE `activation_codes` ADD `order_id` text;--> statement-breakpoint
CREATE INDEX `activation_codes_order_idx` ON `activation_codes` (`order_id`);