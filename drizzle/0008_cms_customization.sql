CREATE TABLE `page_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`description_ar` text DEFAULT '' NOT NULL,
	`description_en` text DEFAULT '' NOT NULL,
	`thumbnail_file_id` text,
	`snapshot` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_templates_slug_idx` ON `page_templates` (`slug`);
--> statement-breakpoint
ALTER TABLE `files` ADD `alt_ar` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `files` ADD `alt_en` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `files` ADD `updated_at` integer DEFAULT 0 NOT NULL;
