CREATE TABLE `curriculum_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`curriculum_lesson_id` text NOT NULL,
	`block_type` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`body_ar` text,
	`body_en` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `curriculum_contents_lesson_idx` ON `curriculum_contents` (`curriculum_lesson_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `curriculum_contents_type_idx` ON `curriculum_contents` (`block_type`,`status`);--> statement-breakpoint
CREATE TABLE `curriculum_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`subject` text NOT NULL,
	`grade` text NOT NULL,
	`term` text NOT NULL,
	`unit` text NOT NULL,
	`chapter` text NOT NULL,
	`lesson` text NOT NULL,
	`semantic_raw` text NOT NULL,
	`semantic_json` text,
	`summary_ar` text,
	`summary_en` text,
	`review_ar` text,
	`review_en` text,
	`concepts_json` text,
	`subject_slug` text,
	`grade_slug` text,
	`course_slug` text,
	`unit_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `curriculum_lessons_slug_unique` ON `curriculum_lessons` (`slug`);--> statement-breakpoint
CREATE INDEX `curriculum_lessons_subject_idx` ON `curriculum_lessons` (`subject`,`grade`);--> statement-breakpoint
CREATE INDEX `curriculum_lessons_slug_idx` ON `curriculum_lessons` (`slug`);--> statement-breakpoint
CREATE INDEX `curriculum_lessons_status_idx` ON `curriculum_lessons` (`status`,`sort_order`);