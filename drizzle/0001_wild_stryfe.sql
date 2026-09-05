CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_id` text NOT NULL,
	`teacher_id` text,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`description_ar` text,
	`description_en` text,
	`thumbnail_file_id` text,
	`access_level` text DEFAULT 'entitled' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`visibility` text DEFAULT 'catalog' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`publish_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_slug_unique` ON `courses` (`slug`);--> statement-breakpoint
CREATE INDEX `courses_subject_idx` ON `courses` (`subject_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `courses_visibility_idx` ON `courses` (`visibility`,`status`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`bucket` text NOT NULL,
	`kind` text NOT NULL,
	`original_filename` text NOT NULL,
	`mime` text NOT NULL,
	`byte_size` integer NOT NULL,
	`checksum_sha256` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`download_allowed` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_r2_key_unique` ON `files` (`r2_key`);--> statement-breakpoint
CREATE INDEX `files_kind_idx` ON `files` (`kind`,`visibility`);--> statement-breakpoint
CREATE TABLE `grades` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grades_slug_unique` ON `grades` (`slug`);--> statement-breakpoint
CREATE INDEX `grades_program_idx` ON `grades` (`program_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `lesson_items` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`item_type` text NOT NULL,
	`video_id` text,
	`file_id` text,
	`exam_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lesson_items_lesson_idx` ON `lesson_items` (`lesson_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`description_ar` text,
	`description_en` text,
	`access_level` text DEFAULT 'entitled' NOT NULL,
	`free_preview` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`publish_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_slug_unique` ON `lessons` (`slug`);--> statement-breakpoint
CREATE INDEX `lessons_unit_idx` ON `lessons` (`unit_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`description_ar` text,
	`description_en` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `programs_slug_unique` ON `programs` (`slug`);--> statement-breakpoint
CREATE INDEX `programs_status_idx` ON `programs` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`grade_id` text NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`description_ar` text,
	`description_en` text,
	`thumbnail_file_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subjects_slug_unique` ON `subjects` (`slug`);--> statement-breakpoint
CREATE INDEX `subjects_grade_idx` ON `subjects` (`grade_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `units_course_idx` ON `units` (`course_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_asset_id` text,
	`playback_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`duration_seconds` integer,
	`thumbnail_url` text,
	`thumbnail_file_id` text,
	`byte_size` integer,
	`width` integer,
	`height` integer,
	`master_r2_key` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `videos_provider_asset_idx` ON `videos` (`provider`,`provider_asset_id`);